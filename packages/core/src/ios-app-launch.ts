/**
 * Bring an iOS app to the foreground without the XCTest runner.
 * agent-device `apps.open` goes through CoreDevice with a 20s xcrun budget and
 * then the exclusive runner. When that path is wedged, launch still tests via
 * a short `devicectl` call or go-ios (after the iOS 17+ tunnel).
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import {
  attachIosVisualVerificationDiagnostic,
  canPersistIosVisualVerificationRepair,
  iosVisualVerificationCaptureSummary,
  iosVisualVerificationErrorMessage,
  normalizeIosVisualVerificationInteraction,
  persistIosVisualVerificationRepair,
  removeIosVisualVerificationTemporary,
} from "./ios-visual-repair.js";
import type {
  CapturedIosVisualRaster,
  IosVisualVerificationDiagnostic,
  IosVisualVerificationFailure,
  IosVisualVerificationFailureStage,
  IosVisualVerificationRepair,
  IosVisualVerificationRepairPackage,
  IosVisualVerificationResult,
  IosVisualVerificationTiming,
} from "./ios-visual-repair.js";
import { findWorkspaceRoot } from "./workspace-root.js";

export {
  iosVisualVerificationDiagnostic,
  type IosVisualVerificationCapture,
  type IosVisualVerificationDiagnostic,
  type IosVisualVerificationFailure,
  type IosVisualVerificationFailureStage,
  type IosVisualVerificationInteraction,
  type IosVisualVerificationRepair,
  type IosVisualVerificationRepairPackage,
  type IosVisualVerificationResult,
  type IosVisualVerificationTiming,
} from "./ios-visual-repair.js";

const execFileAsync = promisify(execFile);

export const IOS_SIDECAR_LAUNCH_TIMEOUT_MS = 10_000;
export const IOS_COREDEVICE_PROBE_TIMEOUT_MS = 5_000;

export type CommandResult = { exitCode: number; stdout: string; stderr: string };

export type CommandRunner = (
  file: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<CommandResult>;

type IosAppLaunchBackend = "devicectl" | "go-ios";

/**
 * A local CLI compatibility failure that is proven to have happened before
 * either launch backend could ask the device to activate an app. This is the
 * only error `launchIosAppOutsideXctest` may use to select its other backend.
 */
class IosAppLaunchPreDispatchError extends Error {
  readonly backend: IosAppLaunchBackend;
  readonly cause: unknown;

