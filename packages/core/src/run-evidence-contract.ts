import type { AndroidEmulatorNetworkCaptureRuntime } from "./android-emulator-network-capture.js";
import type { Device } from "./device.js";
import type { TestJob } from "./session.js";

/** Cancellation tears down the native control session before terminal
 * persistence. Never reuse that adapter for collector finalization; the
 * handle still folds buffered frames, trees, actions, and command attempts. */
export function runEvidenceFinalizationDevice(
  status: TestJob["status"],
  device: Device | undefined,
): Device | undefined {
  return status === "cancelled" ? undefined : device;
}

export type RunEvidenceOptions = {
  /** A physical Apple target shares one XCTest process for observation and
   * control. Starting simulator-style collectors would block that process and
   * can destroy the app state that the flow is about to verify. */
  physicalIos?: boolean;
  /** Override foreground-app discovery in tests or embedded hosts. */
  foregroundAppResolver?: (serial: string) => Promise<string | undefined>;
  /** Injectable managed-emulator packet backend for deterministic hosts and tests. */
  androidPacketRuntime?: AndroidEmulatorNetworkCaptureRuntime;
};
