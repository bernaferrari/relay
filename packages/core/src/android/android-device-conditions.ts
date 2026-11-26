import { execAndroidAdb } from "./android-adb-host.js";
import {
  androidInspectionState,
  wakeAndroidDisplay,
  type AndroidInspectionState,
} from "./android-ui-snapshot.js";

export type DeviceDisplayCondition = "on" | "asleep" | "locked" | "unknown";
export type DeviceConnectivity = "online" | "offline" | "airplane" | "unknown";
export type AndroidNetworkMode = "airplane" | "wifi-off" | "data-off" | "restore";
export type AndroidDisplayMode = "wake" | "keep-awake" | "release";

export type AndroidNetworkState = {
  connectivity: DeviceConnectivity;
  airplane: boolean;
  wifi: boolean;
  data: boolean;
};

export type AndroidDisplayState = {
  display: DeviceDisplayCondition;
  stayAwake: boolean;
};

type Adb = (serial: string, command: string) => Promise<string>;

const shell: Adb = async (serial, command) =>
  (
    await execAndroidAdb(["-s", serial, "shell", command], {
      timeout: 5_000,
      maxBuffer: 256 * 1024,
    })
  ).stdout.trim();

/** Network settings in effect before Relay first changed them, per device. */
const networkBaseline = new Map<string, AndroidNetworkState>();
/** `stay_on_while_plugged_in` before keep-awake, per device. */
const stayOnBaseline = new Map<string, string>();

