/**
 * Deterministically build and verify Relay's packaged iOS preview sidecar.
 *
 * This module deliberately knows only about the pixel-only producer in
 * packages/ios-preview-producer. It never reaches for go-ios's CLI, WDA,
 * XCTest, or any control transport. Each architecture-specific macOS package
 * carries its one checked native binary, so normal desktop users never need a
 * Go toolchain just to observe iPad pixels.
 */
import { execFile as executeFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(executeFile);

export const IOS_PREVIEW_SIDECAR_MANIFEST_VERSION = 1;
export const IOS_PREVIEW_SIDECAR_KIND = "relay.safe-ios-preview-sidecar";
export const IOS_PREVIEW_SIDECAR_BINARY_NAME = "relay-ios-preview";
export const IOS_PREVIEW_SIDECAR_ARCHITECTURES = ["arm64", "x64"];
export const IOS_PREVIEW_SIDECAR_PLATFORM = "darwin";

const minimumGoVersion = [1, 26, 0];
const machO64Magic = 0xfeedfacf;
const machOProcessorType = {
  arm64: 0x0100000c,
  x64: 0x01000007,
};

const goArchitecture = {
  arm64: "arm64",
  x64: "amd64",
};

function workspaceRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function iosPreviewProducerSource(root = workspaceRoot()) {
  return join(root, "packages", "ios-preview-producer");
}

export function sidecarArtifactRelativePath() {
  return IOS_PREVIEW_SIDECAR_BINARY_NAME;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function compareVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function parseGoVersion(output) {
  const match = /^go version go(\d+)\.(\d+)(?:\.(\d+))?\s+/m.exec(output);
  if (!match) return null;
  return {
    raw: match[0].trim(),
    parts: [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)],
  };
}

async function assertSupportedGo(exec = execFile) {
  let output;
  try {
    ({ stdout: output } = await exec("go", ["version"], { encoding: "utf8" }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Relay's iOS preview sidecar requires Go ${minimumGoVersion.join(".")} or newer: ${detail}`,
    );
  }
  const version = parseGoVersion(output);
  if (!version || compareVersions(version.parts, minimumGoVersion) < 0) {
    throw new Error(
      `Relay's iOS preview sidecar requires Go ${minimumGoVersion.join(".")} or newer; found ${
        version?.raw ?? (output.trim() || "an unrecognized Go toolchain")
      }.`,
    );
  }
  return version.raw;
}

async function sourceFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryRelative = join(prefix, entry.name);
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(entryPath, entryRelative)));
      continue;
    }
    if (
      entry.isFile() &&
      (entry.name.endsWith(".go") || entryRelative === "go.mod" || entryRelative === "go.sum")
    ) {
      files.push(entryRelative);
    }
  }
  return files.sort();
}

function packageModule(goMod) {
  const match = /^module\s+(\S+)/m.exec(goMod);
  if (!match) throw new Error("iOS preview producer go.mod does not declare a module");
  return match[1];
}

function goIosVersion(goMod) {
  const match = /^\s*(?:require\s+)?github\.com\/danielpaulus\/go-ios\s+(\S+)/m.exec(goMod);
  if (!match)
    throw new Error("iOS preview producer go.mod does not pin github.com/danielpaulus/go-ios");
  return match[1];
}

export async function iosPreviewProducerProvenance(options = {}) {
  const source = options.source ?? iosPreviewProducerSource(options.root);
  const files = await sourceFiles(source);
  const hash = createHash("sha256");
  for (const file of files) {
    const contents = await readFile(join(source, file));
    hash.update(file);
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
  }
  const goMod = await readFile(join(source, "go.mod"), "utf8");
  const goSum = await readFile(join(source, "go.sum"));
  return {
    module: packageModule(goMod),
    sourceSha256: hash.digest("hex"),
    goModSha256: sha256(goMod),
    goSumSha256: sha256(goSum),
    goIosVersion: goIosVersion(goMod),
  };
}

async function buildBinary({ output, source, arch, exec = execFile, env = process.env }) {
  await mkdir(dirname(output), { recursive: true });
  await exec(
    "go",
    [
      "build",
      "-mod=readonly",
      "-trimpath",
      "-buildvcs=false",
      "-ldflags=-buildid=",
      "-o",
      output,
      ".",
    ],
    {
      cwd: source,
      env: {
        ...env,
        CGO_ENABLED: "0",
        GOFLAGS: "",
        GOOS: IOS_PREVIEW_SIDECAR_PLATFORM,
        GOARCH: goArchitecture[arch],
        GOENV: "off",
        GOTOOLCHAIN: "local",
        GOWORK: "off",
      },
      encoding: "utf8",
    },
  );
}

