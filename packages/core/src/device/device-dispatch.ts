import type { Device } from "./device-capabilities.js";
import { bindNativeDeviceMutations } from "./device-mutation-adapter.js";
import * as observationDevice from "./device-observation-membrane.js";
import {
  currentIosDeviceSerial,
  IosMutationOutcomeUnknownError,
  runIosMutationOnce,
  type IosMutationOperation,
} from "../ios/ios-mutation-policy.js";
import { cooperativeCheckpoint, raceCancel, throwIfCancelled } from "../execution/control.js";
import { withRetry, type RetryOptions } from "../execution/retry.js";
import { currentTargetContext, selectedPlatform } from "../target/target-context.js";
import {
  InputNotDispatchedError,
  InputOutcomeUnknownError,
  isTerminalInputError,
} from "./input-not-dispatched.js";
import { iosSelectorWasNotDispatched } from "../ios/ios-mutation-policy.js";
import { isTargetUnavailableError } from "../target/target-unavailable.js";

/** Dispatcher-private native transport; physical input stays below the exact-once dispatcher. */
export type DeviceTransport = Device & ReturnType<typeof bindNativeDeviceMutations>;

export function nativeDevice(device: Device): DeviceTransport {
  return (observationDevice.canonicalDeviceSource(device) ?? device) as DeviceTransport;
}

export function base() {
  const context = currentTargetContext();
  const platform =
    context.kind === "device" || context.kind === "cloud" ? context.platform : "android";
  const serial = context.kind === "device" ? context.serial : undefined;
  return platform === "ios"
    ? ({ platform, ...(serial ? { udid: serial } : {}) } as const)
    : ({ platform, ...(serial ? { serial } : {}) } as const);
}

/**
 * The vendored daemon resolves every selector against its own fresh capture
 * and actuates the resolved point; its admission probe refuses controls it
 * marks non-hittable (SwiftUI rows) unless the allowance travels with the
 * dispatch. The SDK maps press options → daemon flags via a shallow merge:
 * `maestro` must be a top-level press field, not nested under `flags`.
 * No snapshot point is attached: `expectedTapPoint` is only read by the
 * click-only direct-iOS runner route Relay does not exercise, so passing it
 * here could never steer anything.
 */
export function iosNonHittablePressFields(): Record<string, unknown> {
  if (selectedPlatform() !== "ios") return {};
  return {
    maestro: {
      allowNonHittableCoordinateFallback: true,
    },
  };
}

/**
 * Retry an operation only when it is a read or a non-iOS mutation with an
 * established idempotency contract. Physical iOS input must use
 * {@link controlledMutation} so a lost acknowledgement never becomes a
 * second tap, swipe, or text entry.
 */
export async function controlled<T>(
  op: () => Promise<T>,
  retryOptions: RetryOptions = {},
): Promise<T> {
  return withRetry(
    async () => {
      await cooperativeCheckpoint();
      throwIfCancelled();
      return await raceCancel(op());
    },
    {
      attempts: retryOptions.attempts ?? Number(process.env.RELAY_RETRY_ATTEMPTS ?? 3),
      baseDelayMs: retryOptions.baseDelayMs ?? Number(process.env.RELAY_RETRY_DELAY_MS ?? 350),
      ...(retryOptions.onRetry ? { onRetry: retryOptions.onRetry } : {}),
    },
  );
}

/**
 * Physical mutations are single-attempt on every platform. A transport error
 * after dispatch has an unknown outcome, so the generic transient retry loop
 * is unsafe for taps, clicks, text entry, and other input. Callers that have
 * an explicit idempotency contract can use `controlled` directly.
 */
export async function controlledMutation<T>(
  operation: IosMutationOperation,
  op: () => Promise<T>,
): Promise<T> {
  const serial = currentIosDeviceSerial();
  if (serial) return runIosMutationOnce(serial, operation, op);
  await cooperativeCheckpoint();
  throwIfCancelled();
  try {
    return await raceCancel(op());
  } catch (error) {
    if (
      error instanceof Error &&
      (error instanceof IosMutationOutcomeUnknownError ||
        isTerminalInputError(error) ||
        error instanceof InputNotDispatchedError ||
        error.name === "JobCancelledError" ||
        iosSelectorWasNotDispatched(error) ||
        isTargetUnavailableError(error))
    ) {
      throw error;
    }
    throw new InputOutcomeUnknownError(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
}
