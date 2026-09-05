import { devicePlatformLabel } from "../data/device-label";
import type { ProductDevice, ProductDeviceStatus } from "../data/device-product-service";

export type DestinationTone = "ready" | "attention" | "empty" | "unavailable" | "loading";

export type DestinationSummary = {
  label: string;
  detail: string;
  tone: DestinationTone;
};

export type DestinationListItem = {
  id: string;
  name: string;
  detail: string;
  status: ProductDeviceStatus;
  platform: ProductDevice["platform"];
};

type DestinationDevice = Pick<
  ProductDevice,
  "id" | "name" | "status" | "platform" | "osVersion" | "kind"
>;

const STATUS_ORDER: Record<ProductDeviceStatus, number> = {
  ready: 0,
  virtual: 1,
  "needs-attention": 2,
};

export function destinationDetail(device: DestinationDevice): string {
  return devicePlatformLabel(device);
}

function isAvailable(device: DestinationDevice): boolean {
  return device.status === "ready" || device.status === "virtual";
}

export function summarizeDestinations(input: {
  status: "pending" | "success" | "error";
  devices?: readonly DestinationDevice[];
}): DestinationSummary {
  if (input.status === "pending") {
    return { label: "Checking…", detail: "Looking for connected devices", tone: "loading" };
  }
  if (input.status === "error") {
    return { label: "Unavailable", detail: "Relay could not list devices", tone: "unavailable" };
  }
  const devices = input.devices ?? [];
  const available = devices.filter(isAvailable);
  if (available.length === 1) {
    const destination = available[0]!;
    return {
      label: destination.name,
      detail: destinationDetail(destination),
      tone: "ready",
    };
  }
  if (available.length > 1) {
    return {
      label: `${available.length} ready`,
      detail: available.map((device) => device.name).join(", "),
      tone: "ready",
    };
  }
  if (devices.some((device) => device.status === "needs-attention")) {
    return {
      label: "Needs attention",
      detail: "Reconnect a device to run tests",
      tone: "attention",
    };
  }
  return {
    label: "No device",
    detail: "Connect a Device or start a Browser",
    tone: "empty",
  };
}

export function destinationStatusLabel(status: ProductDeviceStatus): string {
  if (status === "needs-attention") return "Needs attention";
  if (status === "virtual") return "Available";
  return "Ready";
}

export function destinationItems(devices: readonly DestinationDevice[]): DestinationListItem[] {
  return [...devices]
    .sort(
      (left, right) =>
        STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    )
    .map((device) => ({
      id: device.id,
      name: device.name,
      detail: destinationDetail(device),
      status: device.status,
      platform: device.platform,
    }));
}
