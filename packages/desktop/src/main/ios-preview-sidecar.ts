import { execFileSync } from "node:child_process";
import { constants, accessSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export const IOS_SAFE_PREVIEW_PRODUCER_ENV = "RELAY_IOS_PREVIEW_PRODUCER_BIN";
export const IOS_SAFE_PREVIEW_PRODUCER_PACKAGED_PATH_ENV =
  "RELAY_IOS_PREVIEW_PRODUCER_PACKAGED_PATH";

const manifestVersion = 1;
const manifestKind = "relay.safe-ios-preview-sidecar";
const binaryName = "relay-ios-preview";
const producerModule = "github.com/relay/ios-preview-producer";
const pinnedGoIosVersion = "v1.2.2-0.20260805152531-ebec9a0b076c";
const supportedArchitectures = ["arm64", "x64"] as const;
const machO64Magic = 0xfeedfacf;
const machOProcessorTypes = {
  arm64: 0x0100000c,
  x64: 0x01000007,
} as const;

type SupportedArchitecture = (typeof supportedArchitectures)[number];

type SidecarArtifact = {
  platform?: unknown;
  arch?: unknown;
  path?: unknown;
  buildBytes?: unknown;
  buildSha256?: unknown;
};

type SidecarSource = {
  module?: unknown;
  sourceSha256?: unknown;
  goModSha256?: unknown;
  goSumSha256?: unknown;
  goIosVersion?: unknown;
};

type SidecarManifest = {
  schemaVersion?: unknown;
  kind?: unknown;
  platform?: unknown;
  source?: unknown;
  artifacts?: unknown;
};

export type IosPreviewSidecarFileSystem = {
  readFile(path: string): Buffer;
  access(path: string, mode: number): void;
};

export type IosPreviewSidecarSignatureVerifier = (
  appBundlePath: string,
  binaryPath: string,
) => void;

export type BundledIosPreviewProducerPreflight =
  | {
      ready: true;
      path: string;
    }
  | {
      ready: false;
      path: string;
      reason: string;
    };

const localFileSystem: IosPreviewSidecarFileSystem = {
  readFile: readFileSync,
  access: accessSync,
};

const localSignatureVerifier: IosPreviewSidecarSignatureVerifier = (appBundlePath, binaryPath) => {
  const options = {
    stdio: "ignore" as const,
    timeout: 5_000,
    windowsHide: true,
  };
  // The app seal proves the resource was not swapped after release signing;
  // the binary check makes an unsigned executable an immediate preflight
  // failure instead of a confusing launch-time failure.
  execFileSync("codesign", ["--verify", "--deep", "--strict", appBundlePath], options);
  execFileSync("codesign", ["--verify", "--strict", binaryPath], options);
};

function isSupportedArchitecture(arch: string): arch is SupportedArchitecture {
  return (supportedArchitectures as readonly string[]).includes(arch);
}

function expectedArtifactRelativePath(): string {
  return binaryName;
}

export function bundledIosPreviewProducerPath(resourcesPath: string): string {
  return join(resourcesPath, "ios-preview", expectedArtifactRelativePath());
}

export function bundledIosPreviewAppPath(resourcesPath: string): string {
  return resolve(resourcesPath, "..", "..");
}

function readManifest(
  resourcesPath: string,
  filesystem: IosPreviewSidecarFileSystem,
): SidecarManifest {
  const path = join(resourcesPath, "ios-preview", "manifest.json");
  try {
    return JSON.parse(filesystem.readFile(path).toString("utf8")) as SidecarManifest;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not read its provenance manifest (${detail})`);
  }
}

function isArtifact(value: unknown): value is SidecarArtifact {
  return typeof value === "object" && value !== null;
}

function hasReviewedSourceProvenance(value: unknown): value is SidecarSource {
  if (typeof value !== "object" || value === null) return false;
  const source = value as SidecarSource;
  return (
    source.module === producerModule &&
    source.goIosVersion === pinnedGoIosVersion &&
    [source.sourceSha256, source.goModSha256, source.goSumSha256].every(
      (hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash),
    )
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function safeArtifactPath(resourcesPath: string, artifact: SidecarArtifact): string {
  if (
    typeof artifact.path !== "string" ||
    artifact.path.includes("..") ||
    artifact.path.startsWith(sep)
  ) {
    throw new Error("its provenance manifest contains an unsafe artifact path");
  }
  const root = resolve(resourcesPath, "ios-preview");
  const path = resolve(root, artifact.path);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error("its provenance manifest artifact escapes the app bundle");
  }
  return path;
}

function hasMachOArchitecture(contents: Buffer, arch: SupportedArchitecture): boolean {
  return (
    contents.byteLength >= 8 &&
    contents.readUInt32LE(0) === machO64Magic &&
    contents.readUInt32LE(4) === machOProcessorTypes[arch]
  );
}

/**
 * Check one packaged architecture before the local server starts. This keeps a
 * damaged/incorrect release honest without ever building or substituting a
 * different iOS preview producer on the user's machine.
 */
export function preflightBundledIosPreviewProducer(options: {
  resourcesPath: string;
  arch: string;
  filesystem?: IosPreviewSidecarFileSystem;
  signatureVerifier?: IosPreviewSidecarSignatureVerifier;
}): BundledIosPreviewProducerPreflight {
  const filesystem = options.filesystem ?? localFileSystem;
  const signatureVerifier = options.signatureVerifier ?? localSignatureVerifier;
  const path = bundledIosPreviewProducerPath(options.resourcesPath);
  if (!isSupportedArchitecture(options.arch)) {
    return {
      ready: false,
      path,
      reason: `Relay's built-in iOS preview supports macOS arm64 and x64, not ${options.arch}.`,
    };
  }

  try {
    const manifest = readManifest(options.resourcesPath, filesystem);
    if (
      manifest.schemaVersion !== manifestVersion ||
      manifest.kind !== manifestKind ||
      manifest.platform !== "darwin" ||
      !hasReviewedSourceProvenance(manifest.source) ||
      !Array.isArray(manifest.artifacts)
    ) {
      throw new Error("its provenance manifest is not recognized");
    }
    const artifact = manifest.artifacts.find(
      (candidate): candidate is SidecarArtifact =>
        isArtifact(candidate) && candidate.arch === options.arch,
    );
    if (
      !artifact ||
      artifact.platform !== "darwin" ||
      artifact.arch !== options.arch ||
      artifact.path !== expectedArtifactRelativePath() ||
      !Number.isSafeInteger(artifact.buildBytes) ||
      !isSha256(artifact.buildSha256)
    ) {
      throw new Error(`its native ${options.arch} macOS artifact is missing or malformed`);
    }
    const artifactPath = safeArtifactPath(options.resourcesPath, artifact);
    if (artifactPath !== path) throw new Error("its artifact path is inconsistent");
    const contents = filesystem.readFile(artifactPath);
    if (!hasMachOArchitecture(contents, options.arch)) {
      throw new Error(`its artifact is not the expected ${options.arch} Mach-O executable`);
    }
    filesystem.access(artifactPath, constants.X_OK);
    signatureVerifier(bundledIosPreviewAppPath(options.resourcesPath), artifactPath);
    return { ready: true, path: artifactPath };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ready: false,
      path,
      reason: `Relay could not verify its built-in iOS preview sidecar: ${detail}. Reinstall Relay; it will not download, build, or replace a preview producer automatically.`,
    };
  }
}
