import { createAgentDeviceClient } from "agent-device";
import { raceCancel } from "./control.js";
import { runTargetMutation } from "./target-control.js";
import type { Device } from "./device.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

type NativeDevice = ReturnType<typeof createAgentDeviceClient>;
const execFileAsync = promisify(execFile);

/** Bind every mutating SDK capability to the target's exclusive job lane. */
export function bindNativeDeviceMutations(
  native: NativeDevice,
  targetId: string,
  jobId: string | null,
): Pick<Device, "devices" | "apps" | "interactions" | "command" | "settings" | "recording"> {
  const mutate = <T>(operation: () => Promise<T>) => runTargetMutation(targetId, jobId, operation);
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
    recording: { record: (options) => mutate(() => native.recording.record(options)) },
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
