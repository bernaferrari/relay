import type {
  CompatibilityMatrix,
  MatrixExpansion,
  TargetCapability,
  TargetDefinition,
  TargetProfile,
  TargetSelector,
} from "@relay/protocol";
import type { ListedDevice } from "./workspace.js";
import { BROWSER_TARGET_CAPABILITIES } from "./targets.js";
import { browserCaseProfileForTarget } from "./browser-case-profile-target.js";

const MOBILE_CAPABILITIES: Record<"android" | "ios", TargetCapability[]> = {
  android: [
    "snapshot",
    "screenshot",
    "stream",
    "recording",
    "tap",
    "type",
    "scroll",
    "clipboard",
    "network",
    "logs",
    "permissions",
    "location",
    "rotation",
    "lock-screen",
    "app-switcher",
  ],
  ios: [
    "snapshot",
    "screenshot",
    "recording",
    "tap",
    "type",
    "scroll",
    "clipboard",
    "network",
    "logs",
    "permissions",
    "location",
    "rotation",
    "app-switcher",
  ],
};

/** Build profiles only from facts reported by the adapter or configured target. */
export function buildTargetProfiles(input: {
  devices: ListedDevice[];
  targets: TargetDefinition[];
  observedAt?: number;
}): TargetProfile[] {
  const observedAt = input.observedAt ?? Date.now();
  const mobile = input.devices.map((device) => ({
    id: `device:${device.serial}`,
    targetId: device.serial,
    source: "device" as const,
    platform: device.platform,
    name: device.name || device.serial,
    ...(device.kind ? { model: device.kind } : {}),
    ...(device.osVersion ? { osVersion: device.osVersion } : {}),
    capabilities: [...MOBILE_CAPABILITIES[device.platform]],
    observedAt,
  }));
  const browsers = input.targets
    .filter((target) => target.kind === "browser")
    .map((target) => ({
      id: `browser:${target.id}`,
      targetId: target.id,
      source: "browser" as const,
      platform: "browser" as const,
      name: target.name,
      ...(target.browser?.viewport ? { viewport: { ...target.browser.viewport } } : {}),
      browserCaseProfile: browserCaseProfileForTarget(target),
      capabilities: [...BROWSER_TARGET_CAPABILITIES],
      observedAt,
    }));
  return [...mobile, ...browsers].sort((left, right) => left.id.localeCompare(right.id));
}

function selectorReason(profile: TargetProfile, selector: TargetSelector): string | null {
  if (selector.targetIds?.length && !selector.targetIds.includes(profile.targetId)) {
    return "not in the explicit target list";
  }
  if (selector.platforms?.length && !selector.platforms.includes(profile.platform)) {
    return `platform is ${profile.platform}`;
  }
  if (selector.osVersionPrefixes?.length) {
    if (!profile.osVersion) return "OS version was not reported by the target";
    if (!selector.osVersionPrefixes.some((prefix) => profile.osVersion!.startsWith(prefix))) {
      return `OS version ${profile.osVersion} does not match`;
    }
  }
  if (selector.nameIncludes?.length) {
    const haystack = `${profile.name} ${profile.model ?? ""}`.toLowerCase();
    if (!selector.nameIncludes.some((value) => haystack.includes(value.toLowerCase()))) {
      return "name/model does not match";
    }
  }
  const missing = (selector.requiredCapabilities ?? []).filter(
    (capability) => !profile.capabilities.includes(capability),
  );
  if (missing.length) return `missing ${missing.join(", ")}`;
  return null;
}

export function validateCompatibilityMatrix(
  input: Pick<CompatibilityMatrix, "id" | "name" | "selectors">,
): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/.test(input.id)) {
    throw new Error("matrix id must use letters, numbers, and hyphens only");
  }
  if (!input.name.trim()) throw new Error("matrix name is required");
  if (input.selectors.length === 0) throw new Error("a matrix needs at least one selector");
  for (const selector of input.selectors) {
    if (
      !selector.targetIds?.length &&
      !selector.platforms?.length &&
      !selector.osVersionPrefixes?.length &&
      !selector.nameIncludes?.length &&
      !selector.requiredCapabilities?.length
    ) {
      throw new Error("each matrix selector needs at least one constraint");
    }
  }
}

/**
 * Union matching makes it natural to describe a browser + Android release
 * matrix. A profile is included once; exclusion explains why no selector fit.
 */
export function resolveCompatibilityMatrix(
  matrix: CompatibilityMatrix,
  profiles: TargetProfile[],
  resolvedAt = Date.now(),
): MatrixExpansion {
  validateCompatibilityMatrix(matrix);
  const included: TargetProfile[] = [];
  const excluded: MatrixExpansion["excluded"] = [];
  for (const profile of [...profiles].sort((left, right) => left.id.localeCompare(right.id))) {
    const reasons = matrix.selectors.map((selector) => selectorReason(profile, selector));
    if (reasons.some((reason) => reason === null))
      included.push({ ...profile, capabilities: [...profile.capabilities] });
    else
      excluded.push({
        profile: { ...profile, capabilities: [...profile.capabilities] },
        reason: reasons.join("; "),
      });
  }
  return {
    matrixId: matrix.id,
    matrixName: matrix.name,
    resolvedAt,
    profiles: included,
    excluded,
  };
}
