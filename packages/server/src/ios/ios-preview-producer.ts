import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const IOS_SAFE_PREVIEW_PRODUCER_ENV = "RELAY_IOS_PREVIEW_PRODUCER_BIN";
/**
 * Legacy marker retained only so old Desktop launches do not throw. It is not
 * evidence of a trusted path and never changes provenance.
 */
export const IOS_SAFE_PREVIEW_PRODUCER_PACKAGED_ENV = "RELAY_IOS_PREVIEW_PRODUCER_PACKAGED";
/** Set only by Relay Desktop after it has preflighted its bundled sidecar. */
export const IOS_SAFE_PREVIEW_PRODUCER_PACKAGED_PATH_ENV =
  "RELAY_IOS_PREVIEW_PRODUCER_PACKAGED_PATH";

/**
 * Keep this in lockstep with `packages/ios-preview-producer/main.go`.
 *
 * This is intentionally a producer contract, not the Relay application
 * version: a stale local binary can otherwise retain an older, unsafe stream
 * implementation even after Relay's source has been upgraded.
 */
export const IOS_SAFE_PREVIEW_PRODUCER_VERSION =
  "relay-ios-preview/1 go-ios=v1.2.2-0.20260805152531-ebec9a0b076c";
/**
 * A freshly signed macOS sidecar can pay a one-time cold executable-validation
 * cost before its otherwise immediate `--version` output. Give that one,
 * strictly local probe a finite two-second budget. There is deliberately no
 * retry: one SIGKILL-bounded process is deterministic and cannot turn a
 * missing or stuck producer into device/tunnel work.
 */
export const IOS_SAFE_PREVIEW_PRODUCER_VERSION_TIMEOUT_MS = 2_000;
export const IOS_SAFE_PREVIEW_PRODUCER_VERSION_CACHE_MS = 30_000;

const IOS_SAFE_PREVIEW_PRODUCER_VERSION_MAX_BYTES = 512;
const IOS_SAFE_PREVIEW_PRODUCER_VERSION_CACHE_LIMIT = 32;
const execFileAsync = promisify(execFile);

export type IosSafePreviewProducerProvenance = {
  /** The trusted default, a Desktop-preflighted resource, or a user override. */
  source: "default" | "packaged-resource" | "explicit-override";
  /** What Relay can honestly infer from this local version probe. */
  sourceSafety: "pinned-version-match" | "override-unverified";
  /** Sanitized, bounded stdout from `<producer> --version`. */
  observedVersion: string;
};

export type VerifiedIosSafePreviewProducer = {
  path: string;
  provenance: IosSafePreviewProducerProvenance;
};

type IosSafePreviewProducerVerificationCacheEntry = {
  identity: string;
  checkedAt: number;
  outcome: { kind: "verified"; observedVersion: string } | { kind: "failed"; message: string };
};

export type IosSafePreviewProducerVerificationCache = Map<
  string,
  IosSafePreviewProducerVerificationCacheEntry
>;

const sidecarVersionCache: IosSafePreviewProducerVerificationCache = new Map();

export type VerifySafeIosPreviewProducerOptions = {
  env?: NodeJS.ProcessEnv;
  root?: string;
  accessible?: (path: string) => Promise<void>;
  fileIdentity?: (path: string) => Promise<string>;
  versionProbe?: (path: string, timeoutMs: number) => Promise<string>;
  now?: () => number;
  cache?: IosSafePreviewProducerVerificationCache;
};

function repositoryRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

export function defaultIosPreviewProducerPath(root = repositoryRoot()): string {
  return join(root, ".relay", "bin", "relay-ios-preview");
}

function safeIosPreviewProducerBuildGuidance(packaged: boolean): string {
  return packaged
    ? "Reinstall Relay to restore its bundled safe iOS preview producer. Relay will not download or rebuild it automatically."
    : `Run \`pnpm ios-preview:build\` once, or set ${IOS_SAFE_PREVIEW_PRODUCER_ENV} to a reviewed producer binary.`;
}

export function safeIosPreviewProducerMissingMessage(
  path: string,
  options: { packaged?: boolean } = {},
): string {
  return [
    "Safe iOS preview producer is unavailable or not executable.",
    safeIosPreviewProducerBuildGuidance(Boolean(options.packaged)),
    `Expected: ${path}`,
    "Relay will not fall back to go-ios `screenshot --stream` because its upstream HTTP fanout is unsafe.",
  ].join(" ");
}

