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
  /** Identity `listTargets()` / `start()` accept — serial for devices. */
  targetId: string;
  name: string;
  detail: string;
  status: ProductDeviceStatus;
  platform: ProductDevice["platform"];
};

type DestinationDevice = Pick<
  ProductDevice,
  "id" | "serial" | "name" | "status" | "platform" | "osVersion" | "kind"
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
    const browsers = available.filter((device) => device.platform === "browser").length;
    const physical = available.length - browsers;
    const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    return {
      label: [physical ? count(physical, "device") : "", browsers ? count(browsers, "browser") : ""]
        .filter(Boolean)
        .join(" · "),
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
      targetId: destinationRunTargetId(device),
      name: device.name,
      detail: destinationDetail(device),
      status: device.status,
      platform: device.platform,
    }));
}

export const WORKSPACE_DESTINATION_KEY = "relay:workspace-destination";
export const workspaceDestinationQueryKey = ["workspace-destination"] as const;

export type DestinationAction =
  | { kind: "select"; targetId: string }
  | { kind: "manage"; href: "/devices" };

export function destinationRunTargetId(device: { id: string; serial?: string }): string {
  const serial = device.serial?.trim();
  return serial || device.id;
}

export function destinationItemAction(
  item: Pick<DestinationListItem, "id"> & { targetId?: string; serial?: string },
): DestinationAction {
  return { kind: "select", targetId: item.targetId ?? destinationRunTargetId(item) };
}

export function matchRunTargetId(
  stored: string | undefined,
  targets: readonly { targetId: string }[],
): string | undefined {
  const wanted = stored?.trim();
  if (!wanted) return undefined;
  return targets.find((target) => target.targetId === wanted)?.targetId;
}

export type ConfigurationSelectionOrigin =
  | "repository-default"
  | "workspace-default"
  | "saved-test"
  | "explicit-user-selection";

export function workspaceDestinationDecision(input: {
  storedTargetId?: string;
  lastAppliedTargetId?: string;
  currentTargetId?: string;
  availableTargetIds: readonly string[];
  /** A remembered workspace device is only a default for an unconfigured task. */
  origin?: ConfigurationSelectionOrigin;
  protectedTargetId?: string;
}):
  | { kind: "skip" }
  | { kind: "remember"; targetId: string }
  | { kind: "apply"; targetId: string } {
  const stored = input.storedTargetId?.trim();
  if (!stored) return { kind: "skip" };
  if (input.lastAppliedTargetId === stored) return { kind: "skip" };
  if (input.origin === "saved-test" || input.origin === "explicit-user-selection") {
    return { kind: "skip" };
  }
  const protectedTarget = input.protectedTargetId?.trim();
  if (protectedTarget && protectedTarget !== stored) return { kind: "skip" };
  const resolved = matchRunTargetId(
    stored,
    input.availableTargetIds.map((targetId) => ({ targetId })),
  );
  if (!resolved) return { kind: "skip" };
  if (input.currentTargetId === resolved) return { kind: "remember", targetId: stored };
  return { kind: "apply", targetId: resolved };
}

export type ConfigurationAdmissionStatus = "resolving" | "ready" | "blocked";

export type ConfigurationAdmissionBlocker = {
  id: string;
  label: string;
  detail: string;
  resolving?: boolean;
};

export type StartConfigurationFragment = {
  targetProfileId?: string;
  selectedBuildId?: string;
  sourceRevision?: { vcs: "git"; sha: string; buildId: string };
};

export function incompatibleSavedProfile(input: {
  savedProfileId?: string;
  targetId?: string;
  profilesStatus?: "pending" | "success" | "error";
  profiles?: readonly {
    id: string;
    targetId?: string;
    name: string;
    account?: { name?: string };
  }[];
}): ConfigurationAdmissionBlocker | undefined {
  const savedId = input.savedProfileId?.trim();
  if (!savedId) return undefined;
  if (input.profilesStatus === "pending" || input.profiles === undefined) {
    return {
      id: "saved-profile",
      label: "Checking saved setup…",
      detail: "Relay is still loading accounts for this destination.",
      resolving: true,
    };
  }
  const profile = input.profiles.find((item) => item.id === savedId);
  if (!profile) {
    return {
      id: "saved-profile",
      label: "Saved setup is unavailable",
      detail: "Choose a saved setup for this device or browser.",
    };
  }
  if (!input.targetId || profile.targetId === input.targetId) return undefined;
  const account = profile.account?.name ?? profile.name;
  return {
    id: "saved-profile",
    label: `${account} is saved for another destination`,
    detail: "Choose that device or browser, or use a different saved setup.",
  };
}

