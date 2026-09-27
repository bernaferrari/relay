import type { AppMap } from "@relay/protocol";

export type AppPlatform = "web" | "ios" | "android";

export type AppFamilyInfo = {
  /** Where this map's screens were recorded. */
  platform?: AppPlatform;
  /** Maps whose Tests link to each other's native twins share a family. */
  familyId: string;
  /** The product people recognize, e.g. "Grok". */
  familyName: string;
};

/** Majority platform across a map's recorded screen variants. */
function mapPlatform(map: AppMap): AppPlatform | undefined {
  const counts = new Map<AppPlatform, number>();
  for (const variant of Object.values(map.screenVariants)) {
    const raw = variant.targetProfile?.platform;
    const platform = raw === "browser" ? "web" : raw;
    if (platform) counts.set(platform, (counts.get(platform) ?? 0) + 1);
  }
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0];
}

/** "Grok.com daily" and "Grok iOS daily" are both "Grok". */
function productWord(name: string): string {
  return (
    name
      .trim()
      .split(/[\s.·:/-]+/u)[0]
      ?.replace(/^\w/u, (letter) => letter.toUpperCase()) ?? name
  );
}

export function appFamilies(maps: readonly AppMap[]): Map<string, AppFamilyInfo> {
  const parent = new Map(maps.map((map) => [map.id, map.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const map of maps) {
    for (const test of Object.values(map.tests)) {
      if (test.kind !== "scenario") continue;
      for (const companion of test.nativeRouteCompanions ?? []) {
        if (!parent.has(companion.appMapId)) continue;
        parent.set(find(companion.appMapId), find(map.id));
      }
    }
  }
  const members = new Map<string, AppMap[]>();
  for (const map of maps) {
    const root = find(map.id);
    members.set(root, [...(members.get(root) ?? []), map]);
  }
  const result = new Map<string, AppFamilyInfo>();
  for (const [root, group] of members) {
    const words = new Set(group.map((map) => productWord(map.name)));
    const familyName =
      group.length > 1 && words.size === 1
        ? [...words][0]!
        : group.length > 1
          ? group[0]!.name
          : "";
    for (const map of group) {
      const platform = mapPlatform(map);
      result.set(map.id, {
        ...(platform ? { platform } : {}),
        familyId: root,
        familyName: familyName || map.name,
      });
    }
  }
  return result;
}

export function platformLabel(platform: AppPlatform | undefined): string {
  if (platform === "ios") return "iOS";
  if (platform === "android") return "Android";
  if (platform === "web") return "Web";
  return "App";
}
