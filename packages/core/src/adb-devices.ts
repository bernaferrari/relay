import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { androidDeviceDisplayName } from "@relay/protocol";
import { resolveAndroidSdkTool } from "./android-sdk-tools.js";

const execFileAsync = promisify(execFile);

export type AndroidConnectionState = "connected" | "unauthorized" | "offline";

export type AdbDeviceObservation = {
  serial: string;
  name: string;
  kind: "Emulator" | "Physical device";
  connectionState: AndroidConnectionState;
};

export type AdbDeviceInventory = {
  devices: AdbDeviceObservation[];
  /** A successful empty response means Android really is disconnected. */
  authoritative: boolean;
};

function readableModel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return androidDeviceDisplayName(value) || undefined;
}

/** Marketing names the device reports about itself, keyed by serial. The
 * property never changes for a connected device, so ask once. */
const marketingNames = new Map<string, string | null>();

const MARKETING_NAME_PROPERTIES = [
  "ro.product.marketname",
  "ro.product.vendor.marketname",
  "ro.config.marketing_name",
] as const;

/** The first non-empty line of `getprop` output for the properties above. */
export function marketingNameFromProperties(output: string): string | undefined {
  return (
    output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean) || undefined
  );
}

async function readMarketingName(adb: string, serial: string): Promise<string | undefined> {
  const cached = marketingNames.get(serial);
  if (cached !== undefined) return cached ?? undefined;
  try {
    const { stdout } = await execFileAsync(
      adb,
      [
        "-s",
        serial,
        "shell",
        MARKETING_NAME_PROPERTIES.map((property) => `getprop ${property}`).join("; "),
      ],
      { timeout: 2_000, maxBuffer: 16 * 1024 },
    );
    const name = marketingNameFromProperties(stdout);
    marketingNames.set(serial, name ?? null);
    return name;
  } catch {
    // Not cached: a phone that is still booting may answer on the next probe.
    return undefined;
  }
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

export async function probeAdbDevices(): Promise<AdbDeviceInventory> {
  try {
    const adb = await resolveAndroidSdkTool("adb");
    const { stdout } = await execFileAsync(adb, ["devices", "-l"], {
      timeout: 4_000,
      maxBuffer: 64 * 1024,
    });
    const devices = await Promise.all(
      parseAdbDevices(stdout).map(async (device) => {
        // Only a connected physical phone can be asked; emulators keep their AVD model.
        if (device.connectionState !== "connected" || device.kind === "Emulator") return device;
        const name = await readMarketingName(adb, device.serial);
        return name ? { ...device, name } : device;
      }),
    );
    return { devices, authoritative: true };
  } catch {
    // iOS-only machines and remote runners may not have ADB. The adapter
    // inventory remains authoritative for every target it can observe.
    return { devices: [], authoritative: false };
  }
}

export async function listAdbDevices(): Promise<AdbDeviceObservation[]> {
  return (await probeAdbDevices()).devices;
}