  constructor(backend: IosAppLaunchBackend, cause: unknown) {
    const detail = errorMessage(cause);
    super(`${backend} could not dispatch an iOS app launch locally: ${detail}`);
    this.name = "IosAppLaunchPreDispatchError";
    this.backend = backend;
    this.cause = cause;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function commandFailure(result: CommandResult, fallback: string): Error {
  return new Error((result.stderr || result.stdout || fallback).trim());
}

/**
 * Be deliberately narrow: this is output from the local xcrun/devicectl
 * command parser, not a device or transport result. A missing device,
 * connection error, timeout, or any launch-service failure stays ambiguous.
 */
function devicectlWasLocallyUnavailable(message: string): boolean {
  return (
    /unable to find utility\s+["']?devicectl\b/i.test(message) ||
    /(?:spawn|exec)\s+xcrun\b.*\b(?:ENOENT|EACCES)\b/i.test(message) ||
    /xcode-select:\s*error:.*(?:active developer path|developer directory)/i.test(message) ||
    /(?:unknown|unrecognized)\s+(?:command|subcommand)\b.*\bdevicectl\b/i.test(message)
  );
}

function preDispatchDevicectlError(error: unknown): Error {
  return devicectlWasLocallyUnavailable(errorMessage(error))
    ? new IosAppLaunchPreDispatchError("devicectl", error)
    : error instanceof Error
      ? error
      : new Error(String(error));
}

/** `--terminate-existing` is rejected by a local CLI parser before launch. */
function devicectlRejectedTerminateExisting(result: CommandResult): boolean {
  if (result.exitCode === 0) return false;
  const text = `${result.stdout}\n${result.stderr}`;
  return /(?:(?:unrecognized|unknown)\s+option|unexpected argument)[^\n]*?(?:--)?terminate-existing/i.test(
    text,
  );
}

const BUNDLE_ALIASES: Record<string, string> = {
  grok: "ai.x.GrokApp",
  "ai.x.grok": "ai.x.GrokApp",
  "ai.x.grokapp": "ai.x.GrokApp",
  settings: "com.apple.Preferences",
  safari: "com.apple.mobilesafari",
  preferences: "com.apple.Preferences",
  "com.apple.preferences": "com.apple.Preferences",
  springboard: "com.apple.springboard",
  home: "com.apple.springboard",
};

let tunnelChild: ChildProcess | null = null;
let cachedTunnelInfoPort: string | undefined;
const DEFAULT_TUNNEL_INFO_PORT = "28100";
const FALLBACK_TUNNEL_INFO_PORTS = ["28100", "60105"] as const;

function envTunnelInfoPort(): string | undefined {
  const port =
    process.env.RELAY_GO_IOS_TUNNEL_INFO_PORT?.trim() ||
    process.env.GO_IOS_TUNNEL_INFO_PORT?.trim() ||
    "";
  return /^\d+$/.test(port) ? port : undefined;
}

/** Userspace tunnels often advertise info on a non-default port (not 28100). */
export function goIosTunnelInfoArgs(): string[] {
  const port = envTunnelInfoPort() || cachedTunnelInfoPort;
  if (!port) return [];
  return ["--tunnel-info-port", port];
}

export function resetGoIosTunnelInfoPortForTests(): void {
  cachedTunnelInfoPort = undefined;
}

export async function probeGoIosTunnelInfoPort(
  port: string,
  probe?: (port: string) => Promise<boolean>,
): Promise<boolean> {
  if (probe) return probe(port);
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(250) });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ECONNREFUSED|fetch failed/i.test(message) && /refused/i.test(message)) return false;
    // A hang/timeout is the userspace tun data port, not the info API.
    return /ECONNRESET|reset/i.test(message);
  }
}

export async function rememberGoIosTunnelInfoPort(
  input: { probe?: (port: string) => Promise<boolean> } = {},
): Promise<string | undefined> {
  const fromEnv = envTunnelInfoPort();
  if (fromEnv) {
    cachedTunnelInfoPort = fromEnv;
    return fromEnv;
  }
  if (cachedTunnelInfoPort) return cachedTunnelInfoPort;
  for (const port of FALLBACK_TUNNEL_INFO_PORTS) {
    if (await probeGoIosTunnelInfoPort(port, input.probe)) {
      cachedTunnelInfoPort = port;
      return port;
    }
  }
  return undefined;
}

function withGoIosDeviceArgs(args: readonly string[]): string[] {
  const extra = goIosTunnelInfoArgs();
  if (extra.length === 0 || args.includes("--tunnel-info-port")) return [...args];
  return [...args, ...extra];
}

/**
 * CoreDevice process listing and XCTest launch hang when the developer disk
 * image is wedged. Remount via go-ios; do not reboot the iPad.
 *
 * Returns whether the remount succeeded plus the go-ios stderr so callers can
 * record a truthful failed action when the image could not be mounted.
 */
export type IosDeveloperDiskImageRemountResult = {
  ok: boolean;
  stderr: string;
};

