/**
 * Relay's Apple-device capture boundary.
 *
 * Android can offer a low-latency scrcpy stream. Apple physical devices use
 * the signed XCTest runner instead: it provides snapshots, interaction, and
 * a high-quality recorded take, but not a misleading pseudo-live H.264 feed.
 * Keep that distinction here so callers do not have to infer it from platform
 * names or runner errors.
 */
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Device } from "./device.js";

export type IosCaptureMode = "snapshot" | "recorded-video";

export type IosVideoCaptureResult = {
  mode: "recorded-video";
  path?: string;
  warning?: string;
};

export class IosRunnerSetupError extends Error {
  readonly code = "ios-runner-setup";

  constructor(readonly causeMessage: string) {
    super(iosRunnerSetupMessage(causeMessage));
    this.name = "IosRunnerSetupError";
  }
}

function iosRunnerSetupMessage(cause: string): string {
  if (/conflicting provisioning settings|automatically signed.*manually specified/i.test(cause)) {
    return "Relay found a manual signing override that conflicts with Xcode automatic signing. Clear the advanced signing options in Settings, then try again.";
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
      if (/developer disk image|ddi services/i.test(log)) {
        return "Developer Disk Image unavailable";
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
  const message = error instanceof Error ? error.message : String(error);
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
    await device.command.prepare({
      platform: "ios",
      udid: selection.udid,
      action: "ios-runner",
      timeoutMs: 240_000,
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
    const result = await device.recording.record(iosRecordingOptions(input));
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