function safeIosPreviewProducerVersionMessage(input: {
  path: string;
  observedVersion?: string;
  timeout?: boolean;
  packaged: boolean;
}): string {
  const reason = input.timeout
    ? `did not report a version within ${IOS_SAFE_PREVIEW_PRODUCER_VERSION_TIMEOUT_MS}ms`
    : `reported ${JSON.stringify(input.observedVersion || "no version output")}`;
  return [
    `Safe iOS preview producer is not the reviewed pinned build: it ${reason}.`,
    `Expected version: ${IOS_SAFE_PREVIEW_PRODUCER_VERSION}.`,
    safeIosPreviewProducerBuildGuidance(input.packaged),
    `Expected: ${input.path}`,
    "Relay will not start the default preview sidecar until this version proof succeeds.",
  ].join(" ");
}

function safeIosPreviewProducerOverrideVersionMessage(input: {
  path: string;
  observedVersion?: string;
  timeout?: boolean;
}): string {
  const reason = input.timeout
    ? `did not report a version within ${IOS_SAFE_PREVIEW_PRODUCER_VERSION_TIMEOUT_MS}ms`
    : `reported ${JSON.stringify(input.observedVersion || "no version output")}`;
  return [
    `Configured iOS preview producer ${reason}.`,
    `Check that ${input.path} supports a bounded \`--version\` probe, or remove ${IOS_SAFE_PREVIEW_PRODUCER_ENV}.`,
    "Relay does not start an override whose provenance it cannot report, and does not claim override source safety.",
  ].join(" ");
}

async function defaultFileIdentity(path: string): Promise<string> {
  const metadata = await stat(path);
  return [metadata.dev, metadata.ino, metadata.size, metadata.mtimeMs, metadata.ctimeMs].join(":");
}

function normalizeObservedVersion(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, IOS_SAFE_PREVIEW_PRODUCER_VERSION_MAX_BYTES);
}

async function defaultVersionProbe(path: string, timeoutMs: number): Promise<string> {
  const { stdout } = await execFileAsync(path, ["--version"], {
    encoding: "utf8",
    timeout: timeoutMs,
    // A version check is strictly local and must remain bounded even if a
    // malformed binary ignores normal shutdown. It receives no UDID, tunnel,
    // or device argument.
    killSignal: "SIGKILL",
    maxBuffer: IOS_SAFE_PREVIEW_PRODUCER_VERSION_MAX_BYTES,
    windowsHide: true,
  });
  return normalizeObservedVersion(String(stdout));
}

function cacheKey(path: string, source: IosSafePreviewProducerProvenance["source"]): string {
  return `${source}\u0000${path}`;
}

function readCachedVerification(
  cache: IosSafePreviewProducerVerificationCache,
  key: string,
  identity: string,
  now: number,
): IosSafePreviewProducerVerificationCacheEntry["outcome"] | undefined {
  const entry = cache.get(key);
  if (
    !entry ||
    entry.identity !== identity ||
    now < entry.checkedAt ||
    now - entry.checkedAt >= IOS_SAFE_PREVIEW_PRODUCER_VERSION_CACHE_MS
  ) {
    return undefined;
  }
  return entry.outcome;
}

function cacheVerification(
  cache: IosSafePreviewProducerVerificationCache,
  key: string,
  entry: IosSafePreviewProducerVerificationCacheEntry,
): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > IOS_SAFE_PREVIEW_PRODUCER_VERSION_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

function isProbeTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; killed?: unknown; signal?: unknown };
  return record.code === "ETIMEDOUT" || record.killed === true || record.signal === "SIGKILL";
}

function failedProbeMessage(input: {
  source: IosSafePreviewProducerProvenance["source"];
  path: string;
  observedVersion?: string;
  timeout?: boolean;
}): string {
  if (input.source === "explicit-override") {
    return safeIosPreviewProducerOverrideVersionMessage(input);
  }
  return safeIosPreviewProducerVersionMessage({
    ...input,
    packaged: input.source === "packaged-resource",
  });
}

function provenanceFor(
  source: IosSafePreviewProducerProvenance["source"],
  observedVersion: string,
): IosSafePreviewProducerProvenance {
  return {
    source,
    sourceSafety: source === "explicit-override" ? "override-unverified" : "pinned-version-match",
    observedVersion,
  };
}