export async function remountIosDeveloperDiskImage(
  serial: string,
  input: { bin?: string; run?: CommandRunner; timeoutMs?: number } = {},
): Promise<IosDeveloperDiskImageRemountResult> {
  const run = input.run ?? defaultCommandRunner;
  const timeoutMs = input.timeoutMs ?? 45_000;
  const bin = input.bin ?? (await resolveGoIosBinary());
  await rememberGoIosTunnelInfoPort();
  try {
    await runGoIos(bin, ["image", "unmount", "--udid", serial], Math.min(timeoutMs, 15_000), run);
    const mounted = await runGoIos(bin, ["image", "auto", "--udid", serial], timeoutMs, run);
    const text = `${mounted.stdout}\n${mounted.stderr}`;
    const ok = mounted.exitCode === 0 && /success mounting|image signature/i.test(text);
    return { ok, stderr: (mounted.stderr || mounted.stdout).trim() };
  } catch (error) {
    return {
      ok: false,
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

export function resolveIosLaunchBundleId(app: string): string {
  const trimmed = app.trim();
  if (!trimmed) throw new Error("iOS launch requires an app name or bundle id");
  const alias = BUNDLE_ALIASES[trimmed.toLocaleLowerCase()];
  if (alias) return alias;
  if (trimmed.includes(".")) return trimmed;
  throw new Error(
    `“${trimmed}” is not a known iOS app. Use a bundle id such as com.apple.Preferences.`,
  );
}

export function isIosSidecarTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /xcrun timed out|devicectl timed out|go-ios .*timed out|timed out after \d+ms/i.test(
    message,
  );
}

export async function defaultCommandRunner(
  file: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(file, [...args], {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    return {
      exitCode: 0,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  } catch (error) {
    const err = error as {
      code?: string;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
      status?: number | null;
      message?: string;
    };
    if (err.code === "ETIMEDOUT" || err.killed) {
      throw new Error(`${file} timed out after ${timeoutMs}ms`);
    }
    return {
      exitCode: typeof err.status === "number" ? err.status : 1,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? err.message ?? ""),
    };
  }
}

export async function probeIosCoreDevice(
  serial: string,
  input: { run?: CommandRunner; timeoutMs?: number } = {},
): Promise<void> {
  const run = input.run ?? defaultCommandRunner;
  const timeoutMs = input.timeoutMs ?? IOS_COREDEVICE_PROBE_TIMEOUT_MS;
  const output = join(tmpdir(), `relay-ios-probe-${process.pid}-${Date.now()}.json`);
  const result = await run(
    "xcrun",
    ["devicectl", "device", "info", "processes", "--device", serial, "--json-output", output],
    timeoutMs,
  );
  if (result.exitCode === 0) return;
  const detail = `${result.stdout}\n${result.stderr}`.trim() || `exit ${result.exitCode}`;
  throw new Error(`Apple device control is not answering (${detail.slice(0, 180)})`);
}

export async function launchIosAppViaDevicectl(
  serial: string,
  app: string,
  input: { relaunch?: boolean; run?: CommandRunner; timeoutMs?: number } = {},
): Promise<{ bundleId: string; method: "devicectl" }> {
  const run = input.run ?? defaultCommandRunner;
  const timeoutMs = input.timeoutMs ?? IOS_SIDECAR_LAUNCH_TIMEOUT_MS;
  const bundleId = resolveIosLaunchBundleId(app);
  const args = [
    "devicectl",
    "device",
    "process",
    "launch",
    "--device",
    serial,
    ...(input.relaunch === false ? [] : ["--terminate-existing"]),
    bundleId,
  ];
  const runDevicectl = async (command: readonly string[]): Promise<CommandResult> => {
    try {
      return await run("xcrun", command, timeoutMs);
    } catch (error) {
      throw preDispatchDevicectlError(error);
    }
  };
  let result = await runDevicectl(args);
  if (input.relaunch !== false && devicectlRejectedTerminateExisting(result)) {
    // This exact parser rejection proves the first command never reached the
    // device. Retrying without the unsupported flag is still one launch.
    result = await runDevicectl([
      "devicectl",
      "device",
      "process",
      "launch",
      "--device",
      serial,
      bundleId,
    ]);
  }
  if (result.exitCode === 0) return { bundleId, method: "devicectl" };
  throw preDispatchDevicectlError(
    commandFailure(result, `devicectl launch exited ${result.exitCode}`),
  );
}

export async function resolveGoIosBinary(): Promise<string> {
  const fromEnv = process.env.RELAY_GO_IOS_BIN?.trim() || process.env.GO_IOS_BIN?.trim();
  const candidates = [
    ...(fromEnv ? [fromEnv] : []),
    join(findWorkspaceRoot(), "vendor", "go-ios", "bin", "ios"),
  ];
  for (const candidate of candidates) {
    const path = isAbsolute(candidate) ? candidate : join(process.cwd(), candidate);
    try {
      await access(path);
      return path;
    } catch {
      // next
    }
  }
  throw new Error("go-ios binary not found (set RELAY_GO_IOS_BIN)");
}

async function runGoIos(
  bin: string,
  args: string[],
  timeoutMs: number,
  run: CommandRunner,
): Promise<CommandResult> {
  return run(bin, withGoIosDeviceArgs(args), timeoutMs);
}

function tunnelLooksReady(listed: string): boolean {
  return /"udid"\s*:/.test(listed) || /userspaceTun/.test(listed) || /rsdPort/.test(listed);
}

export async function ensureGoIosTunnel(
  input: { bin?: string; run?: CommandRunner } = {},
): Promise<void> {
  const bin = input.bin ?? (await resolveGoIosBinary());
  const run = input.run ?? defaultCommandRunner;
  await rememberGoIosTunnelInfoPort();
  try {
    const listed = await runGoIos(bin, ["tunnel", "ls"], 5_000, run);
    if (tunnelLooksReady(`${listed.stdout}\n${listed.stderr}`)) return;
  } catch {
    // start below
  }
  if (!tunnelChild || tunnelChild.exitCode != null) {
    // Pin the info API on the go-ios default so clients stop needing 60105 folklore.
    tunnelChild = spawn(
      bin,
      ["tunnel", "start", "--userspace", "--tunnel-info-port", DEFAULT_TUNNEL_INFO_PORT],
      {
        stdio: "ignore",
        env: { ...process.env, ENABLE_GO_IOS_AGENT: process.env.ENABLE_GO_IOS_AGENT || "user" },
        detached: false,
      },
    );
    tunnelChild.unref?.();
    tunnelChild.once("exit", () => {
      if (tunnelChild?.exitCode != null) tunnelChild = null;
    });
    cachedTunnelInfoPort = DEFAULT_TUNNEL_INFO_PORT;
  }
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const listed = await runGoIos(bin, ["tunnel", "ls"], 4_000, run);
      if (tunnelLooksReady(`${listed.stdout}\n${listed.stderr}`)) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("go-ios tunnel did not become ready");
}

export async function launchIosAppViaGoIos(
  serial: string,
  app: string,
  input: { run?: CommandRunner; timeoutMs?: number; bin?: string } = {},
): Promise<{ bundleId: string; method: "go-ios" }> {
  const bundleId = resolveIosLaunchBundleId(app);
  const run = input.run ?? defaultCommandRunner;
  const timeoutMs = input.timeoutMs ?? IOS_SIDECAR_LAUNCH_TIMEOUT_MS;
  const bin = input.bin ?? (await resolveGoIosBinary());
  // A non-zero launch response can arrive after the app process was told to
  // activate. Do not turn broad tunnel/RSD wording into a second launch; the
  // caller must capture and review the current screen before an explicit retry.
  const result = await runGoIos(bin, ["launch", bundleId, "--udid", serial], timeoutMs, run);
  if (result.exitCode === 0) return { bundleId, method: "go-ios" };
  throw new Error(
    (result.stderr || result.stdout || `go-ios launch exited ${result.exitCode}`).trim(),
  );
}

const STALE_IOS_TEST_PROCESS_NAMES = [
  "AgentDeviceRunner",
  "AgentDeviceRunnerUITests-Runner",
  "devicekit-iosUITests-Runner",
  "xctest",
  "testmanagerd",
] as const;

/**
 * A wedged XCTest host can sit for days holding UI Automation. New xcodebuild
 * then hangs until reboot. Instruments kill via go-ios does not need XCTest.
 */
export async function killStaleIosTestRunners(
  serial: string,
  input: { run?: CommandRunner; bin?: string; timeoutMs?: number } = {},
): Promise<string[]> {
  const run = input.run ?? defaultCommandRunner;
  const timeoutMs = input.timeoutMs ?? 8_000;
  const bin = input.bin ?? (await resolveGoIosBinary());
  const killed: string[] = [];
  for (const name of STALE_IOS_TEST_PROCESS_NAMES) {
    const result = await runGoIos(
      bin,
      ["kill", "--process", name, "--udid", serial],
      timeoutMs,
      run,
    );
    const text = `${result.stdout}\n${result.stderr}`;
    if (result.exitCode === 0 && /killed/i.test(text)) killed.push(name);
  }
  return killed;
}

/**
 * Bounded settle for tap verification: sample up to four frames spread over
 * ~700ms and stop as soon as two consecutive fingerprints agree. A single
 * fixed wait either fires too early (mid-transition) or wastes time on
 * screens that settled instantly.
 */
export const IOS_TAP_VERIFY_MAX_FRAMES = 4;
export const IOS_TAP_VERIFY_STABILITY_WINDOW_MS = 700;

export function pixelEvidenceFingerprint(bytes: Uint8Array): string {
  let hash = bytes.length >>> 0;
  const step = bytes.length > 8_192 ? 97 : 1;
  for (let i = 0; i < bytes.length; i += step) {
    hash = Math.imul(hash ^ bytes[i]!, 16_777_619);
  }
  if (bytes.length > 0) hash = Math.imul(hash ^ bytes[bytes.length - 1]!, 16_777_619);
  return `${bytes.length.toString(16)}-${(hash >>> 0).toString(16)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type AfterActionSettle = "stable" | "live";

/**
 * Capture the after-action frame once the pixels stop moving. Frames are
 * sampled across the settle budget and the first two consecutive equal
 * fingerprints win; a screen that never stabilizes is animated/live (cursor,
 * spinner, video) and callers must treat it as changed rather than dead.
 * A non-positive budget keeps the legacy single-shot capture.
 */
async function captureUntilStable(
  capture: (path: string) => Promise<CapturedIosVisualRaster>,
  path: string,
  budgetMs: number,
): Promise<{ stability: AfterActionSettle; raster?: CapturedIosVisualRaster }> {
  if (budgetMs <= 0) {
    return { stability: "stable", raster: await capture(path) };
  }
  const interval = Math.max(1, Math.floor(budgetMs / (IOS_TAP_VERIFY_MAX_FRAMES - 1)));
  let previous: string | undefined;
  for (let frame = 0; frame < IOS_TAP_VERIFY_MAX_FRAMES; frame += 1) {
    if (frame > 0) await delay(interval);
    const current = await capture(path);
    const fingerprint = pixelEvidenceFingerprint(current.bytes);
    if (previous !== undefined && previous === fingerprint) {
      return { stability: "stable", raster: current };
    }
    previous = fingerprint;
  }
  return { stability: "live" };
}

export async function verifyIosScreenChanged(
  serial: string,
  act: () => Promise<void>,
  input: {
    run?: CommandRunner;
    bin?: string;
    /** Total settle budget for the after-action stability poll. */
    settleMs?: number;
    /** Test-only isolation seam; ordinary callers use the system temp directory. */
    temporaryDirectory?: string;
    /** Opt in to a content-addressed repair package, never a temp-file reference. */
    repair?: IosVisualVerificationRepair;
  } = {},
): Promise<IosVisualVerificationResult> {
  const bin = input.bin ?? (await resolveGoIosBinary());
  const run = input.run ?? defaultCommandRunner;
  const requestedSettleMs = input.settleMs ?? IOS_TAP_VERIFY_STABILITY_WINDOW_MS;
  const settleMs = Number.isFinite(requestedSettleMs)
    ? Math.max(0, Math.min(10_000, Math.floor(requestedSettleMs)))
    : IOS_TAP_VERIFY_STABILITY_WINDOW_MS;
  const temporaryDirectory = input.temporaryDirectory ?? tmpdir();
  const captureId = randomUUID();
  const beforePath = join(temporaryDirectory, `relay-tap-before-${process.pid}-${captureId}.png`);
  const afterPath = join(temporaryDirectory, `relay-tap-after-${process.pid}-${captureId}.png`);
  const startedAt = Date.now();
  const interaction = input.repair
    ? normalizeIosVisualVerificationInteraction(input.repair.interaction)
    : undefined;
  let before: CapturedIosVisualRaster | undefined;
  let after: CapturedIosVisualRaster | undefined;
  let failure: { stage: IosVisualVerificationFailureStage; error: unknown } | undefined;
  const failures: IosVisualVerificationFailure[] = [];
  let actionStartedAt: number | undefined;
  let actionFinishedAt: number | undefined;
  let outcome: IosVisualVerificationDiagnostic["outcome"] = "incomplete";
  let repair: IosVisualVerificationRepairPackage | undefined;
  let repairError: string | undefined;
  let cleanupErrors: string[] | undefined;
  // Capture this before persistence and cleanup. It measures the device proof,
  // rather than variable local file-system work afterwards, and is therefore
  // the exact same interval recorded in the repair manifest.
  let proofTiming: IosVisualVerificationTiming | undefined;

  const recordFailure = (stage: IosVisualVerificationFailureStage, error: unknown) => {
    if (!failure) failure = { stage, error };
    failures.push({ stage, message: iosVisualVerificationErrorMessage(error), at: Date.now() });
  };
  const timing = (finishedAt: number): IosVisualVerificationTiming => ({
    startedAt,
    finishedAt,
    settleMs,
    ...(before ? { beforeCapturedAt: before.capturedAt } : {}),
    ...(actionStartedAt !== undefined ? { actionStartedAt } : {}),
    ...(actionFinishedAt !== undefined ? { actionFinishedAt } : {}),
    ...(after ? { afterCapturedAt: after.capturedAt } : {}),
  });
  const capture = async (path: string): Promise<CapturedIosVisualRaster> => {
    await captureIosPngViaGoIos(serial, path, { bin, run, timeoutMs: 8_000 });
    const bytes = await readFile(path);
    return { capturedAt: Date.now(), bytes };
  };

  try {
    try {
      before = await capture(beforePath);
    } catch (error) {
      recordFailure("before-capture", error);
    }

    if (before) {
      try {
        // This is exactly one caller-requested mutation. No retry, repair,
        // relaunch, or reset belongs in visual verification.
        actionStartedAt = Date.now();
        await act();
      } catch (error) {
        recordFailure("action", error);
      } finally {
        actionFinishedAt = Date.now();
      }
      // The after frame is sampled until pixels settle (bounded). A screen
      // that never stabilizes is animated/live — cursors, spinners, video —
      // and must not be read as a dead tap.
      const settled = await captureUntilStable(capture, afterPath, settleMs);
      after = settled.raster;
      if (after) {
        try {
          before.fingerprint = pixelEvidenceFingerprint(before.bytes);
          after.fingerprint = pixelEvidenceFingerprint(after.bytes);
          // Equal before/after fingerprints only mean a genuinely dead tap
          // when the screen had actually settled.
          if (
            !failure &&
            after.fingerprint === before.fingerprint &&
            settled.stability === "stable"
          ) {
            recordFailure(
              "fingerprint",
              new Error(
                "Tap did not change the screen. The control may not be hittable there — tap the label, or pick another point.",
              ),
            );
          }
        } catch (error) {
          recordFailure("fingerprint", error);
        }
      }
    }

    outcome = failure ? (failure.stage === "fingerprint" ? "unchanged" : "incomplete") : "changed";
  } finally {
    const finishedAt = Date.now();
    proofTiming = timing(finishedAt);
    const shouldPersist = interaction && (input.repair?.retain === "always" || Boolean(failure));
    if (shouldPersist && interaction && !canPersistIosVisualVerificationRepair()) {
      repairError = "Visual evidence is disabled while redaction is enabled";
    } else if (shouldPersist && interaction) {
      try {
        repair = await persistIosVisualVerificationRepair({
          serial,
          interaction,
          timing: proofTiming,
          outcome,
          ...(failure
            ? {
                failure: {
                  stage: failure.stage,
                  message: iosVisualVerificationErrorMessage(failure.error),
                  at: failures[0]?.at ?? finishedAt,
                },
              }
            : {}),
          ...(failures.length ? { failures } : {}),
          ...(before ? { before } : {}),
          ...(after ? { after } : {}),
        });
      } catch (error) {
        // Evidence persistence must not turn an already-completed device
        // action into a fictional input failure. The caller still gets the
        // durable-store error in the diagnostic for a deliberate repair.
        repairError = iosVisualVerificationErrorMessage(error);
      }
    }
    const cleanup = await Promise.all([
      removeIosVisualVerificationTemporary(beforePath),
      removeIosVisualVerificationTemporary(afterPath),
    ]);
    cleanupErrors = cleanup.filter((error): error is string => Boolean(error));
    if (cleanupErrors.length === 0) cleanupErrors = undefined;
  }

  const finishedAt = Date.now();
  const beforeSummary = iosVisualVerificationCaptureSummary(before);
  const afterSummary = iosVisualVerificationCaptureSummary(after);
  const diagnostic: IosVisualVerificationDiagnostic = {
    serial,
    timing: proofTiming ?? timing(finishedAt),
    outcome,
    ...(failure
      ? {
          failure: {
            stage: failure.stage,
            message: iosVisualVerificationErrorMessage(failure.error),
            at: failures[0]?.at ?? finishedAt,
          },
        }
      : {}),
    ...(failures.length ? { failures } : {}),
    ...(beforeSummary ? { before: beforeSummary } : {}),
    ...(afterSummary ? { after: afterSummary } : {}),
    ...(repair ? { repair } : {}),
    ...(repairError ? { repairError } : {}),
    ...(cleanupErrors ? { cleanupErrors } : {}),
  };
  if (failure) {
    attachIosVisualVerificationDiagnostic(failure.error, diagnostic);
    throw failure.error;
  }
  return diagnostic;
}

export async function captureIosPngViaGoIos(
  serial: string,
  path: string,
  input: { run?: CommandRunner; timeoutMs?: number; bin?: string } = {},
): Promise<void> {
  const run = input.run ?? defaultCommandRunner;
  const timeoutMs = input.timeoutMs ?? 12_000;
  const bin = input.bin ?? (await resolveGoIosBinary());
  const attempt = () =>
    runGoIos(bin, ["screenshot", "--udid", serial, `--output=${path}`], timeoutMs, run);
  let result = await attempt();
  const text = `${result.stdout}\n${result.stderr}`;
  if (result.exitCode !== 0 && /tunnel|ios17|rsd/i.test(text)) {
    await ensureGoIosTunnel({ bin, run });
    result = await attempt();
  }
  if (result.exitCode !== 0) {
    throw new Error(
      (result.stderr || result.stdout || `go-ios screenshot exited ${result.exitCode}`).trim(),
    );
  }
}

export async function launchIosAppOutsideXctest(
  serial: string,
  app: string,
  input: { relaunch?: boolean; run?: CommandRunner; timeoutMs?: number; bin?: string } = {},
): Promise<{ bundleId: string; method: "devicectl" | "go-ios" }> {
  try {
    return await launchIosAppViaDevicectl(serial, app, input);
  } catch (devicectlError) {
    // A timeout or transport failure may have launched (or terminated) the
    // app already. Only a local, parser-level incompatibility can safely try
    // the alternate backend.
    if (!(devicectlError instanceof IosAppLaunchPreDispatchError)) throw devicectlError;
    // Tunnel preparation is observation/setup, not an app activation. Do it
    // before the one go-ios launch rather than retrying after a failed launch.
    await ensureGoIosTunnel({ bin: input.bin, run: input.run });
    return await launchIosAppViaGoIos(serial, app, input);
  }
}
