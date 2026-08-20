import type { AppMap, TargetProfile } from "@relay/protocol";
import type { DeviceInfo } from "./api-types";

/** Runtime profiles are taken only from the saved App Map variants. The
 * selector is a read-only evidence scope, never an invitation to invent a
 * locale from the connected device's visible copy. */
export function appMapTestRuntimeProfiles(map: AppMap | null | undefined): TargetProfile[] {
  if (!map) return [];
  const profiles = new Map<string, TargetProfile>();
  for (const variant of Object.values(map.screenVariants).sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (!profiles.has(variant.targetProfile.id)) {
      profiles.set(variant.targetProfile.id, structuredClone(variant.targetProfile));
    }
  }
  return [...profiles.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.platform.localeCompare(right.platform) ||
      left.id.localeCompare(right.id),
  );
}

/** A device match is exact: same transport target and platform. A display name
 * or translated label is deliberately never used to choose profile evidence. */
export function appMapTestRuntimeProfileMatchesDevice(
  profile: Pick<TargetProfile, "targetId" | "platform">,
  device: Pick<DeviceInfo, "serial" | "platform"> | undefined,
): boolean {
  return Boolean(
    device?.platform && profile.targetId === device.serial && profile.platform === device.platform,
  );
}

/** Pick only an unambiguous default. Two locale profiles on one iPad remain a
 * human/agent choice; silently picking alphabetical English would recreate the
 * cross-locale proof bug this scope exists to prevent. */
export function suggestedAppMapTestRuntimeProfileId(
  profiles: readonly TargetProfile[],
  device: Pick<DeviceInfo, "serial" | "platform"> | undefined,
): string | undefined {
  const candidates = device?.platform
    ? profiles.filter((profile) => appMapTestRuntimeProfileMatchesDevice(profile, device))
    : profiles;
  return candidates.length === 1 ? candidates[0]?.id : undefined;
}

export type AppMapTestRuntimeProfileScope = {
  status:
    | "no-saved-profiles"
    | "selected"
    | "selection-required"
    | "no-compatible-profile"
    | "selected-profile-incompatible";
  selectedProfileId?: string;
  selectedProfile?: TargetProfile;
  compatibleProfiles: TargetProfile[];
};

/** Resolve evidence scope from immutable saved facts only. A lone iPad
 * profile is still not an iPad profile for an Android run; callers can show
 * that fact rather than treating an empty suggestion as permission to run. */
export function appMapTestRuntimeProfileScope(input: {
  profiles: readonly TargetProfile[];
  device: Pick<DeviceInfo, "serial" | "platform"> | undefined;
  requestedProfileId?: string;
}): AppMapTestRuntimeProfileScope {
  const profiles = input.profiles.map((profile) => structuredClone(profile));
  if (!profiles.length) return { status: "no-saved-profiles", compatibleProfiles: [] };
  const compatibleProfiles = input.device?.platform
    ? profiles.filter((profile) => appMapTestRuntimeProfileMatchesDevice(profile, input.device))
    : profiles;
  const requested = input.requestedProfileId?.trim();
  const selectedProfile = requested
    ? profiles.find((profile) => profile.id === requested)
    : undefined;
  if (selectedProfile) {
    if (
      input.device?.platform &&
      !appMapTestRuntimeProfileMatchesDevice(selectedProfile, input.device)
    ) {
      return {
        status: "selected-profile-incompatible",
        selectedProfileId: selectedProfile.id,
        selectedProfile,
        compatibleProfiles,
      };
    }
    return {
      status: "selected",
      selectedProfileId: selectedProfile.id,
      selectedProfile,
      compatibleProfiles,
    };
  }
  if (input.device?.platform && !compatibleProfiles.length) {
    return { status: "no-compatible-profile", compatibleProfiles };
  }
  const suggested = suggestedAppMapTestRuntimeProfileId(profiles, input.device);
  if (suggested) {
    const profile = profiles.find((candidate) => candidate.id === suggested)!;
    return {
      status: "selected",
      selectedProfileId: profile.id,
      selectedProfile: profile,
      compatibleProfiles,
    };
  }
  return { status: "selection-required", compatibleProfiles };
}

export function appMapTestRuntimeProfileLabel(profile: Pick<TargetProfile, "id" | "name">): string {
  return `${profile.name} · ${profile.id}`;
}
