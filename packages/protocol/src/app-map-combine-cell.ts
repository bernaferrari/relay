/** Bytewise UTF-8 ordering. `localeCompare` is not identity. */
export function compareUtf8Bytewise(left: string, right: string): number {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/** Identity order is UTF-8 bytes, not `localeCompare`. */
export function canonicalAppMapCombineCellValues(
  values: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values)
      .map(([variableId, valueId]) => [variableId, valueId] as const)
      .sort(([left], [right]) => compareUtf8Bytewise(left, right)),
  );
}

export function appMapCombineCellValueEntries(
  values: Record<string, string>,
): Array<{ variableId: string; valueId: string }> {
  return Object.entries(canonicalAppMapCombineCellValues(values)).map(([variableId, valueId]) => ({
    variableId,
    valueId,
  }));
}

export function sameAppMapCombineCellValues(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const a = appMapCombineCellValueEntries(left);
  const b = appMapCombineCellValueEntries(right);
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.variableId === b[index]?.variableId && entry.valueId === b[index]?.valueId,
    )
  );
}
