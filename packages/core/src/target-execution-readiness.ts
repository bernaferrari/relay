import type { TargetRuntimeReadiness } from "@relay/protocol";

export type TargetExecutionReadinessReason =
  | "unsupported-platform"
  | "disconnected"
  | "offline"
  | "unauthorized"
  | "unknown-connection"
  | "not-booted"
  | "developer-mode-disabled"
  | "developer-services-unavailable"
  | "stale-readiness"
  | "runtime-unavailable";

export type TargetExecutionReadiness =
  | { runnable: true }
  | {
      runnable: false;
      reason: TargetExecutionReadinessReason;
      recovery: string;
    };

export type TargetExecutionReadinessInput = {
  platform: string;
  connectionState?: string | null;
  booted?: boolean | null;
  developerMode?: "enabled" | "disabled";
  developerServicesAvailable?: boolean;
  readiness?: TargetRuntimeReadiness;
};

function blockedTarget(
  reason: TargetExecutionReadinessReason,
  recovery: string,
): TargetExecutionReadiness {
  return { runnable: false, reason, recovery };
}

/**
 * Return whether a discovered target is safe to hand to an execution
 * workflow. This policy is deliberately pure so every host can project the
 * same readiness decision without importing device supervision or drivers.
 */
export function targetExecutionReadiness(
  target: TargetExecutionReadinessInput,
): TargetExecutionReadiness {
  if (target.platform !== "android" && target.platform !== "ios") {
    return blockedTarget(
      "unsupported-platform",
      "Select an Android or iOS target for this execution.",
    );
  }

  const connectionState = target.connectionState?.trim().toLocaleLowerCase();
  switch (connectionState) {
    case "disconnected":
      return blockedTarget(
        "disconnected",
        "Reconnect the target, then refresh the target list before retrying.",
      );
    case "offline":
      return blockedTarget(
        "offline",
        "Wake or reconnect the target, then refresh the target list before retrying.",
      );
    case "unauthorized":
      return blockedTarget(
        "unauthorized",
        "Authorize the Android target, then refresh the target list before retrying.",
      );
    case "connected":
    case undefined:
    case "":
      break;
    default:
      return blockedTarget(
        "unknown-connection",
        "Relay cannot verify target connectivity. Refresh the target list before retrying.",
      );
  }

  if (target.booted === false) {
    return blockedTarget(
      "not-booted",
      "Boot the emulator or simulator, then refresh the target list before retrying.",
    );
  }
  if (target.developerMode === "disabled") {
    return blockedTarget(
      "developer-mode-disabled",
      "Enable Developer Mode on the iOS target, then refresh the target list before retrying.",
    );
  }
  if (target.developerServicesAvailable === false) {
    return blockedTarget(
      "developer-services-unavailable",
      "Reconnect the iOS target and make sure its developer services are available before retrying.",
    );
  }

  const readiness = target.readiness;
  if (!readiness) return { runnable: true };
  const capabilities = [
    readiness.previewPixels,
    readiness.semanticControl,
    readiness.evidenceCapture,
  ];
  // A new screen invalidates its old semantic observation, not the connected
  // device. Interaction binding captures a fresh tree before using a selector.
  // Keep unexplained stale runtime proofs blocked.
  if (
    capabilities.some(
      (capability) =>
        capability.freshness === "stale" &&
        !(
          capability === readiness.semanticControl &&
          capability.state === "proven" &&
          (capability.invalidated?.reason === "input-changed" ||
            capability.invalidated?.reason === "visual-changed")
        ),
    )
  ) {
    return blockedTarget(
      "stale-readiness",
      "Refresh the target observation before retrying this execution.",
    );
  }
  if (
    target.platform === "ios" &&
    capabilities.some((capability) => capability.state === "unavailable")
  ) {
    return blockedTarget(
      "runtime-unavailable",
      "Reconnect the iOS target and capture a fresh observation before retrying.",
    );
  }
  return { runnable: true };
}
