import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { constants, createWriteStream } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import type { Build } from "@relay/protocol";
import { findWorkspaceRoot } from "./workspace-root.js";
import type { TargetContext } from "./target-context.js";
import { artifactDigestForProof, artifactSourceSha256 } from "./artifact-digest.js";

const execFileAsync = promisify(execFile);

function androidSdkRoots(): string[] {
  return [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    join(homedir(), "Library", "Android", "sdk"),
    join(homedir(), "Android", "Sdk"),
  ].filter(
    (value, index, values): value is string =>
      Boolean(value?.trim()) && values.indexOf(value) === index,
  );
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function versionDirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path)).sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true }),
    );
  } catch {
    return [];
  }
}

async function resolveAndroidBuildCommand(command: string): Promise<string> {
  if (!new Set(["adb", "aapt", "aapt2", "apkanalyzer"]).has(command)) return command;
  const executableName = process.platform === "win32" ? `${command}.exe` : command;
  for (const root of androidSdkRoots()) {
    const candidates =
      command === "adb"
        ? [join(root, "platform-tools", executableName)]
        : command === "apkanalyzer"
          ? [
              ...(await versionDirectories(join(root, "cmdline-tools"))).map((version) =>
                join(root, "cmdline-tools", version, "bin", executableName),
              ),
              join(root, "tools", "bin", executableName),
            ]
          : (await versionDirectories(join(root, "build-tools"))).map((version) =>
              join(root, "build-tools", version, executableName),
            );
    for (const candidate of candidates) {
      if (await executable(candidate)) return candidate;
    }
  }
  return command;
}

export type BuildCommandRunner = (
  executable: string,
  args: string[],
) => Promise<{ stdout?: string; stderr?: string }>;

const defaultCommandRunner: BuildCommandRunner = async (executable, args) => {
  const result = await execFileAsync(await resolveAndroidBuildCommand(executable), args);
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
};

export type RegisteredBuildPreflight = {
  buildId: string;
  ok: boolean;
  checkedAt: number;
  artifact?: { path: string; kind: "apk" | "app"; bytes?: number };
  applicationId?: string;
  capabilities: { install: boolean; launch: boolean };
  checks: Array<{
    id: string;
    status: "pass" | "warning" | "fail";
    message: string;
  }>;
};

export type ProofBuildProvenanceReceipt = {
  schemaVersion: 1;
  buildId: string;
  target: {
    kind: "device";
    id: string;
    platform: "android" | "ios";
  };
  artifactDigest: `sha256:${string}`;
  applicationId: string;
  install: "not-requested" | "installed" | "verified";
  launch: "not-requested" | "launched";
  observation: {
    status: "verified";
    observedAt: number;
    applicationId: string;
    artifactDigest: `sha256:${string}`;
    sourceSha256: `sha256:${string}`;
  };
};

