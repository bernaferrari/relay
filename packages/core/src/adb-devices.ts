import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AndroidConnectionState = "connected" | "unauthorized" | "offline";

export type AdbDeviceObservation = {
  serial: string;
  name: string;
  kind: "Emulator" | "Physical device";
  connectionState: AndroidConnectionState;
};

function readableModel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replaceAll("_", " ").trim() || undefined;
}

/** Parse `adb devices -l`, including hardware that cannot be controlled yet.
 * The agent-device inventory intentionally omits unauthorized devices, while a
 * target picker must keep them visible so the user can authorize the phone. */
export function parseAdbDevices(output: string): AdbDeviceObservation[] {
  const observations: AdbDeviceObservation[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("List of devices") || line.startsWith("* daemon")) continue;

    const match = /^(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(line);
    if (!match?.[1] || !match[2]) continue;

    const [, serial, adbState, details = ""] = match;
    const model = /(?:^|\s)model:(\S+)/.exec(details)?.[1];
    const connectionState: AndroidConnectionState =
      adbState === "device"
        ? "connected"
        : adbState === "unauthorized"
          ? "unauthorized"
          : "offline";

    observations.push({
      serial,
      name: readableModel(model) ?? "Android device",
      kind: serial.startsWith("emulator-") ? "Emulator" : "Physical device",
      connectionState,
    });
  }

  return observations;
}

export async function listAdbDevices(): Promise<AdbDeviceObservation[]> {
  try {
    const { stdout } = await execFileAsync("adb", ["devices", "-l"], {
      timeout: 4_000,
      maxBuffer: 64 * 1024,
    });
    return parseAdbDevices(stdout);
  } catch {
    // iOS-only machines and remote runners may not have ADB. The adapter
    // inventory remains authoritative for every target it can observe.
    return [];
  }
}
