import { cooperativeCheckpoint, getExecutingJobId } from "./control.js";
import {
  assertAdoptedIosMutationIntention,
  dispatchSupervisedIosMutation,
  IosNativeMutationError,
} from "./ios-mutation-policy.js";
import type {
  LiveIosRunnerCommand,
  LiveIosRunnerCommandPost,
  LiveIosRunnerCommandResult,
} from "./ios-runner-listener-command.js";
import type { LiveIosRunnerListener } from "./ios-runner-listener.js";
import { runTargetMutation } from "./target-control.js";

/** Admit and persist only native inputs. Read-only adopted posts bypass this
 * boundary, and the enclosing exact-once intention owns the terminal receipt. */
export function postSupervisedAdoptedIosMutation(
  listener: LiveIosRunnerListener,
  post: LiveIosRunnerCommandPost,
  command: LiveIosRunnerCommand,
  timeoutMs: number,
): Promise<LiveIosRunnerCommandResult> {
  return runTargetMutation(listener.serial, getExecutingJobId(), async () => {
    await cooperativeCheckpoint();
    assertAdoptedIosMutationIntention(listener.serial);
    return dispatchSupervisedIosMutation(listener.serial, async () => {
      let result: LiveIosRunnerCommandResult;
      try {
        result = await post(listener, command, timeoutMs);
      } catch (cause) {
        throw new IosNativeMutationError(
          "Live XCTest listener lost the native mutation acknowledgement",
          undefined,
          "unknown",
          { cause },
        );
      }
      if (result?.ok !== true && result?.ok !== false) {
        throw new IosNativeMutationError(
          "Live XCTest listener returned no mutation acknowledgement",
          undefined,
          "unknown",
        );
      }
      return result;
    });
  });
}

export function adoptedIosMutationFailure(
  result: LiveIosRunnerCommandResult,
  message: string,
): IosNativeMutationError {
  const code = result.error && typeof result.error === "object" ? result.error.code : undefined;
  // These selector refusals precede gestures in the runner contract. Generic
  // failures and message-only lookalikes disclose no such proof.
  const notDispatched =
    result.ok === false &&
    (code === "ELEMENT_NOT_FOUND" || code === "ELEMENT_OFFSCREEN" || code === "AMBIGUOUS_MATCH");
  return new IosNativeMutationError(message, code, notDispatched ? "no" : "unknown");
}
