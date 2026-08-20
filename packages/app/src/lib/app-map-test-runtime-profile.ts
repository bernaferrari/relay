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

export function appMapTestRuntimeProfileLabel(profile: Pick<TargetProfile, "id" | "name">): string {
  return `${profile.name} · ${profile.id}`;
}
