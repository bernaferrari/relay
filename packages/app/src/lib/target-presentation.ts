import type { DeviceInfo } from "./api-types";

export type TargetPresentation = {
  displayName: string;
  kindLabel: string;
  platformLabel: string;
  statusLabel: string;
  group: "browsers" | "devices";
  details: Array<{ label: string; value: string }>;
};

export function platformLabel(platform: DeviceInfo["platform"]): string {
  return platform === "ios" ? "iOS" : platform === "browser" ? "Browser" : "Android";
}

/** A target is actionable only when the control plane is reachable and the
 * selected target reports itself as booted/ready. Keep this shared so maps,
 * recording, and the first-test guide cannot disagree about readiness. */
export function targetIsReady(target: DeviceInfo | null | undefined, online: boolean): boolean {
  return online && Boolean(target) && target?.booted !== false;
}

function cleaned(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function presentTarget(target: DeviceInfo): TargetPresentation {
  const platformName = platformLabel(target.platform);
  const defaultName =
    target.platform === "browser"
      ? "Managed browser"
      : target.platform === "ios"
        ? target.kind?.toLowerCase().includes("simulator")
          ? "iOS simulator"
          : "iOS device"
        : "Android device";
  const kindLabel =
    cleaned(target.kind) ?? (target.platform === "browser" ? "Managed browser" : platformName);
  const statusLabel =
    target.booted === false
      ? "Unavailable"
      : target.platform === "browser"
        ? "Ready"
        : target.kind?.toLowerCase().includes("simulator")
          ? "Simulator ready"
          : "Connected";

  return {
    displayName: cleaned(target.name) ?? defaultName,
    kindLabel,
    platformLabel: platformName,
    statusLabel,
    group: target.platform === "browser" ? "browsers" : "devices",
    details: [
      { label: "Platform", value: platformName },
      { label: "Type", value: kindLabel },
      { label: "Identifier", value: target.serial },
    ],
  };
}

export function targetSearchText(target: DeviceInfo): string {
  const presented = presentTarget(target);
  return [presented.displayName, presented.kindLabel, presented.platformLabel, target.serial]
    .join(" ")
    .toLowerCase();
}

export function targetGroupMatchesQuery(targets: readonly DeviceInfo[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  return !needle || targets.some((target) => targetSearchText(target).includes(needle));
}
