export type AttachedRunOwnership =
  | { kind: "unresolved" }
  | { kind: "owned"; testId: string }
  | { kind: "foreign"; routeTestId: string; runTestId: string };

/** A `?run=` pointer is navigation. The Run's own Test identity is authority. */
export function attachedRunOwnership(input: {
  routeTestId?: string;
  runTestId?: string;
}): AttachedRunOwnership {
  const routeTestId = input.routeTestId?.trim();
  const runTestId = input.runTestId?.trim();
  if (!routeTestId || !runTestId) return { kind: "unresolved" };
  if (routeTestId === runTestId) return { kind: "owned", testId: routeTestId };
  return { kind: "foreign", routeTestId, runTestId };
}

export function attachedRunLinkTestId(
  ownership: AttachedRunOwnership,
  fallback?: string,
): string | undefined {
  if (ownership.kind === "owned") return ownership.testId;
  if (ownership.kind === "foreign") return ownership.runTestId;
  return fallback?.trim() || undefined;
}
