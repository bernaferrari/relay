import type { ProductDevice } from "./device-product-service";

type DeviceLabel = Pick<ProductDevice, "platform" | "osVersion" | "kind">;

export function devicePlatformLabel(device: Pick<ProductDevice, "platform" | "osVersion">): string {
  const version = device.osVersion?.trim();
  if (device.platform === "android") {
    if (!version) return "Android";
    return /^android\b/iu.test(version)
      ? capitalizePlatform(version, "Android")
      : `Android ${version}`;
  }
  if (device.platform === "ios") {
    if (!version) return "Apple device";
    return /^(ios|ipados)\b/iu.test(version)
      ? capitalizePlatform(version, "iOS")
      : `iOS ${version}`;
  }
  return "Managed browser";
}

export function deviceSummaryLine(device: DeviceLabel): string {
  const platform = devicePlatformLabel(device);
  const kind = device.kind?.trim();
  if (!kind || kind.localeCompare(platform, undefined, { sensitivity: "accent" }) === 0) {
    return platform;
  }
  return `${platform} · ${kind}`;
}

function capitalizePlatform(version: string, platform: "Android" | "iOS"): string {
  return version.replace(/^(android|ios|ipados)\s+/iu, `${platform} `);
}