function localArtifactPath(sourceUrl: string | undefined): string | undefined {
  const source = sourceUrl?.trim();
  if (!source) return undefined;
  if (/^https?:\/\//i.test(source)) return undefined;
  if (source.startsWith("file://")) {
    const url = new URL(source);
    return decodeURIComponent(url.pathname);
  }
  return isAbsolute(source) ? source : resolve(findWorkspaceRoot(), source);
}

/** Remote build sources larger than this are rejected before the disk fills. */
const MAX_REMOTE_BUILD_BYTES = 4 * 1024 * 1024 * 1024;
const HEX_SHA256 = /^[a-f0-9]{64}$/i;

/** Preserves a trailing `.apk`/`.app` from the source URL so cached files
 * keep satisfying the existing artifact-format checks downstream. */
function cacheFileExtension(pathname: string): string {
  const match = /\.(apk|app)$/i.exec(new URL(`https://cache.invalid${pathname}`).pathname);
  return match ? match[0] : ".artifact";
}

/**
 * Downloads a remote build artifact into the state dir's builds cache,
 * enforcing a size cap and verifying an optional expected sha256 digest
 * fail-closed, and returns the cached path for the existing install/preflight
 * flows. Content type is deliberately ignored: artifact bytes are
 * authenticated by digest, not by server-claimed metadata. The https-only
 * policy for registered sources is enforced at the trust boundaries (the
 * control-plane registration route and `preflightRegisteredBuild`), so this
 * primitive accepts any absolute http(s) URL.
 */
export async function resolveRegisteredBuildArtifact(
  sourceUrl: string,
  options: { sourceSha256?: string; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const url = new URL(sourceUrl.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Build source URL must be an absolute http(s) URL");
  }
  const expectedSha256 = options.sourceSha256?.trim().toLowerCase();
  if (expectedSha256 !== undefined && !HEX_SHA256.test(expectedSha256)) {
    throw new Error("sourceSha256 must be a hex sha256 digest");
  }
  // The cache key is derived from the exact registered URL so distinct sources
  // never collide while repeat registrations of one artifact reuse bytes.
  const cacheDirectory = join(
    process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay"),
    "builds",
  );
  await mkdir(cacheDirectory, { recursive: true });
  const destination = join(
    cacheDirectory,
    `${createHash("sha256").update(sourceUrl).digest("hex")}${cacheFileExtension(url.pathname)}`,
  );
  const partial = `${destination}.partial`;
  try {
    await rm(partial, { force: true });
    const response = await (options.fetchImpl ?? fetch)(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`Build source download failed with HTTP ${response.status}`);
    }
    if (!response.body) throw new Error("Build source download returned an empty body");
    let received = 0;
    const hash = createHash("sha256");
    const out = createWriteStream(partial);
    try {
      await pipeline(
        Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
        async function* (chunks: AsyncIterable<Uint8Array>) {
          for await (const chunk of chunks) {
            received += chunk.byteLength;
            if (received > MAX_REMOTE_BUILD_BYTES) {
              throw new Error(`Build source exceeds the ${MAX_REMOTE_BUILD_BYTES} byte size cap`);
            }
            hash.update(chunk);
            yield chunk;
          }
        },
        out,
      );
    } finally {
      out.destroy();
    }
    const actualSha256 = hash.digest("hex");
    if (expectedSha256 !== undefined && actualSha256 !== expectedSha256) {
      throw new Error(
        `Build source sha256 mismatch: expected ${expectedSha256}, got ${actualSha256}`,
      );
    }
    // Rename only after full verification so failures never leave a
    // half-written artifact at the canonical cache path.
    await rename(partial, destination);
    return destination;
  } finally {
    await rm(partial, { force: true });
  }
}

async function inferApplicationId(
  build: Build,
  path: string,
  run: BuildCommandRunner,
): Promise<string | undefined> {
  const attempts: Array<[string, string[], (output: string) => string | undefined]> =
    build.platform === "android"
      ? [
          [
            "apkanalyzer",
            ["manifest", "application-id", path],
            (output) => output.trim() || undefined,
          ],
          [
            "aapt",
            ["dump", "badging", path],
            (output) => output.match(/package:\s+name='([^']+)'/)?.[1],
          ],
        ]
      : [
          [
            "plutil",
            ["-extract", "CFBundleIdentifier", "raw", `${path}/Info.plist`],
            (output) => output.trim() || undefined,
          ],
        ];
  for (const [command, args, parse] of attempts) {
    try {
      const result = await run(command, args);
      const applicationId = parse(String(result.stdout ?? ""));
      if (applicationId) return applicationId;
    } catch {
      // Tool availability is reflected as a launch warning in preflight.
    }
  }
  return undefined;
}