export function explicitBuildAdmission(input: {
  selectedBuildId?: string;
  buildsStatus?: "pending" | "success" | "error";
  builds?: readonly { id: string; status: string; sourceSha?: string }[];
}): {
  status: "none" | ConfigurationAdmissionStatus;
  blocker?: ConfigurationAdmissionBlocker;
  startSource?: StartConfigurationFragment["sourceRevision"];
} {
  const buildId = input.selectedBuildId?.trim();
  if (!buildId) return { status: "none" };
  const sha = input.builds?.find((build) => build.id === buildId)?.sourceSha?.trim();
  const startSource =
    sha && /^[0-9a-f]{7,40}$/u.test(sha) ? { vcs: "git" as const, sha, buildId } : undefined;
  if (input.buildsStatus === "pending" || input.builds === undefined) {
    return {
      status: "resolving",
      blocker: {
        id: "selected-build",
        label: "Checking selected build…",
        detail: "Relay is still loading the selected build.",
        resolving: true,
      },
      startSource,
    };
  }
  const build = input.builds.find((item) => item.id === buildId);
  if (!build || build.status !== "ready") {
    return {
      status: "blocked",
      blocker: {
        id: "selected-build",
        label: build ? "Selected build is not ready" : "Selected build is unavailable",
        detail: "Keep this build or choose a ready build before running.",
      },
      startSource,
    };
  }
  if (!startSource) {
    return {
      status: "blocked",
      blocker: {
        id: "selected-build",
        label: "Selected build has no bindable identity",
        detail:
          "This build cannot be frozen as an artifact identity. Choose a build with a source revision.",
      },
    };
  }
  return { status: "ready", startSource };
}

export function startConfigurationAdmission(input: {
  savedProfileId?: string;
  targetId?: string;
  profilesStatus?: "pending" | "success" | "error";
  profiles?: readonly {
    id: string;
    targetId?: string;
    name: string;
    account?: { name?: string };
  }[];
  selectedBuildId?: string;
  buildsStatus?: "pending" | "success" | "error";
  builds?: readonly { id: string; status: string; sourceSha?: string }[];
}): {
  status: ConfigurationAdmissionStatus;
  blockers: ConfigurationAdmissionBlocker[];
  start: StartConfigurationFragment;
} {
  const profileBlocker = incompatibleSavedProfile(input);
  const build = explicitBuildAdmission(input);
  const blockers = [profileBlocker, build.blocker].filter(
    (item): item is ConfigurationAdmissionBlocker => Boolean(item),
  );
  const savedProfileId = input.savedProfileId?.trim();
  const selectedBuildId = input.selectedBuildId?.trim();
  const start: StartConfigurationFragment = {
    ...(savedProfileId ? { targetProfileId: savedProfileId } : {}),
    ...(selectedBuildId ? { selectedBuildId } : {}),
    ...(build.startSource ? { sourceRevision: build.startSource } : {}),
  };
  if (blockers.some((item) => item.resolving)) {
    return { status: "resolving", blockers, start };
  }
  if (blockers.length) return { status: "blocked", blockers, start };
  return { status: "ready", blockers, start };
}

export function destinationManageAction(): DestinationAction {
  return { kind: "manage", href: "/devices" };
}

export function parseWorkspaceDestination(raw: string | null): { targetId: string } | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { targetId?: unknown }).targetId === "string" &&
      (value as { targetId: string }).targetId.trim()
    ) {
      return { targetId: (value as { targetId: string }).targetId.trim() };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
