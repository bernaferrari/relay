/**
 * Session-free iOS point input. `{kind:"point"}` must work when XCTest cannot
 * attach — pixels plus HID are the complete control path, matching Android
 * `rawTap`.
 */
import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultCommandRunner,
  goIosTunnelInfoArgs,
  rememberGoIosTunnelInfoPort,
  type CommandRunner,
} from "./ios-app-launch.js";
import { findWorkspaceRoot } from "./workspace-root.js";

export const IOS_PIXEL_TAP_MISSING_HELPER =
  "iOS point tap uses CoreDevice HID pixels, not XCTest. Build the helper with `pnpm ios-hid-tap:build`. A missing runner is not a reason to retry the tap — recover only if you need the accessibility tree.";

export const IOS_PIXEL_TAP_FAILED =
  "iOS point tap via CoreDevice HID failed. Do not retry the same XCTest press. Recover only if you need the accessibility tree.";

export const IOS_POINT_TAP_RECOVER =
  "iOS point tap cannot land: CoreDevice HID is not on this device, and XCTest is not attached. Recover the runner for a press. Do not reboot the iPad.";

export type IosPixelTapInput = {
  serial: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  run?: CommandRunner;
  bin?: string;
  timeoutMs?: number;
};

export type IosPixelTap = (input: IosPixelTapInput) => Promise<void>;

let injectedTap: IosPixelTap | undefined;

export function setIosPixelTapForTests(tap?: IosPixelTap): void {
  injectedTap = tap;
}

export async function resolveIosHidTapBinary(): Promise<string> {
  const fromEnv = process.env.RELAY_IOS_HID_TAP_BIN?.trim();
  if (fromEnv) {
    try {
      await access(fromEnv);
      return fromEnv;
    } catch {
      throw new Error(IOS_PIXEL_TAP_MISSING_HELPER);
    }
  }
  const built = join(findWorkspaceRoot(), ".relay", "bin", "relay-ios-hid-tap");
  try {
    await access(built);
    return built;
  } catch {
    throw new Error(IOS_PIXEL_TAP_MISSING_HELPER);
  }
}

function hidTapArgs(input: IosPixelTapInput): string[] {
  const args = ["--udid", input.serial, "--x", String(input.x), "--y", String(input.y)];
  if (input.width && input.width > 0 && input.height && input.height > 0) {
    args.push("--width", String(input.width), "--height", String(input.height));
  }
  return args;
}

export function iosErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "cause" in error && error.cause !== undefined) {
    const cause = iosErrorMessage(error.cause);
    if (cause) return cause;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Proven pre-dispatch HID refusal. XCTest may still be the first input. */
export class IosHidUnavailableError extends Error {
  readonly dispatch = "not-dispatched" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "IosHidUnavailableError";
  }
}

export type IosHidTapDispatch =
  | { status: "completed" }
  | { status: "not-dispatched"; error: IosHidUnavailableError }
  | { status: "outcome-unknown"; error: Error };

/** This DDI/host cannot deliver a CoreDevice HID press — fall back to XCTest. */
export function isIosHidUnavailable(error: unknown): boolean {
  if (error instanceof IosHidUnavailableError) return true;
  const message = iosErrorMessage(error);
  return (
    /universalhidservice|dtuhidd|not available in RSD|ios-hid-tap:build/i.test(message) ||
    message.includes(IOS_PIXEL_TAP_MISSING_HELPER)
  );
}

function asHidUnavailable(error: unknown): IosHidUnavailableError {
  return error instanceof IosHidUnavailableError
    ? error
    : new IosHidUnavailableError(iosErrorMessage(error), { cause: error });
}

/**
 * Dispatch one HID point tap and report whether the press left this process.
 * Callers must not treat `not-dispatched` and `outcome-unknown` as the same
 * fallback: only a proven pre-dispatch refusal may try XCTest next.
 */
export async function dispatchIosHidTap(input: IosPixelTapInput): Promise<IosHidTapDispatch> {
  try {
    await tapIosPointViaPixels(input);
    return { status: "completed" };
  } catch (error) {
    if (isIosHidUnavailable(error)) {
      return { status: "not-dispatched", error: asHidUnavailable(error) };
    }
    return {
      status: "outcome-unknown",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export function iosPointTapRecoverError(hidError?: unknown, xctestError?: unknown): Error {
  const hid = hidError ? iosErrorMessage(hidError) : "";
  const xctest = xctestError ? iosErrorMessage(xctestError) : "";
  const detail = [hid, xctest].filter(Boolean).join(" ");
  return new Error(detail ? `${IOS_POINT_TAP_RECOVER} ${detail}` : IOS_POINT_TAP_RECOVER);
}

export async function tapIosPointViaPixels(input: IosPixelTapInput): Promise<void> {
  if (injectedTap) {
    await injectedTap(input);
    return;
  }
  if (!input.serial) throw new Error("Explicit iOS target serial is required");
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
    throw new Error("iOS point tap requires finite x and y screenshot pixels");
  }
  const run = input.run ?? defaultCommandRunner;
  const bin = input.bin ?? (await resolveIosHidTapBinary());
  if (!input.run) await rememberGoIosTunnelInfoPort();
  const result = await run(
    bin,
    [...hidTapArgs(input), ...goIosTunnelInfoArgs()],
    input.timeoutMs ?? 15_000,
  );
  if (result.exitCode === 0) return;
  const detail = (result.stderr || result.stdout || `hid tap exited ${result.exitCode}`).trim();
  // The helper refuses before send when backboardd would drop the report.
  // That is not a failed tap and must not wear the "do not XCTest" wrapper.
  if (isIosHidUnavailable(detail)) throw new IosHidUnavailableError(detail);
  throw new Error(`${IOS_PIXEL_TAP_FAILED} ${detail}`);
}
