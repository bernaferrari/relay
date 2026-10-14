import type { RelayClient } from "@relay/client";
import { nativePreviewDimensions } from "./live-native-preview-input";

export type NativeLiveControl = {
  ready: boolean;
  message?: string;
  recoverable?: boolean;
};

/** Prove input admission separately from pixels. This reads only; it never
 * takes over a lease, repairs a runner, or repeats an uncertain action. */
export async function checkNativeLiveControl(
  client: Pick<RelayClient, "invoke">,
  serial: string,
  platform: "android" | "ios",
): Promise<NativeLiveControl> {
  const { health } = await client.invoke("target.health.get", { serial });
  if (health.control.state === "held-by-other")
    return { ready: false, message: "Device is in use by another session.", recoverable: false };
  if (health.input.state !== "ready")
    return {
      ready: false,
      message: "Check the device: the last input needs review.",
      recoverable: false,
    };
  if (platform === "ios") {
    try {
      await nativePreviewDimensions(client, serial, platform);
    } catch {
      return { ready: false, message: "View only", recoverable: true };
    }
  }
  return { ready: true };
}
