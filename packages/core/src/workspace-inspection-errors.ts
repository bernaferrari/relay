import { isIosAccessibilityQueryInFlightError } from "./device.js";
import {
  diagnoseIosRunnerError,
  IosDeviceAttentionError,
  IosRunnerSetupError,
  IosXCTestSessionUnavailableError,
} from "./ios-device-adapter.js";

/** A timed-out agent-device helper may still own Android's sole UiAutomation
 * slot. Starting Relay's second helper in that state creates a deterministic
 * ownership collision, so this failure must remain semantic-unavailable until
 * explicit target recovery retires the original owner. */
export function isAndroidSnapshotOwnershipUnreleased(error: unknown, depth = 0): boolean {
  if (depth > 4 || !error || typeof error !== "object") return false;
  const record = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    cause?: unknown;
  };
  if (
    record.code === "android_snapshot_helper_retirement_unconfirmed" ||
    (typeof record.message === "string" &&
      /could not confirm release of device automation ownership/iu.test(record.message))
  ) {
    return true;
  }
  return (
    isAndroidSnapshotOwnershipUnreleased(record.details, depth + 1) ||
    isAndroidSnapshotOwnershipUnreleased(record.cause, depth + 1)
  );
}

/**
 * iOS runner diagnostics may contain Xcode paths and raw daemon output. The
 * snapshot API exposes only errors that were converted to product-safe copy
 * (or Relay's own single-flight guard), never the original native message.
 */
export async function iosInspectionErrorMessage(
  error: unknown,
  serial: string | undefined,
): Promise<string | undefined> {
  if (!error) return undefined;
  if (isIosAccessibilityQueryInFlightError(error)) return error.message;
  const diagnosed = await diagnoseIosRunnerError(error, serial).catch(() => undefined);
  if (
    diagnosed instanceof IosRunnerSetupError ||
    diagnosed instanceof IosDeviceAttentionError ||
    diagnosed instanceof IosXCTestSessionUnavailableError
  ) {
    return diagnosed.message;
  }
  return undefined;
}
