import { createSignal, type Accessor, type Setter } from "solid-js";
import type { DeviceInfo, HealthState } from "./api-types";
import { interimDeviceScan, reconcileDeviceScan } from "./device-inventory";
import { listAndroidDevicesFast, listDevices } from "./server-target-remote";
import { preferredTargetSerial, targetIsReady } from "./target-presentation";

type Request = <T = unknown>(path: string, init?: RequestInit, timeoutMs?: number) => Promise<T>;

export function createServerDeviceInventoryController(input: {
  request: Request;
  health: Accessor<HealthState>;
  devices: Accessor<DeviceInfo[]>;
  setDevices: Setter<DeviceInfo[]>;
  selectedDevice: Accessor<string | null>;
  selectDevice: (serial: string | null) => Promise<void>;
  validateSelectedControl: (serial: string) => Promise<void>;
  resetLivePreview: () => void;
  error: Accessor<string | null>;
  setError: Setter<string | null>;
}) {
  const [deviceDiscoveryStatus, setDeviceDiscoveryStatus] = createSignal<
    "idle" | "scanning" | "ready"
  >("idle");
  let refreshSequence = 0;
  let refreshInFlight: Promise<void> | null = null;
  let selectedDeviceAvailable = false;

  function setSelectedDeviceAvailable(available: boolean): void {
    selectedDeviceAvailable = available;
  }

  function isSelectedDeviceAvailable(): boolean {
    return selectedDeviceAvailable;
  }

  async function refreshDevices(): Promise<void> {
    if (input.health() === "offline") return;
    if (refreshInFlight) return refreshInFlight;

    const sequence = ++refreshSequence;
    setDeviceDiscoveryStatus("scanning");
    const refresh = (async () => {
      const applyDeviceList = (list: DeviceInfo[]): void => {
        if (sequence !== refreshSequence) return;
        input.setDevices(list);
        // Preserve explicit selection across transient USB/Wi-Fi drops.
        const selected = input.selectedDevice();
        const selectedTarget = list.find((device) => device.serial === selected);
        const selectedTargetReady = targetIsReady(selectedTarget, true);
        if (!selected) {
          void input.selectDevice(preferredTargetSerial(list));
        } else if (selectedTargetReady) {
          // Availability and control are separate. A server restart may expire
          // the lease while screenshots remain observable, so revalidate.
          void input.validateSelectedControl(selected);
        } else if (selectedDeviceAvailable) {
          input.resetLivePreview();
        }
        selectedDeviceAvailable = selectedTargetReady;
      };

      try {
        const fullScan = listDevices(input.request);
        let android: DeviceInfo[];
        try {
          const previousBySerial = new Map(
            input
              .devices()
              .filter((device) => device.platform === "android")
              .map((device) => [device.serial, device]),
          );
          android = (await listAndroidDevicesFast(input.request)).map((device) => {
            const serial = String(device.serial ?? device.id ?? "");
            return { ...previousBySerial.get(serial), ...device, serial };
          });
        } catch {
          // Failure is not evidence that a phone disconnected.
          android = input.devices().filter((device) => device.platform === "android");
        }
        applyDeviceList(interimDeviceScan(input.devices(), android));

        const list = (await fullScan).map((device) => ({
          ...device,
          serial: String(device.serial ?? device.id ?? ""),
        }));
        const stableList = reconcileDeviceScan(input.devices(), android, list);
        if (sequence !== refreshSequence) return;
        applyDeviceList(stableList);
        if (input.error()?.match(/failed to fetch|network|ECONNREFUSED|offline/i)) {
          input.setError(null);
        }
      } catch (error) {
        if (sequence !== refreshSequence || input.health() === "offline") return;
        input.setError(error instanceof Error ? error.message : String(error));
      }
    })();
    refreshInFlight = refresh;
    try {
      await refresh;
    } finally {
      if (refreshInFlight === refresh) {
        refreshInFlight = null;
        setDeviceDiscoveryStatus("ready");
      }
    }
  }

  return {
    deviceDiscoveryStatus,
    refreshDevices,
    selectedDeviceAvailable: isSelectedDeviceAvailable,
    setSelectedDeviceAvailable,
  };
}