export async function preflightRegisteredBuild(
  build: Build,
  options: { target?: TargetContext; run?: BuildCommandRunner; at?: number } = {},
): Promise<RegisteredBuildPreflight> {
  const at = options.at ?? Date.now();
  const run = options.run ?? defaultCommandRunner;
  let path = localArtifactPath(build.sourceUrl);
  const expectedKind = build.platform === "android" ? "apk" : "app";
  const checks: RegisteredBuildPreflight["checks"] = [];
  if (!path && /^https?:\/\//i.test(build.sourceUrl?.trim() ?? "")) {
    const remoteSource = build.sourceUrl!.trim();
    const remoteHttpAllowed =
      remoteSource.toLowerCase().startsWith("https://") ||
      /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(remoteSource);
    if (!remoteHttpAllowed) {
      checks.push({
        id: "local-artifact",
        status: "fail",
        message: "Remote build source must be an absolute https URL",
      });
      return {
        buildId: build.id,
        ok: false,
        checkedAt: at,
        capabilities: { install: false, launch: false },
        checks,
      };
    }
    try {
      path = await resolveRegisteredBuildArtifact(remoteSource, {
        sourceSha256: build.sourceSha256,
      });
    } catch (error) {
      checks.push({
        id: "local-artifact",
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        buildId: build.id,
        ok: false,
        checkedAt: at,
        capabilities: { install: false, launch: false },
        checks,
      };
    }
  }
  if (!path) {
    checks.push({
      id: "local-artifact",
      status: "fail",
      message: build.sourceUrl
        ? "Build source is remote; register a local artifact before install"
        : "Build has no registered artifact",
    });
    return {
      buildId: build.id,
      ok: false,
      checkedAt: at,
      capabilities: { install: false, launch: false },
      checks,
    };
  }

  let info;
  try {
    await access(path);
    info = await stat(path);
  } catch {
    checks.push({
      id: "local-artifact",
      status: "fail",
      message: `Artifact does not exist: ${path}`,
    });
    return {
      buildId: build.id,
      ok: false,
      checkedAt: at,
      capabilities: { install: false, launch: false },
      checks,
    };
  }

  const kindMatches =
    expectedKind === "apk"
      ? info.isFile() && path.toLowerCase().endsWith(".apk")
      : info.isDirectory() && path.toLowerCase().endsWith(".app");
  checks.push({
    id: "artifact-format",
    status: kindMatches ? "pass" : "fail",
    message: kindMatches
      ? `Local ${expectedKind.toUpperCase()} is readable`
      : `Expected a local .${expectedKind} ${expectedKind === "app" ? "bundle" : "file"}`,
  });
  const targetMatches =
    !options.target ||
    (options.target.kind === "device" && options.target.platform === build.platform);
  checks.push({
    id: "target-platform",
    status: targetMatches ? "pass" : "fail",
    message: targetMatches
      ? `Build targets ${build.platform}`
      : `Selected target does not support this ${build.platform} build`,
  });

  const applicationId = kindMatches ? await inferApplicationId(build, path, run) : undefined;
  checks.push({
    id: "application-id",
    status: applicationId ? "pass" : "warning",
    message: applicationId
      ? `Application id: ${applicationId}`
      : "Application id could not be inferred; install is available but launch needs an explicit app id",
  });

  const install = kindMatches && targetMatches;
  return {
    buildId: build.id,
    ok: install,
    checkedAt: at,
    artifact: {
      path,
      kind: expectedKind,
      ...(info.isFile() ? { bytes: info.size } : {}),
    },
    ...(applicationId ? { applicationId } : {}),
    capabilities: { install, launch: install && Boolean(applicationId) },
    checks,
  };
}

export async function installRegisteredBuild(input: {
  build: Build;
  target: TargetContext;
  targetKind?: string | null;
  run?: BuildCommandRunner;
}): Promise<{ installed: true; applicationId?: string; artifactPath: string }> {
  const run = input.run ?? defaultCommandRunner;
  const preflight = await preflightRegisteredBuild(input.build, { target: input.target, run });
  if (!preflight.ok || !preflight.artifact) {
    throw new Error(
      preflight.checks
        .filter((check) => check.status === "fail")
        .map((check) => check.message)
        .join("; "),
    );
  }
  if (input.target.kind !== "device")
    throw new Error("Build installation requires a device target");
  if (input.target.platform === "android") {
    await run("adb", ["-s", input.target.serial, "install", "-r", preflight.artifact.path]);
  } else {
    if (input.targetKind && !/simulator/i.test(input.targetKind)) {
      throw new Error(
        "Local iOS build installation currently supports simulators; use a simulator or provider adapter",
      );
    }
    await run("xcrun", ["simctl", "install", input.target.serial, preflight.artifact.path]);
  }
  return {
    installed: true,
    ...(preflight.applicationId ? { applicationId: preflight.applicationId } : {}),
    artifactPath: preflight.artifact.path,
  };
}

function installedPackagePath(stdout: string): string | undefined {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim().match(/^package:(\S+)$/u)?.[1])
    .find((path): path is string => Boolean(path));
}

function installedPackageDigest(stdout: string): `sha256:${string}` | undefined {
  const digest = stdout
    .trim()
    .match(/^([a-f0-9]{64})\s+/iu)?.[1]
    ?.toLowerCase();
  return digest ? `sha256:${digest}` : undefined;
}

/** Verify that the bytes currently installed on a target are the exact
 * artifact selected by an executable Proof. This is intentionally separate
 * from manual install/launch: a Proof cannot trust a package merely because
 * it has the expected application id. */
