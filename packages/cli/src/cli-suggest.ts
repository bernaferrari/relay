/** "Did you mean" support shared by command routing and name lookup. */

/** Optimal-string-alignment distance: a swapped pair ("lsit") costs one edit. */
export function editDistance(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      }
      rows[i]![j] = best;
    }
  }
  return rows[a.length]![b.length]!;
}

function allowedDistance(word: string): number {
  return word.length <= 4 ? 1 : word.length <= 8 ? 2 : 3;
}

/** The closest candidate that is plausibly a typo of `wanted`, if any. */
export function closestMatch(
  wanted: string,
  candidates: Iterable<string>,
  options: { substring?: boolean } = {},
): string | undefined {
  const list = [...candidates];
  let best: { value: string; distance: number } | undefined;
  for (const candidate of list) {
    const distance = editDistance(wanted, candidate);
    if (distance === 0) return candidate;
    if (distance > allowedDistance(candidate)) continue;
    if (!best || distance < best.distance) best = { value: candidate, distance };
  }
  if (best) return best.value;
  if (options.substring === false) return undefined;
  const lowered = wanted.toLowerCase();
  const containing = list.filter(
    (candidate) => lowered.length >= 3 && candidate.toLowerCase().includes(lowered),
  );
  return containing.length === 1 ? containing[0] : undefined;
}
