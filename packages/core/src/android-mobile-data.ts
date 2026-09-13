import { execAndroidAdb } from "./android-adb-host.js";
import {
  cooperativeCheckpoint,
  getExecutingJobId,
  raceCancel,
  throwIfCancelled,
} from "./control.js";
import { runTargetMutation } from "./target-control.js";
import { currentTargetContext, selectedPlatform, targetIdentity } from "./target-context.js";

/** Toggle Android cellular data through `adb shell svc data`. Wi-Fi remains
 * the existing settings.wifi path. iOS fails closed at the platform seam. */
export function androidMobileDataAdbArgs(serial: string, state: "on" | "off"): string[] {
  return ["-s", serial, "shell", "svc", "data", state === "on" ? "enable" : "disable"];
}

export async function setAndroidMobileData(state: "on" | "off"): Promise<void> {
  if (selectedPlatform() !== "android") {
    throw new Error("settings mobile-data is only supported on Android");
  }
  const context = currentTargetContext();
  if (context.kind === "browser") {
    throw new Error("settings mobile-data is only supported on Android");
  }
  const serial = targetIdentity(context);
  await cooperativeCheckpoint();
  throwIfCancelled();
  await runTargetMutation(serial, getExecutingJobId(), () =>
    raceCancel(execAndroidAdb(androidMobileDataAdbArgs(serial, state), { timeout: 8_000 })),
  );
}