export async function prepareRegisteredBuildForProof(input: {
  build: Build;
  target: Extract<TargetContext, { kind: "device" }>;
  targetKind?: string | null;
  sourceSha: string;
  artifactDigest: string;
  run?: BuildCommandRunner;
  install?: boolean;
  launch?: boolean;
  at?: number;
}): Promise<ProofBuildProvenanceReceipt> {
  const at = input.at ?? Date.now();
  const run = input.run ?? defaultCommandRunner;
  if (input.build.platform !== input.target.platform) {
    throw new Error(
      `Proof build ${input.build.id} targets ${input.build.platform}, not ${input.target.platform}`,
    );
  }
  if (input.build.platform === "ios" && !/simulator/i.test(input.targetKind ?? "")) {
    throw new Error(
      "PROOF_INSUFFICIENT_EVIDENCE: physical iOS Proof execution requires an exact IPA installer",
    );
  }
  if (input.build.status !== "ready") throw new Error("Proof build must be ready");
  if (input.build.sourceSha !== input.sourceSha) {
    throw new Error("Proof build sourceSha does not match the exact requested revision");
  }
  if (!input.build.sourceSha256 || !HEX_SHA256.test(input.build.sourceSha256)) {
    throw new Error("PROOF_INSUFFICIENT_EVIDENCE: Proof build requires a verified sourceSha256");
  }
  const preflight = await preflightRegisteredBuild(input.build, {
    target: input.target,
    run,
    at,
  });
  if (!preflight.ok || !preflight.artifact) {
    throw new Error(
      preflight.checks
        .filter((check) => check.status === "fail")
        .map((check) => check.message)
        .join("; ") || "Proof build preflight failed",
    );
  }
  const artifactDigest = await artifactDigestForProof(preflight.artifact.path);
  if (
    (await artifactSourceSha256(preflight.artifact.path)) !== input.build.sourceSha256.toLowerCase()
  ) {
    throw new Error("Proof artifact digest does not match registered sourceSha256");
  }
  if (artifactDigest !== input.artifactDigest) {
    throw new Error("Proof artifact digest does not match the requested build identity");
  }
  const applicationId = input.build.applicationId?.trim();
  if (!applicationId || !preflight.applicationId || applicationId !== preflight.applicationId) {
    throw new Error("PROOF_INSUFFICIENT_EVIDENCE: artifact application identity is not verified");
  }
  let install: ProofBuildProvenanceReceipt["install"] = "not-requested";
  if (input.install) {
    await installRegisteredBuild({
      build: input.build,
      target: input.target,
      targetKind: input.targetKind,
      run,
    });
    install = "installed";
  }
  if (input.target.platform !== "android") {
    throw new Error(
      "PROOF_INSUFFICIENT_EVIDENCE: exact installed iOS application observation is unavailable",
    );
  }
  const pathResult = await run("adb", [
    "-s",
    input.target.serial,
    "shell",
    "pm",
    "path",
    applicationId,
  ]);
  const packagePath = installedPackagePath(String(pathResult.stdout ?? ""));
  if (!packagePath) {
    throw new Error(
      "PROOF_INSUFFICIENT_EVIDENCE: exact application is not installed on the target",
    );
  }
  const digestResult = await run("adb", [
    "-s",
    input.target.serial,
    "shell",
    "sha256sum",
    packagePath,
  ]);
  const observedDigest = installedPackageDigest(String(digestResult.stdout ?? ""));
  const expectedInstalledDigest = `sha256:${input.build.sourceSha256.toLowerCase()}` as const;
  if (!observedDigest || observedDigest !== expectedInstalledDigest) {
    throw new Error(
      "PROOF_INSUFFICIENT_EVIDENCE: installed application bytes are stale or unverified",
    );
  }
  let launch: ProofBuildProvenanceReceipt["launch"] = "not-requested";
  if (input.launch) {
    await launchRegisteredBuild({ build: input.build, target: input.target, run });
    launch = "launched";
  }
  install = install === "installed" ? "installed" : "verified";
  return {
    schemaVersion: 1,
    buildId: input.build.id,
    target: { kind: "device", id: input.target.serial, platform: input.target.platform },
    artifactDigest,
    applicationId,
    install,
    launch,
    observation: {
      status: "verified",
      observedAt: at,
      applicationId,
      artifactDigest,
      sourceSha256: observedDigest,
    },
  };
}

export async function launchRegisteredBuild(input: {
  build: Build;
  target: TargetContext;
  applicationId?: string;
  run?: BuildCommandRunner;
}): Promise<{ launched: true; applicationId: string }> {
  const run = input.run ?? defaultCommandRunner;
  const preflight = await preflightRegisteredBuild(input.build, { target: input.target, run });
  if (!preflight.ok) {
    throw new Error(
      preflight.checks
        .filter((check) => check.status === "fail")
        .map((check) => check.message)
        .join("; "),
    );
  }
  const applicationId = input.applicationId?.trim() || preflight.applicationId;
  if (
    input.applicationId?.trim() &&
    (!preflight.applicationId || input.applicationId.trim() !== preflight.applicationId)
  ) {
    throw new Error("applicationId override does not match the registered artifact identity");
  }
  if (!applicationId)
    throw new Error("applicationId is required because it could not be inferred from the artifact");
  if (input.target.kind !== "device") throw new Error("Build launch requires a device target");
  if (input.target.platform === "android") {
    await run("adb", [
      "-s",
      input.target.serial,
      "shell",
      "monkey",
      "-p",
      applicationId,
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    ]);
  } else {
    await run("xcrun", ["simctl", "launch", input.target.serial, applicationId]);
  }
  return { launched: true, applicationId };
}
