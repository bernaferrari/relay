import type { TargetProfile } from "@relay/protocol";
import { platformLabel } from "./target-presentation";

export function filterTargetProfiles(
  profiles: readonly TargetProfile[],
  query: string,
): TargetProfile[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...profiles];
  return profiles.filter((profile) =>
    [profile.name, profile.model, profile.osVersion, platformLabel(profile.platform)]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(normalized)),
  );
}
