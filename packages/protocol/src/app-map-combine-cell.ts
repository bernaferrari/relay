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

/** Durable identity of one Test case. App Map identity is required because
 * Test ids and canonical value tuples are only unique inside their App Map. */
export type AppMapTestTupleIdentity = {
  appMapId: string;
  testId: string;
  values: Record<string, string>;
};

export function canonicalAppMapTestTupleIdentity(
  identity: AppMapTestTupleIdentity,
): AppMapTestTupleIdentity {
  return {
    appMapId: identity.appMapId.trim(),
    testId: identity.testId.trim(),
    values: canonicalAppMapCombineCellValues(identity.values),
  };
}

/** Parse the public identity projection without trusting persisted artifact casts. */
export function parseAppMapTestTupleIdentity(value: unknown): AppMapTestTupleIdentity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.appMapId !== "string" ||
    !candidate.appMapId.trim() ||
    typeof candidate.testId !== "string" ||
    !candidate.testId.trim() ||
    !candidate.values ||
    typeof candidate.values !== "object" ||
    Array.isArray(candidate.values)
  ) {
    return undefined;
  }
  const entries = Object.entries(candidate.values);
  if (entries.some(([, entry]) => typeof entry !== "string")) return undefined;
  return canonicalAppMapTestTupleIdentity({
    appMapId: candidate.appMapId,
    testId: candidate.testId,
    values: Object.fromEntries(entries) as Record<string, string>,
  });
}

export function sameAppMapTestTupleIdentity(
  left: AppMapTestTupleIdentity,
  right: AppMapTestTupleIdentity,
): boolean {
  return (
    left.appMapId === right.appMapId &&
    left.testId === right.testId &&
    sameAppMapCombineCellValues(left.values, right.values)
  );
}
