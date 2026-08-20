import type { AppMap, AppMapCombineCellRuntimeProfile } from "@relay/protocol";
import { sameAppMapCombineCellValues } from "@relay/protocol";

export type CombineRuntimeProfileOption = {
  id: string;
  name: string;
  targetId: string;
  platform: string;
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
  return [...seen.values()];
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
    (binding) => !(binding.testId === next.testId && sameAppMapCombineCellValues(binding.values, next.values)),
  );
  if (!next.targetProfileId.trim()) return remaining;
  return [...remaining, next];
}
