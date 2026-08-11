/** Where the live device is on this App Map. Fingerprint/alias only — nav
 * title is not identity (child sheets often keep the parent header). */

export type AppMapLiveLocation =
  | { kind: "none" }
  | { kind: "here"; screenId: string }
  | { kind: "unknown" };

export type LiveLocationScreen = {
  id: string;
  identity?: {
    fingerprint?: string;
    aliases?: readonly string[];
  };
};

export type ApplicationIdentityVariant = {
  observation?: {
    nodes?: readonly { identifier?: string }[];
  };
};

/** Existing Android evidence already carries package-qualified resource ids.
 * Use the dominant package as the map's app boundary so the authoring UI does
 * not offer to save Launcher, Settings, or another app into the current map. */
export function expectedAndroidApplicationId(
  variants: readonly ApplicationIdentityVariant[],
): string | undefined {
  const counts = new Map<string, number>();
  for (const variant of variants) {
    for (const node of variant.observation?.nodes ?? []) {
      const packageId = node.identifier?.match(/^([a-z][a-z0-9_.]+):id\//i)?.[1];
      if (!packageId || packageId === "android") continue;
      counts.set(packageId, (counts.get(packageId) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort(
    ([leftId, leftCount], [rightId, rightCount]) =>
      rightCount - leftCount || leftId.localeCompare(rightId),
  )[0]?.[0];
}

export function applicationIdsMatch(expected: string, actual: string): boolean {
  return expected.trim().toLowerCase() === actual.trim().toLowerCase();
}

function fingerprintKey(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function fingerprintsMatch(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.length >= 16 && longer.startsWith(shorter);
}

export function matchLiveScreen(
  screens: readonly LiveLocationScreen[],
  fingerprint?: string | null | readonly (string | null | undefined)[],
): AppMapLiveLocation {
  const lives = (Array.isArray(fingerprint) ? fingerprint : [fingerprint])
    .map((value) => fingerprintKey(value ?? undefined))
    .filter(Boolean);
  if (!lives.length) return { kind: "none" };
  const matches = new Set<string>();
  for (const live of lives) {
    for (const screen of screens) {
      const keys = [screen.identity?.fingerprint, ...(screen.identity?.aliases ?? [])]
        .map(fingerprintKey)
        .filter(Boolean);
      if (keys.some((key) => fingerprintsMatch(key, live))) matches.add(screen.id);
    }
  }
  if (matches.size === 1) return { kind: "here", screenId: [...matches][0]! };
  return { kind: "unknown" };
}
