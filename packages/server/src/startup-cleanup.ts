import { reapStaleAndroidEmulatorNetworkCapturesAtStartup } from "@relay/core";

/** Remove only Relay-owned transient PCAPs left by a process that could not
 * run its normal finally block. Failure is non-fatal: capture admission also
 * retries the same bounded cleanup before starting a new packet window. */
export async function cleanupAbandonedAndroidPacketCaptures(): Promise<void> {
  await reapStaleAndroidEmulatorNetworkCapturesAtStartup().catch((error: unknown) => {
    console.warn(
      `Android emulator packet capture startup cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}