export function displayCondition(state: AndroidInspectionState): DeviceDisplayCondition {
  switch (state) {
    case "active":
      return "on";
    case "asleep":
      return "asleep";
    case "keyguard":
      return "locked";
    case "unavailable":
    case "unknown":
      return "unknown";
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

/** Why a frame from this display is not evidence of the app, if it is not. */
export function displayWarning(display: DeviceDisplayCondition): string | undefined {
  switch (display) {
    case "asleep":
      return "The display is off or dozing, so this frame is black. Run `relay device display <serial> wake` (or `keep-awake` for long sessions).";
    case "locked":
      return "The lock screen owns the display, so this frame shows the keyguard, not the app. Unlock the device; Relay cannot enter a PIN.";
    case "on":
    case "unknown":
      return undefined;
    default: {
      const unhandled: never = display;
      return unhandled;
    }
  }
}

export function parseAndroidConnectivity(input: {
  airplane: string;
  wifi: string;
  data: string;
  activeNetwork: string;
}): AndroidNetworkState {
  const airplane = input.airplane === "1";
  const active = /Active default network:\s*(\S+)/u.exec(input.activeNetwork)?.[1];
  const connectivity: DeviceConnectivity =
    active === undefined
      ? "unknown"
      : active !== "none"
        ? "online"
        : airplane
          ? "airplane"
          : "offline";
  return {
    connectivity,
    airplane,
    wifi: input.wifi !== "0" && input.wifi !== "",
    data: input.data === "1",
  };
}

export async function readAndroidNetwork(
  serial: string,
  adb: Adb = shell,
): Promise<AndroidNetworkState> {
  const [airplane, wifi, data, activeNetwork] = await Promise.all([
    adb(serial, "settings get global airplane_mode_on"),
    adb(serial, "settings get global wifi_on"),
    adb(serial, "settings get global mobile_data"),
    adb(serial, "dumpsys connectivity | grep -m1 'Active default network'").catch(() => ""),
  ]);
  return parseAndroidConnectivity({ airplane, wifi, data, activeNetwork });
}

export async function readAndroidDisplay(
  serial: string,
  adb: Adb = shell,
): Promise<AndroidDisplayState> {
  const [policy, stayOn] = await Promise.all([
    adb(serial, "dumpsys window policy").catch(() => undefined),
    adb(serial, "settings get global stay_on_while_plugged_in").catch(() => "0"),
  ]);
  const state = policy === undefined ? "unknown" : androidInspectionState(policy);
  return { display: displayCondition(state), stayAwake: stayOn !== "0" && stayOn !== "" };
}

/** Live display and network facts for health. Never throws. */
export async function readAndroidDeviceConditions(
  serial: string,
): Promise<{ display: DeviceDisplayCondition; connectivity: DeviceConnectivity }> {
  const [display, network] = await Promise.all([
    readAndroidDisplay(serial).catch(() => ({ display: "unknown" as const })),
    readAndroidNetwork(serial).catch(() => ({ connectivity: "unknown" as const })),
  ]);
  return { display: display.display, connectivity: network.connectivity };
}

function networkCommands(mode: AndroidNetworkMode, baseline: AndroidNetworkState): string[] {
  switch (mode) {
    case "airplane":
      return ["cmd connectivity airplane-mode enable"];
    case "wifi-off":
      return ["svc wifi disable"];
    case "data-off":
      return ["svc data disable"];
    case "restore":
      return [
        `cmd connectivity airplane-mode ${baseline.airplane ? "enable" : "disable"}`,
        `svc wifi ${baseline.wifi ? "enable" : "disable"}`,
        `svc data ${baseline.data ? "enable" : "disable"}`,
      ];
    default: {
      const unhandled: never = mode;
      return unhandled;
    }
  }
}

const NETWORK_SETTLE_MS = 1_500;

/** Change radios for offline QA. `restore` returns to the state before Relay's first
 * change, or turns every radio back on when that state was lost (e.g. a server restart). */
export async function setAndroidNetwork(
  serial: string,
  mode: AndroidNetworkMode,
  deps: { adb?: Adb; sleep?: (ms: number) => Promise<void> } = {},
): Promise<AndroidNetworkState> {
  const adb = deps.adb ?? shell;
  const pause = deps.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const recorded = networkBaseline.get(serial);
  const baseline =
    recorded ??
    (mode === "restore"
      ? { connectivity: "online" as const, airplane: false, wifi: true, data: true }
      : await readAndroidNetwork(serial, adb));
  if (mode === "restore") networkBaseline.delete(serial);
  else networkBaseline.set(serial, baseline);
  for (const command of networkCommands(mode, baseline)) await adb(serial, command);
  await pause(NETWORK_SETTLE_MS);
  return readAndroidNetwork(serial, adb);
}

/** Wake the screen, hold it on while plugged in, or hand that setting back. */
export async function setAndroidDisplay(
  serial: string,
  mode: AndroidDisplayMode,
  deps: { adb?: Adb; wake?: (serial: string) => Promise<void> } = {},
): Promise<AndroidDisplayState> {
  const adb = deps.adb ?? shell;
  const wake = deps.wake ?? wakeAndroidDisplay;
  switch (mode) {
    case "wake":
      await wake(serial);
      await adb(serial, "wm dismiss-keyguard").catch(() => "");
      break;
    case "keep-awake": {
      const previous = await adb(serial, "settings get global stay_on_while_plugged_in");
      if (!stayOnBaseline.has(serial)) stayOnBaseline.set(serial, previous);
      if (previous === "0" || previous === "") await adb(serial, "svc power stayon usb");
      await wake(serial);
      break;
    }
    case "release": {
      const previous = stayOnBaseline.get(serial);
      stayOnBaseline.delete(serial);
      if (previous !== undefined) {
        await adb(serial, `settings put global stay_on_while_plugged_in ${previous || "0"}`);
      }
      break;
    }
    default: {
      const unhandled: never = mode;
      return unhandled;
    }
  }
  return readAndroidDisplay(serial, adb);
}

/** Display facts to attach to an Android screenshot. Never throws. */
export async function androidScreenshotDisplay(
  serial: string,
): Promise<{ display: { state: DeviceDisplayCondition; warning?: string } }> {
  const { display } = await readAndroidDisplay(serial).catch(() => ({
    display: "unknown" as const,
  }));
  const warning = displayWarning(display);
  return { display: { state: display, ...(warning ? { warning } : {}) } };
}
