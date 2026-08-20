/**
 * Relay's Apple-device capture boundary.
 *
 * Android can offer a low-latency scrcpy stream. Apple physical devices use
 * the signed XCTest runner instead: it provides snapshots, interaction, and
 * a high-quality recorded take, but not a misleading pseudo-live H.264 feed.
 * Keep that distinction here so callers do not have to infer it from platform
 * names or runner errors.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Device } from "./device.js";
import { runIosMutationOnce } from "./ios-mutation-policy.js";

const execFileAsync = promisify(execFile);

export type IosCaptureMode = "snapshot" | "recorded-video";

export type IosVideoCaptureResult = {
  mode: "recorded-video";
  path?: string;
  warning?: string;
};

export class IosRunnerSetupError extends Error {
  readonly code: string = "ios-runner-setup";

  constructor(
    readonly causeMessage: string,
    message = iosRunnerSetupMessage(causeMessage),
  ) {
    super(message);
    this.name = "IosRunnerSetupError";
  }
}

export class IosDeviceAttentionError extends Error {
  readonly code: string = "ios-device-attention";

  constructor(message: string) {
    super(message);
    this.name = "IosDeviceAttentionError";
  }
}

/**
 * Xcode reports this as a generic CoreDevice launch failure, then later SDK
 * calls collapse it into “no active XCTest session”. Keep the physical cause
 * intact so Reconnect can tell someone what actually needs attention.
 */
export class IosDeveloperDiskImageError extends IosRunnerSetupError {
  readonly code = "ios-developer-disk-image";

  constructor(causeMessage: string) {
    super(causeMessage, iosDeveloperDiskImageMessage(causeMessage));
    this.name = "IosDeveloperDiskImageError";
  }
}

/** The runner has not attached, but no more specific host failure is known. */
export class IosXCTestSessionUnavailableError extends IosDeviceAttentionError {
  readonly code = "ios-xctest-session-unavailable";

  constructor(readonly causeMessage: string) {
    super(
      "Relay’s bounded XCTest session probe could not attach. This only reports the runner session; it does not establish a physical-device fault. Keep the iPad unlocked and cabled, open Xcode, wait for the Automation Running indicator, then press Reconnect once.",
    );
    this.name = "IosXCTestSessionUnavailableError";
  }
}

export function parseIosDeviceLockState(value: unknown): { locked: boolean } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = (value as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return undefined;
  const passcodeRequired = (result as Record<string, unknown>).passcodeRequired;
  return typeof passcodeRequired === "boolean" ? { locked: passcodeRequired } : undefined;
}

/**
 * CoreDevice can report a connected iPad while its screen is locked. Check the
 * cheap, read-only state before starting Xcode's much slower test-runner path.
 * Failure to read this optional signal is non-fatal; the runner remains the
 * authoritative readiness check.
 */
