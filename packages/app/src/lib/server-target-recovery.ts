import type { OperationInput, OperationOutput } from "@relay/protocol";
import type { Accessor } from "solid-js";
import type { DeviceInfo } from "./api-types";
import { humanError } from "./human-error";

export type TargetRecoveryReason = NonNullable<OperationInput<"target.recover">["reason"]>;

/**
 * Keeps target recovery as one serialized, explicit operation. The caller owns
 * the UI state; this controller owns only the target selection, recover action,
 * and post-proof refresh. That makes it impossible for a preview request to
 * quietly inherit repair behavior.
 */
export function createServerTargetRecovery(input: {
  selectedDevice: Accessor<string | null>;
  devices: Accessor<DeviceInfo[]>;
  selectDevice: (serial: string) => Promise<unknown>;
  runAction: (
    operation: "target.recover",
    value: OperationInput<"target.recover">,
  ) => Promise<OperationOutput<"target.recover">>;
  appendLog: (message: string, level: "success" | "error") => void;
  setLiveCaptureIssue: (issue: string | null) => void;
  setControlIssue: (issue: string | null) => void;
  refreshEvidence: () => Promise<void>;
}) {
  let inFlight: Promise<boolean> | null = null;

  return async function recoverSelectedTarget(
    reason: TargetRecoveryReason = "auto",
  ): Promise<boolean> {
    if (inFlight) return inFlight;
    const serial = input.selectedDevice();
    const device = input.devices().find((candidate) => candidate.serial === serial);
    if (!serial || (device?.platform !== "ios" && device?.platform !== "android")) return false;
    const recovery = (async () => {
      try {
        await input.selectDevice(serial);
        const result = await input.runAction("target.recover", { serial, reason });
        input.appendLog(result.recovery.summary, result.recovery.ready ? "success" : "error");
        if (!result.recovery.ready) {
          input.setLiveCaptureIssue(result.recovery.session.detail);
          return false;
        }
        input.setLiveCaptureIssue(null);
        input.setControlIssue(null);
        await input.refreshEvidence();
        return true;
      } catch (error) {
        const message = humanError(error, "Could not reconnect to this device");
        input.setLiveCaptureIssue(message);
        input.appendLog(message, "error");
        return false;
      }
    })();
    inFlight = recovery;
    try {
      return await recovery;
    } finally {
      if (inFlight === recovery) inFlight = null;
    }
  };
}
