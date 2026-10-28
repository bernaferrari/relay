import type { createAgentDeviceClient } from "agent-device";
import { getExecutingJobId, raceCancel } from "./control.js";
import { runTargetMutation } from "./target-control.js";
import { dispatchSupervisedIosMutation } from "./ios-mutation-policy.js";
import { resolveAndroidSdkTool } from "./android-sdk-tools.js";
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
  platform: "android" | "ios",
): NativeDeviceMutations {
  const mutate = <T>(operation: () => Promise<T>) =>
    runTargetMutation(targetId, getExecutingJobId(), () =>
      platform === "ios" ? dispatchSupervisedIosMutation(targetId, operation) : operation(),
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
      orientation: (options) => mutate(() => native.command.orientation(options)),
      prepare: (options) => mutate(() => native.command.prepare(options)),
    },
    settings: { update: (options) => mutate(() => native.settings.update(options)) },
    recording: {
      ...native.recording,
      record: (options) => mutate(() => native.recording.record(options)),
    },
  };
}

type AndroidInput = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

async function androidInput(serial: string): Promise<AndroidInput> {
  const adb = await resolveAndroidSdkTool("adb");
  return (args) => raceCancel(execFileAsync(adb, ["-s", serial, "shell", "input", ...args]));
}

/** `input keycombination` exists from Android 12; older shells print usage instead of failing. */
async function keyCombination(input: AndroidInput, keys: string[]): Promise<boolean> {
  try {
    const { stdout, stderr } = await input(["keycombination", ...keys]);
    return !/unknown command|usage:|error/i.test(`${stdout}\n${stderr}`);
  } catch {
    return false;
  }
}

async function repeatKey(input: AndroidInput, key: string, count: number): Promise<void> {
  for (let remaining = count; remaining > 0; remaining -= 128) {
    await input(["keyevent", ...Array.from({ length: Math.min(128, remaining) }, () => key)]);
  }
}

/**
 * Clear the focused Android field atomically so another job cannot interleave
 * key events. Select-all + delete is one gesture on every modern field; the
 * bounded fallback deletes both sides of the caret without arrow keys, which
 * Compose routes to focus traversal (opening drawers) once the text ends.
 */
export async function clearAndroidTextWithAdb(
  serial: string,
  jobId: string | null,
  knownLength?: number,
): Promise<void> {
  await runTargetMutation(serial, jobId, async () => {
    const input = await androidInput(serial);
    if (await keyCombination(input, ["KEYCODE_CTRL_LEFT", "KEYCODE_A"])) {
      await input(["keyevent", "KEYCODE_DEL"]);
      return;
    }
    const count = Math.min(4096, (knownLength ?? 1024) + 16);
    await input(["keyevent", "KEYCODE_MOVE_END"]);
    await repeatKey(input, "KEYCODE_DEL", count);
    await input(["keyevent", "KEYCODE_MOVE_HOME"]);
    await repeatKey(input, "KEYCODE_FORWARD_DEL", count);
  });
}

/** Put the caret after the existing value so typing appends instead of splitting it. */
export async function moveAndroidCaretToEnd(serial: string, jobId: string | null): Promise<void> {
  await runTargetMutation(serial, jobId, async () => {
    const input = await androidInput(serial);
    if (await keyCombination(input, ["KEYCODE_CTRL_LEFT", "KEYCODE_MOVE_END"])) return;
    await input(["keyevent", "KEYCODE_MOVE_END"]);
  });
}