async function assertIosDeviceReadyForAutomation(udid: string): Promise<void> {
  const directory = await mkdtemp(join(homedir(), ".relay-ios-lock-"));
  const output = join(directory, "lock-state.json");
  try {
    await execFileAsync(
      "xcrun",
      [
        "devicectl",
        "device",
        "info",
        "lockState",
        "--device",
        udid,
        "--timeout",
        "8",
        "--json-output",
        output,
      ],
      { timeout: 10_000, maxBuffer: 64 * 1024 },
    );
    const state = parseIosDeviceLockState(JSON.parse(await readFile(output, "utf8")));
    if (state?.locked) {
      throw new IosDeviceAttentionError(
        "Unlock this iPad before Relay starts device control. Keep it awake until the Automation Running indicator appears.",
      );
    }
  } catch (error) {
    if (error instanceof IosDeviceAttentionError) throw error;
    // CoreDevice lock inspection is best-effort. Runner startup below retains
    // the detailed native failure when this lightweight probe is unavailable.
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function iosRunnerSetupMessage(cause: string): string {
  if (/conflicting provisioning settings|automatically signed.*manually specified/i.test(cause)) {
    return "Xcode automatic signing is fighting AGENT_DEVICE_IOS_SIGNING_IDENTITY in the agent-device daemon environment (often inherited from your shell). Unset that variable, restart the agent-device daemon (or re-save Apple setup in Settings so Relay restarts it), and retry. Only set a signing identity together with a matching provisioning profile.";
  }
  if (/developer mode/i.test(cause)) {
    return "Turn on Developer Mode on this iPad, then reconnect it and try again.";
  }
  if (/developer disk image/i.test(cause)) {
    return "Unlock this iPad and wait for Xcode to finish preparing device support, then try again.";
  }
  if (/no account for team|valid credentials|sign into .*xcode|account.*xcode/i.test(cause)) {
    return "Xcode is not signed in to this Apple team. Open Xcode → Settings → Accounts, sign in to the team shown in Relay, then try again.";
  }
  if (/no profiles? for|provisioning profiles? matching/i.test(cause)) {
    return "Xcode could not create a development profile for Relay’s local runner. Sign in to the Apple team in Xcode, then try again.";
  }
  if (
    /provisioning profile|code sign|signing identity|apple team|AGENT_DEVICE_IOS_|build-for-testing|xcodebuild/i.test(
      cause,
    )
  ) {
    return "Relay could not sign its local iPad runner. Check the Apple setup in Settings, then try again.";
  }
  return "Relay could not prepare this iPad yet. Reconnect it and try again.";
}

function isIosDeveloperDiskImageFailure(message: string): boolean {
  return /developer\s+(?:disk|support)\s+image|ddi\s+services|coredevice(?:error)?[^\n]{0,80}12040|kAMDMobileImageMounterMissingImagePath|could not support development|image could not be mounted/i.test(
    message,
  );
}

function iosDeveloperDiskImageMessage(cause: string): string {
  const code = /(?:coredevice(?:error)?[^\n]{0,80}12040|\b12040\b)/i.test(cause)
    ? " (CoreDevice 12040)"
    : "";
  return `Relay could not mount Apple’s developer support image for this iPad${code}. Keep it unlocked and cabled, then let Xcode finish preparing the device. If it remains unavailable, install or update Xcode device support for this iPadOS version, then press Reconnect.`;
}

function isIosXCTestSessionUnavailableFailure(message: string): boolean {
  return /iOS\s+snapshot\s+(?:needs|requires)\s+an\s+active\s+XCTest\s+session|no\s+active\s+XCTest\s+session/i.test(
    message,
  );
}

function valueFrom(result: unknown, key: "path" | "warning"): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const value = (result as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * agent-device intentionally returns a compact error for runner preparation,
 * while xcodebuild writes the actionable cause to its per-session log. Read a
 * *fresh* log only after that compact error so Relay can distinguish a missing
 * Xcode account from an unplugged iPad without exposing the full build log.
 */
function iosSessionName(udid: string): string {
  const identity = udid
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `relay-ios-${identity || "target"}`;
}

async function recentIosRunnerFailure(udid?: string): Promise<string | undefined> {
  const stateDir = process.env.AGENT_DEVICE_STATE_DIR?.trim() || join(homedir(), ".agent-device");
  const configuredSession = process.env.AGENT_DEVICE_SESSION?.trim();
  // `createDevice` isolates every physical target into its own agent-device
  // session. The old generic lookup missed exactly the log produced by the
  // selected iPad, so a precise Xcode account failure became a vague signing
  // message. Prefer the target session, then an explicit caller override.
  const sessions = [
    ...(udid ? [iosSessionName(udid)] : []),
    ...(configuredSession ? [configuredSession] : []),
    "relay-actions",
  ].filter((session, index, values) => values.indexOf(session) === index);

  for (const session of sessions) {
    const path = join(stateDir, "sessions", session, "runner.log");
    try {
      const info = await stat(path);
      if (Date.now() - info.mtimeMs > 60_000) continue;
      const tail = (await readFile(path, "utf8")).slice(-32_768);
      // runner.log is reused across launches. Only the newest xcodebuild
      // invocation can explain the operation that just failed; an old signing
      // line must not turn a later app-session error into fake setup work.
      const invocation = tail.lastIndexOf("Command line invocation:");
      const log = invocation >= 0 ? tail.slice(invocation) : tail;
      if (/no account for team|valid credentials/i.test(log)) {
        return "No Account for Team";
      }
      if (/developer mode/i.test(log)) {
        return "Developer Mode disabled";
      }
      if (isIosDeveloperDiskImageFailure(log)) {
        return /(?:coredevice(?:error)?[^\n]{0,80}12040|\b12040\b)/i.test(log)
          ? "CoreDeviceError 12040: developer disk image unavailable"
          : "Developer disk image unavailable";
      }
      if (/no profiles? for|provisioning profiles? matching/i.test(log)) {
        return "No profiles for Relay's local runner";
      }
      if (/automatically signed.*manually specified|conflicting provisioning settings/i.test(log)) {
        return "Automatically signed runner has a manually specified signing identity";
      }
    } catch {
      // This candidate is optional; try the next known session before falling
      // back to the compact SDK error.
    }
  }
  return undefined;
}

/** Convert noisy Xcode/agent-device configuration failures into product language. */
export function normalizeIosRunnerError(error: unknown): Error {
  if (
    error instanceof IosDeveloperDiskImageError ||
    error instanceof IosXCTestSessionUnavailableError ||
    error instanceof IosRunnerSetupError ||
    error instanceof IosDeviceAttentionError
  ) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (isIosDeveloperDiskImageFailure(message)) {
    return new IosDeveloperDiskImageError(message);
  }
  if (
    /artifact restored but runner did not connect|runner did not accept connection|test runner hung before establishing connection/i.test(
      message,
    )
  ) {
    // The runner reached its attach boundary but did not establish a session.
    // That is a bounded XCTest probe failure, not evidence of a physical
    // device failure. Preserve the native cause for diagnostics and let the
    // explicit Reconnect flow re-probe before it considers repair.
    return new IosXCTestSessionUnavailableError(message);
  }
  if (/device.*locked|passcode.*required/i.test(message)) {
    return new IosDeviceAttentionError(
      "Unlock this iPad before Relay starts device control. Keep it awake until the Automation Running indicator appears.",
    );
  }
  if (
    /provisioning profile|code sign|signing identity|apple team|AGENT_DEVICE_IOS_|build-for-testing|xcodebuild|developer mode|developer disk image|no account for team|valid credentials|no profiles? for/i.test(
      message,
    )
  ) {
    return new IosRunnerSetupError(message);
  }
  return error instanceof Error ? error : new Error(message);
}

/**
 * Some agent-device calls prepare the XCTest runner internally, after Relay's
 * explicit preparation has already returned. Enrich those later errors from a
 * freshly written runner log as well, so screenshot, snapshot, and video all
 * present the same actionable setup state.
 */
export async function diagnoseIosRunnerError(error: unknown, udid?: string): Promise<Error> {
  const normalized = normalizeIosRunnerError(error);
  const message = error instanceof Error ? error.message : String(error);
  if (normalized instanceof IosDeveloperDiskImageError) return normalized;

  // A caller can already have normalized the generic XCTest failure before it
  // reaches snapshot capture. It is still worth consulting this target's
  // fresh runner log: a DDI mount failure is actionable, while “Reconnect”
  // alone merely repeats an operation Xcode cannot currently perform.
  if (normalized instanceof IosXCTestSessionUnavailableError) {
    const diagnostic = await recentIosRunnerFailure(udid);
    if (diagnostic && isIosDeveloperDiskImageFailure(diagnostic)) {
      return normalizeIosRunnerError(new Error(diagnostic));
    }
    return normalized;
  }

  // A failed DDI mount is commonly followed by the SDK's generic snapshot
  // error. Consult the fresh, target-specific runner log before displaying
  // that fallback so a person does not keep retrying an unavailable runner.
  if (isIosXCTestSessionUnavailableFailure(message)) {
    const diagnostic = await recentIosRunnerFailure(udid);
    if (diagnostic && isIosDeveloperDiskImageFailure(diagnostic)) {
      return normalizeIosRunnerError(new Error(diagnostic));
    }
    return new IosXCTestSessionUnavailableError(message);
  }

  if (normalized instanceof IosRunnerSetupError) {
    const diagnostic = await recentIosRunnerFailure(udid);
    return diagnostic ? normalizeIosRunnerError(new Error(diagnostic)) : normalized;
  }

  // Session, lease, and app-binding failures are runtime problems. Looking at
  // a recently touched runner.log for every error allowed an older signing
  // line to relabel them as an Xcode-account problem whenever a healthy runner
  // later appended new output. Only enrich errors that actually came from
  // runner preparation.
  if (!/runner|prepare|xcodebuild|build-for-testing|ios-runner/i.test(message)) {
    return error instanceof Error ? error : new Error(message);
  }
  const diagnostic = await recentIosRunnerFailure(udid);
  return diagnostic ? normalizeIosRunnerError(new Error(diagnostic)) : normalized;
}

/**
 * Build and health-check the locally signed XCTest runner. This is deliberate:
 * discovery alone never writes to Xcode or asks for signing access.
 */
export async function prepareIosRunner(device: Device, selection: { udid: string }): Promise<void> {
  try {
    await assertIosDeviceReadyForAutomation(selection.udid);
    await device.command.prepare({
      platform: "ios",
      udid: selection.udid,
      action: "ios-runner",
      timeoutMs: 90_000,
    });
  } catch (error) {
    const diagnostic = await recentIosRunnerFailure(selection.udid);
    throw normalizeIosRunnerError(diagnostic ? new Error(diagnostic) : error);
  }
}

/**
 * Start or stop an iOS XCTest video take. The returned file is an actual video
 * artifact for review/export—not a stream surrogate. `path` is supplied on
 * start so Relay owns where evidence is retained.
 */
export async function recordIosVideo(
  device: Device,
  input: { udid: string; action: "start" | "stop"; path?: string },
): Promise<IosVideoCaptureResult> {
  try {
    const result = await runIosMutationOnce(input.udid, "video", () =>
      device.recording.record(iosRecordingOptions(input)),
    );
    return {
      mode: "recorded-video",
      ...(valueFrom(result, "path") || input.path
        ? { path: valueFrom(result, "path") ?? input.path }
        : {}),
      ...(valueFrom(result, "warning") ? { warning: valueFrom(result, "warning") } : {}),
    };
  } catch (error) {
    const diagnostic = await recentIosRunnerFailure(input.udid);
    throw normalizeIosRunnerError(diagnostic ? new Error(diagnostic) : error);
  }
}

/**
 * Physical Apple targets have one canonical selector: their UDID. Passing the
 * same value through the generic `device` field as well makes agent-device
 * compare two selector forms, reject its existing binding, and discard the
 * active app session that recording needs.
 */
export function iosRecordingOptions(input: {
  udid: string;
  action: "start" | "stop";
  path?: string;
}): Parameters<Device["recording"]["record"]>[0] {
  return {
    platform: "ios",
    udid: input.udid,
    action: input.action,
    ...(input.path ? { path: input.path } : {}),
    fps: 30,
    quality: "high",
  } as Parameters<Device["recording"]["record"]>[0];
}

/** Best-effort interface orientation from CoreDevice (for screenshot upright bake). */
export async function readIosDisplayOrientation(udid: string): Promise<string | undefined> {
  const out = join(
    tmpdir(),
    `relay-ios-display-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  try {
    await execFileAsync(
      "xcrun",
      [
        "devicectl",
        "device",
        "info",
        "displays",
        "--device",
        udid,
        "--timeout",
        "8",
        "--json-output",
        out,
      ],
      { timeout: 12_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const raw = await readFile(out, "utf8").catch(() => "");
    try {
      const data = JSON.parse(raw) as unknown;
      const found = findDisplayOrientation(data);
      if (found) return found;
    } catch {
      /* fall through to text */
    }
    const match = raw.match(/currentOrientation\s*[:=]\s*"?([A-Za-z0-9]+)"?/i);
    return match?.[1];
  } catch {
    return undefined;
  } finally {
    await rm(out, { force: true }).catch(() => undefined);
  }
}

function findDisplayOrientation(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDisplayOrientation(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["currentOrientation", "orientation", "interfaceOrientation"]) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const child of Object.values(record)) {
    const found = findDisplayOrientation(child);
    if (found) return found;
  }
  return undefined;
}
