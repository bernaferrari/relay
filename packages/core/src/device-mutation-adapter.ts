import type { createAgentDeviceClient } from "agent-device";
import { getExecutingJobId, raceCancel } from "./control.js";
import { runTargetMutation } from "./target-control.js";
import { dispatchSupervisedIosMutation } from "./ios-mutation-policy.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

type NativeDevice = ReturnType<typeof createAgentDeviceClient>;
/**
 * The SDK's mutating transport surface. It remains module-private; the
 * canonical dispatcher infers it from `bindNativeDeviceMutations`, while
 * workflow code receives only the smaller `Device` observation facade.
 */
type NativeDeviceMutations = Pick<
  NativeDevice,
  "devices" | "apps" | "interactions" | "command" | "settings" | "recording"
>;
const execFileAsync = promisify(execFile);

/**
 * Bind every mutating SDK capability to the target's exclusive job lane.
 *
 * The owning job is read per call, never captured here. One client is cached
 * per target and outlives the job that happened to create it, so a bound id
 * would attribute a later job's taps to an earlier one — or, when a manual
 * interact built the client, to no job at all. Either way the next automated
 * run is locked out of the device by its own reservation.
 */
export function bindNativeDeviceMutations(
  native: NativeDevice,
  targetId: string,
): NativeDeviceMutations {
  const mutate = <T>(operation: () => Promise<T>) =>
    runTargetMutation(targetId, getExecutingJobId(), () =>
      dispatchSupervisedIosMutation(targetId, operation),
    );
  return {
    devices: { ...native.devices, boot: (options) => mutate(() => native.devices.boot(options)) },
    apps: {
      ...native.apps,
      open: (options) => mutate(() => native.apps.open(options)),
      close: (options) => mutate(() => native.apps.close(options)),
    },
    interactions: {
      ...native.interactions,
      press: (options) => mutate(() => native.interactions.press(options)),
      longPress: (options) => mutate(() => native.interactions.longPress(options)),
      fill: (options) => mutate(() => native.interactions.fill(options)),
      type: (options) => mutate(() => native.interactions.type(options)),
      find: (options) => mutate(() => native.interactions.find(options)),
      scroll: (options) => mutate(() => native.interactions.scroll(options)),
      swipe: (options) => mutate(() => native.interactions.swipe(options)),
      pan: (options) => mutate(() => native.interactions.pan(options)),
    },
    command: {
      ...native.command,
      back: (options) => mutate(() => native.command.back(options)),
      home: (options) => mutate(() => native.command.home(options)),
      clipboard: (options) => mutate(() => native.command.clipboard(options)),
      keyboard: (options) => mutate(() => native.command.keyboard(options)),
      alert: (options) => mutate(() => native.command.alert(options)),
      appSwitcher: (options) => mutate(() => native.command.appSwitcher(options)),
      rotate: (options) => mutate(() => native.command.rotate(options)),
      prepare: (options) => mutate(() => native.command.prepare(options)),
    },
    settings: { update: (options) => mutate(() => native.settings.update(options)) },
    recording: {
      ...native.recording,
      record: (options) => mutate(() => native.recording.record(options)),
    },
  };
}

/** Clear an Android field atomically so another job cannot interleave key events. */
export async function clearAndroidTextWithAdb(serial: string, jobId: string | null): Promise<void> {
  await runTargetMutation(serial, jobId, async () => {
    const keyevent = (keys: string[]) =>
      raceCancel(execFileAsync("adb", ["-s", serial, "shell", "input", "keyevent", ...keys]));
    await keyevent(["KEYCODE_MOVE_HOME"]);
    await keyevent(Array.from({ length: 512 }, () => "KEYCODE_DPAD_UP"));
    await keyevent(["KEYCODE_MOVE_HOME"]);
    for (let remaining = 4096; remaining > 0; remaining -= 128) {
      await keyevent(Array.from({ length: Math.min(128, remaining) }, () => "KEYCODE_FORWARD_DEL"));
    }
  });
}