function artifactPath(outputDir, artifact) {
  if (
    !artifact ||
    typeof artifact.path !== "string" ||
    artifact.path.includes("..") ||
    artifact.path.startsWith(sep)
  ) {
    throw new Error("iOS preview sidecar manifest contains an unsafe artifact path");
  }
  const path = resolve(outputDir, artifact.path);
  const output = resolve(outputDir);
  if (path !== output && !path.startsWith(`${output}${sep}`)) {
    throw new Error("iOS preview sidecar manifest artifact escapes its bundle directory");
  }
  return path;
}

function assertMachOArchitecture(contents, arch, path) {
  if (contents.byteLength < 8 || contents.readUInt32LE(0) !== machO64Magic) {
    throw new Error(`iOS preview sidecar is not a 64-bit Mach-O executable: ${path}`);
  }
  if (contents.readUInt32LE(4) !== machOProcessorType[arch]) {
    throw new Error(`iOS preview sidecar architecture does not match ${arch}: ${path}`);
  }
}

function manifestError(message) {
  return new Error(`Invalid packaged iOS preview sidecar: ${message}`);
}

export async function readIosPreviewSidecarManifest(outputDir) {
  const manifestPath = join(outputDir, "manifest.json");
  let parsed;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw manifestError(`cannot read ${manifestPath}: ${detail}`);
  }
  if (
    !parsed ||
    parsed.schemaVersion !== IOS_PREVIEW_SIDECAR_MANIFEST_VERSION ||
    parsed.kind !== IOS_PREVIEW_SIDECAR_KIND ||
    parsed.platform !== IOS_PREVIEW_SIDECAR_PLATFORM ||
    !Array.isArray(parsed.artifacts)
  ) {
    throw manifestError("manifest schema or producer identity is not recognized");
  }
  return parsed;
}

export async function verifyIosPreviewSidecar(options = {}) {
  const outputDir = options.outputDir;
  if (!outputDir) throw new Error("An iOS preview sidecar output directory is required");
  const expectedArch = options.arch;
  if (expectedArch && !IOS_PREVIEW_SIDECAR_ARCHITECTURES.includes(expectedArch)) {
    throw new Error(
      `Relay can package the iOS preview sidecar only for arm64 or x64, not ${expectedArch}`,
    );
  }
  const manifest = await readIosPreviewSidecarManifest(outputDir);
  const expectedProvenance = await iosPreviewProducerProvenance(options);
  for (const [key, value] of Object.entries(expectedProvenance)) {
    if (manifest.source?.[key] !== value) {
      throw manifestError(`source ${key} does not match the reviewed producer source`);
    }
  }
  const [artifact] = manifest.artifacts;
  if (
    manifest.artifacts.length !== 1 ||
    !artifact ||
    artifact.platform !== IOS_PREVIEW_SIDECAR_PLATFORM ||
    !IOS_PREVIEW_SIDECAR_ARCHITECTURES.includes(artifact.arch) ||
    (expectedArch && artifact.arch !== expectedArch) ||
    artifact.path !== sidecarArtifactRelativePath() ||
    typeof artifact.buildSha256 !== "string" ||
    !Number.isSafeInteger(artifact.buildBytes)
  ) {
    throw manifestError(`missing or malformed native ${IOS_PREVIEW_SIDECAR_PLATFORM} artifact`);
  }
  const path = artifactPath(outputDir, artifact);
  const contents = await readFile(path);
  assertMachOArchitecture(contents, artifact.arch, path);
  if (contents.byteLength !== artifact.buildBytes || sha256(contents) !== artifact.buildSha256) {
    throw manifestError(`checksum mismatch for native ${IOS_PREVIEW_SIDECAR_PLATFORM} artifact`);
  }
  await access(path, constants.X_OK);
  return manifest;
}

/**
 * Verify the post-signing form copied into a macOS app. Code signing changes a
 * Mach-O's signature load command and appends its code directory, so the
 * deterministic build checksum is intentionally checked before packaging by
 * `verifyIosPreviewSidecar`. Here, macOS's nested-code signature and outer app
 * seal prove the final executable and manifest have not changed.
 */
