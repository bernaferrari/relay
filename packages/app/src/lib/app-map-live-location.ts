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
