import { cooperativeCheckpoint, raceCancel, throwIfCancelled } from "../execution/control.js";
import { execAndroidAdb } from "../android/android-adb-host.js";
import { base, controlled, controlledMutation, nativeDevice } from "./device-dispatch.js";
import {
  currentTargetContext,
  selectedPlatform,
  targetIdentity,
} from "../target/target-context.js";
import type {
  Device,
  ModeFreePermissionUpdateOptions,
  SettingsUpdateOptions,
} from "./device-capabilities.js";
import { createDevice } from "./device-client-bindings.js";
import { mutateCurrentTarget } from "./device-target-mutation.js";
import { noteCoordinateActuation, noteDirectActuation } from "./device-activation-transport.js";

export async function closeApp(device: Device, app?: string): Promise<void> {
  await controlledMutation("app-close", () =>
    nativeDevice(device).apps.close({ ...base(), ...(app ? { app } : {}) }),
  );
}

export async function openAppSwitcher(device: Device): Promise<void> {
  await controlledMutation("app-switcher", () =>
    nativeDevice(device).command.appSwitcher({ ...base() }),
  );
}

export async function rotateDevice(
  device: Device,
  orientation: "portrait" | "portrait-upside-down" | "landscape-left" | "landscape-right",
): Promise<void> {
  await controlledMutation("rotate", () =>
    nativeDevice(device).command.orientation({ ...base(), orientation }),
  );
}

export async function keyboardAction(device: Device, action: "dismiss" | "enter"): Promise<void> {
  await controlledMutation("keyboard", () =>
    nativeDevice(device).command.keyboard({ ...base(), action }),
  );
}

export async function alertAction(
  device: Device,
  action: "get" | "accept" | "dismiss" | "wait",
  timeoutMs?: number,
): Promise<unknown> {
  const op = () =>
    nativeDevice(device).command.alert({
      ...base(),
      action,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
  return await (action === "get" || action === "wait"
    ? controlled(op)
    : controlledMutation("alert", op));
}

export async function updateSetting(
  device: Device,
  input: SettingsUpdateOptions | ModeFreePermissionUpdateOptions,
): Promise<unknown> {
  return await controlledMutation("settings", () =>
    (
      nativeDevice(device).settings.update as unknown as (
        value: SettingsUpdateOptions | ModeFreePermissionUpdateOptions,
      ) => Promise<unknown>
    )(input),
  );
}

export async function captureNetwork(
  device: Device,
  options: {
    action: "dump" | "log";
    include?: "summary" | "headers" | "body" | "all";
    limit?: number;
  },
): Promise<unknown> {
  return await controlled(() => device.observability.network({ ...base(), ...options }));
}

export async function manageLogs(
  device: Device,
  options: { action: "start" | "stop" | "mark" | "clear"; message?: string },
): Promise<unknown> {
  return await controlled(() => device.observability.logs({ ...base(), ...options }));
}

/** agent-device intentionally has no public lock-screen command yet. Its own
 * CLI guidance allows a platform bridge for command gaps; keep that bridge
 * isolated here so recipes still have one capability surface. */
export async function setAndroidLockState(action: "lock" | "unlock"): Promise<void> {
  if (selectedPlatform() !== "android") {
    throw new Error(
      "capability unavailable: lock-screen control is not supported by this iOS runner",
    );
  }
  const serial = targetIdentity();
  const args = ["-s", serial, "shell", "input", "keyevent", action === "lock" ? "223" : "224"];
  await cooperativeCheckpoint();
  throwIfCancelled();
  await mutateCurrentTarget(() => raceCancel(execAndroidAdb(args)));
  if (action === "unlock") {
    await mutateCurrentTarget(() =>
      raceCancel(execAndroidAdb(["-s", serial, "shell", "input", "keyevent", "82"])),
    );
  }
}

/** Swipe from one point to another over `durationMs`. Follows pressPoint style. */
export async function swipeGesture(
  device: Device,
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationMs = 250,
): Promise<void> {
  // agent-device 0.20 models timed coordinate movement as a pan. Its raw
  // swipe command is now a repeated preset gesture and intentionally has no
  // duration field.
  await controlledMutation("swipe", () =>
    nativeDevice(device).interactions.pan({
      ...base(),
      x: from.x,
      y: from.y,
      dx: to.x - from.x,
      dy: to.y - from.y,
      durationMs,
    }),
  );
  noteCoordinateActuation({ operation: "swipe", provenance: "explicit-point", channel: "daemon" });
}

export async function sleep(ms: number, device: Device = createDevice()): Promise<void> {
  // Small chunks = faster cancel/pause response
  const chunk = 100;
  let left = Math.max(0, ms);
  while (left > 0) {
    await cooperativeCheckpoint();
    const step = Math.min(chunk, left);
    await raceCancel(device.command.wait({ ...base(), durationMs: step }));
    left -= step;
  }
  await cooperativeCheckpoint();
}

export async function openUrl(device: Device, url: string): Promise<void> {
  await controlledMutation("url-open", () => nativeDevice(device).apps.open({ ...base(), url }));
  await sleep(2500, device);
}

export async function screenshot(device: Device, path: string): Promise<void> {
  await controlled(() => device.capture.screenshot({ path }));
}

export async function pressKey(device: Device, key: "back" | "home" | "recents"): Promise<void> {
  if (key === "recents") {
    if (currentTargetContext().kind === "browser" || selectedPlatform() !== "android") {
      throw new Error("Recents is only available on Android devices.");
    }
    const serial = targetIdentity();
    await controlled(() =>
      mutateCurrentTarget(() =>
        raceCancel(
          execAndroidAdb(["-s", serial, "shell", "input", "keyevent", "KEYCODE_APP_SWITCH"]),
        ),
      ),
    );
    noteDirectActuation("key", "adb");
    return;
  }
  if (key === "back") {
    await controlledMutation("back", () => nativeDevice(device).command.back({ ...base() }));
  } else {
    await controlledMutation("home", () => nativeDevice(device).command.home({ ...base() }));
  }
  noteDirectActuation("key", "daemon");
}