export async function verifyPackagedIosPreviewSidecar(options = {}) {
  const appPath = options.appPath;
  const expectedArch = options.arch;
  if (!appPath) throw new Error("A packaged macOS app path is required");
  if (!IOS_PREVIEW_SIDECAR_ARCHITECTURES.includes(expectedArch)) {
    throw new Error(
      `Relay can package the iOS preview sidecar only for arm64 or x64, not ${expectedArch}`,
    );
  }
  const outputDir = join(appPath, "Contents", "Resources", "ios-preview");
  const manifest = await readIosPreviewSidecarManifest(outputDir);
  const expectedProvenance = await iosPreviewProducerProvenance(options);
  for (const [key, value] of Object.entries(expectedProvenance)) {
    if (manifest.source?.[key] !== value) {
      throw manifestError(`source ${key} does not match the reviewed producer source`);
    }
  }
  const [artifact] = manifest.artifacts;
  if (
    manifest.artifacts.length !== 1 ||
    !artifact ||
    artifact.platform !== IOS_PREVIEW_SIDECAR_PLATFORM ||
    artifact.arch !== expectedArch ||
    artifact.path !== sidecarArtifactRelativePath() ||
    typeof artifact.buildSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(artifact.buildSha256) ||
    !Number.isSafeInteger(artifact.buildBytes)
  ) {
    throw manifestError(`missing or malformed native ${IOS_PREVIEW_SIDECAR_PLATFORM} artifact`);
  }
  const binaryPath = artifactPath(outputDir, artifact);
  const contents = await readFile(binaryPath);
  assertMachOArchitecture(contents, expectedArch, binaryPath);
  await access(binaryPath, constants.X_OK);
  try {
    await execFile("codesign", ["--verify", "--deep", "--strict", appPath], {
      encoding: "utf8",
      timeout: 5_000,
    });
    await execFile("codesign", ["--verify", "--strict", binaryPath], {
      encoding: "utf8",
      timeout: 5_000,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw manifestError(`macOS code signature verification failed: ${detail}`);
  }
  return manifest;
}

export async function buildReviewedIosPreviewBinary(options) {
  const source = options.source ?? iosPreviewProducerSource(options.root);
  const arch = options.arch ?? process.arch;
  if (!IOS_PREVIEW_SIDECAR_ARCHITECTURES.includes(arch)) {
    throw new Error(`Relay can package the iOS preview sidecar only for arm64 or x64, not ${arch}`);
  }
  const provenance = await iosPreviewProducerProvenance({ source });
  const goVersion = await assertSupportedGo(options.exec);
  await buildBinary({
    output: options.output,
    source,
    arch,
    exec: options.exec,
    env: options.env,
  });
  const contents = await readFile(options.output);
  assertMachOArchitecture(contents, arch, options.output);
  await access(options.output, constants.X_OK);
  return {
    path: options.output,
    arch,
    bytes: contents.byteLength,
    sha256: sha256(contents),
    goVersion,
    source: provenance,
  };
}

export async function buildIosPreviewSidecar(options = {}) {
  const outputDir = options.outputDir;
  if (!outputDir) throw new Error("An iOS preview sidecar output directory is required");
  const source = options.source ?? iosPreviewProducerSource(options.root);
  const arch = options.arch ?? process.arch;
  if (!IOS_PREVIEW_SIDECAR_ARCHITECTURES.includes(arch)) {
    throw new Error(`Relay can package the iOS preview sidecar only for arm64 or x64, not ${arch}`);
  }
  const provenance = await iosPreviewProducerProvenance({ source });
  const goVersion = await assertSupportedGo(options.exec);
  const stagingDir = `${outputDir}.staging-${process.pid}`;
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  try {
    const relativePath = sidecarArtifactRelativePath();
    const output = join(stagingDir, relativePath);
    await buildBinary({ output, source, arch, exec: options.exec, env: options.env });
    const contents = await readFile(output);
    assertMachOArchitecture(contents, arch, output);
    const artifacts = [
      {
        platform: IOS_PREVIEW_SIDECAR_PLATFORM,
        arch,
        path: relativePath,
        buildBytes: contents.byteLength,
        buildSha256: sha256(contents),
      },
    ];
    const manifest = {
      schemaVersion: IOS_PREVIEW_SIDECAR_MANIFEST_VERSION,
      kind: IOS_PREVIEW_SIDECAR_KIND,
      platform: IOS_PREVIEW_SIDECAR_PLATFORM,
      source: provenance,
      build: {
        command: [
          "go",
          "build",
          "-mod=readonly",
          "-trimpath",
          "-buildvcs=false",
          "-ldflags=-buildid=",
        ],
        goVersion,
      },
      artifacts,
    };
    await writeFile(join(stagingDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await verifyIosPreviewSidecar({ outputDir: stagingDir, source, arch });
    await rm(outputDir, { recursive: true, force: true });
    await rename(stagingDir, outputDir);
    return manifest;
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}