/**
 * Verify the local producer before any tunnel or target work begins.
 *
 * The default Relay path is accepted only when its exact pinned version is
 * observed. An explicit override is deliberately allowed, but its output is
 * reported as unverified provenance rather than being called a reviewed
 * source. Successful and failed probes are short-lived, identity-keyed cache
 * entries so a stale replacement cannot inherit a prior binary's proof.
 */
export async function verifySafeIosPreviewProducer(
  options: VerifySafeIosPreviewProducerOptions = {},
): Promise<VerifiedIosSafePreviewProducer> {
  const env = options.env ?? process.env;
  const explicitOverride = env[IOS_SAFE_PREVIEW_PRODUCER_ENV]?.trim();
  const packagedPath = env[IOS_SAFE_PREVIEW_PRODUCER_PACKAGED_PATH_ENV]?.trim();
  // `BIN` is always a human/operator override. Desktop carries its own
  // preflighted path in a separate variable, so a stale marker can never
  // silently upgrade arbitrary executable provenance.
  const source: IosSafePreviewProducerProvenance["source"] = explicitOverride
    ? "explicit-override"
    : packagedPath
      ? "packaged-resource"
      : "default";
  const path = explicitOverride || packagedPath || defaultIosPreviewProducerPath(options.root);
  const accessible = options.accessible ?? ((candidate) => access(candidate, constants.X_OK));
  const fileIdentity = options.fileIdentity ?? defaultFileIdentity;
  const versionProbe = options.versionProbe ?? defaultVersionProbe;
  const now = options.now ?? Date.now;
  const cache = options.cache ?? sidecarVersionCache;

  try {
    await accessible(path);
  } catch {
    throw new Error(
      safeIosPreviewProducerMissingMessage(path, { packaged: source === "packaged-resource" }),
    );
  }

  let identity: string;
  try {
    identity = await fileIdentity(path);
  } catch {
    throw new Error(
      safeIosPreviewProducerMissingMessage(path, { packaged: source === "packaged-resource" }),
    );
  }

  const checkedAt = now();
  const key = cacheKey(path, source);
  let outcome = readCachedVerification(cache, key, identity, checkedAt);
  if (!outcome) {
    try {
      const observedVersion = normalizeObservedVersion(
        await versionProbe(path, IOS_SAFE_PREVIEW_PRODUCER_VERSION_TIMEOUT_MS),
      );
      if (!observedVersion) {
        throw new Error(failedProbeMessage({ source, path }));
      }
      if (source !== "explicit-override" && observedVersion !== IOS_SAFE_PREVIEW_PRODUCER_VERSION) {
        throw new Error(failedProbeMessage({ source, path, observedVersion }));
      }
      outcome = { kind: "verified", observedVersion };
    } catch (error) {
      const message =
        error instanceof Error && error.message.startsWith("Safe iOS preview producer")
          ? error.message
          : failedProbeMessage({
              source,
              path,
              timeout: isProbeTimeout(error),
            });
      outcome = { kind: "failed", message };
    }
    cacheVerification(cache, key, { identity, checkedAt, outcome });
  }

  if (outcome.kind === "failed") throw new Error(outcome.message);
  return { path, provenance: provenanceFor(source, outcome.observedVersion) };
}

/**
 * Resolve only Relay's reviewed, pixel-only producer. This intentionally does
 * not accept the regular go-ios binary as a fallback: that binary's
 * `screenshot --stream` server owns an unsafe, unbounded HTTP fanout.
 */
export async function resolveSafeIosPreviewProducer(
  options: VerifySafeIosPreviewProducerOptions = {},
): Promise<string> {
  return (await verifySafeIosPreviewProducer(options)).path;
}

/** Safe, bounded response metadata; it never exposes a local binary path. */
export function iosSafePreviewProducerProvenanceHeaders(
  provenance: IosSafePreviewProducerProvenance,
): Record<string, string> {
  return {
    "X-Relay-Ios-Preview-Producer-Provenance": provenance.source,
    "X-Relay-Ios-Preview-Producer-Safety": provenance.sourceSafety,
    "X-Relay-Ios-Preview-Producer-Version": provenance.observedVersion,
  };
}

/** The sidecar understands only pixels and tunnel lookup; it has no input API. */
export function safeIosPreviewProducerArgs(
  serial: string,
  tunnelInfoArgs: readonly string[],
): string[] {
  return ["--udid", serial, ...tunnelInfoArgs];
}
