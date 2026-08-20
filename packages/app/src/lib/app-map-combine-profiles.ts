import type { AppMap, AppMapCombineCellRuntimeProfile } from "@relay/protocol";
import { sameAppMapCombineCellValues } from "@relay/protocol";

export type CombineRuntimeProfileOption = {
  id: string;
  name: string;
  targetId: string;
  platform: string;
};

export type CombineCellBindingStatus = {
  state: "missing" | "bound" | "no-saved-profiles";
  label: string;
  detail: string;
};

export type CombineCompatibleProfileSuggestion = CombineRuntimeProfileOption & {
  reason: string;
};

export function mapRuntimeProfileOptions(map: AppMap | undefined): CombineRuntimeProfileOption[] {
  if (!map) return [];
  const seen = new Map<string, CombineRuntimeProfileOption>();
  for (const variant of Object.values(map.screenVariants ?? {})) {
    const profile = variant.targetProfile;
    if (!profile?.id || seen.has(profile.id)) continue;
    seen.set(profile.id, {
      id: profile.id,
      name: profile.name?.trim() || profile.id,
      targetId: profile.targetId,
      platform: profile.platform,
    });
  }
  return [...seen.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.platform.localeCompare(right.platform) ||
      left.id.localeCompare(right.id),
  );
}

export function bindingForCell(
  bindings: readonly AppMapCombineCellRuntimeProfile[],
  testId: string,
  values: Record<string, string>,
): AppMapCombineCellRuntimeProfile | undefined {
  return bindings.find(
    (binding) => binding.testId === testId && sameAppMapCombineCellValues(binding.values, values),
  );
}

export function upsertCellRuntimeProfile(
  bindings: readonly AppMapCombineCellRuntimeProfile[],
  next: AppMapCombineCellRuntimeProfile,
): AppMapCombineCellRuntimeProfile[] {
  const remaining = bindings.filter(
    (binding) =>
      !(binding.testId === next.testId && sameAppMapCombineCellValues(binding.values, next.values)),
  );
  if (!next.targetProfileId.trim()) return remaining;
  return [...remaining, next];
}

export function cellBindingStatus(input: {
  profiles: readonly CombineRuntimeProfileOption[];
  binding?: AppMapCombineCellRuntimeProfile;
}): CombineCellBindingStatus {
  if (!input.profiles.length) {
    return {
      state: "no-saved-profiles",
      label: "No saved runtime profiles",
      detail: "Capture a screen on a device first. Relay will not invent a profile.",
    };
  }
  const requested = input.binding?.targetProfileId.trim();
  if (!requested) {
    return {
      state: "missing",
      label: "Missing profile",
      detail:
        "Choose a saved runtime profile. Save stays available; Run needs every selected cell bound.",
    };
  }
  const profile = input.profiles.find((item) => item.id === requested);
  return {
    state: "bound",
    label: `Bound · ${profile?.name ?? requested}`,
    detail: profile
      ? `${profile.name} · ${profile.platform}`
      : `Saved binding ${requested} is no longer on this App Map.`,
  };
}

function tokensFrom(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 2);
}

function profileHaystack(profile: CombineRuntimeProfileOption): string {
  return [profile.id, profile.name, profile.platform, profile.targetId]
    .join(" ")
    .toLocaleLowerCase();
}

export function filterRuntimeProfiles(
  profiles: readonly CombineRuntimeProfileOption[],
  query: string,
): CombineRuntimeProfileOption[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...profiles];
  return profiles.filter((profile) => profileHaystack(profile).includes(needle));
}

/** Rank saved profiles that could belong to this cell. The result is a
 * suggestion list only — callers must not persist a profile the person did
 * not choose. */
export function suggestCompatibleProfiles(input: {
  profiles: readonly CombineRuntimeProfileOption[];
  values: Record<string, string>;
  device?: { serial?: string; platform?: string };
}): CombineCompatibleProfileSuggestion[] {
  const valueTokens = [
    ...new Set(Object.values(input.values).flatMap((value) => tokensFrom(value))),
  ];
  const suggestions: CombineCompatibleProfileSuggestion[] = [];
  for (const profile of input.profiles) {
    const haystack = profileHaystack(profile);
    const matchedTokens = valueTokens.filter((token) => haystack.includes(token));
    const sameTarget = Boolean(input.device?.serial && profile.targetId === input.device.serial);
    const samePlatform = Boolean(
      input.device?.platform && profile.platform === input.device.platform,
    );
    if (!matchedTokens.length && !sameTarget && !samePlatform) continue;
    const reason = sameTarget
      ? matchedTokens.length
        ? `Same device · matches ${matchedTokens.join(", ")}`
        : "Same connected device"
      : matchedTokens.length
        ? samePlatform
          ? `${profile.platform} · matches ${matchedTokens.join(", ")}`
          : `Matches ${matchedTokens.join(", ")}`
        : `Same platform · ${profile.platform}`;
    suggestions.push({ ...profile, reason });
  }
  return suggestions.sort((left, right) => {
    const rank = (item: CombineCompatibleProfileSuggestion) =>
      (input.device?.serial && item.targetId === input.device.serial ? 4 : 0) +
      (input.device?.platform && item.platform === input.device.platform ? 2 : 0) +
      (Object.values(input.values).some((value) =>
        profileHaystack(item).includes(value.toLocaleLowerCase()),
      )
        ? 1
        : 0);
    return rank(right) - rank(left) || left.name.localeCompare(right.name);
  });
}
