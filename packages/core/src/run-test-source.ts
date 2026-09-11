/** Retain authored Test identity across single and Run Across execution. */
export function runTestSource(run: {
  action?: unknown;
  artifacts?: unknown;
}): { appMapId: string; testId: string } | undefined {
  for (const item of Array.isArray(run.artifacts) ? run.artifacts : []) {
    if (!item || typeof item !== "object") continue;
    const artifact = item as {
      kind?: string;
      data?: { sourcePlan?: unknown; child?: { sourcePlan?: unknown } };
    };
    const source =
      artifact.kind === "app-map-test-execution-intent"
        ? artifact.data?.sourcePlan
        : artifact.kind === "app-map-combine-cell-execution-intent"
          ? artifact.data?.child?.sourcePlan
          : undefined;
    if (source && typeof source === "object") {
      const { appMapId, testId } = source as { appMapId?: unknown; testId?: unknown };
      if (typeof appMapId === "string" && appMapId && typeof testId === "string" && testId)
        return { appMapId, testId };
    }
  }
  const match =
    typeof run.action === "string"
      ? /^app-map:([^:]+):test:([^:]+)(?::|$)/u.exec(run.action)
      : undefined;
  return match ? { appMapId: match[1]!, testId: match[2]! } : undefined;
}
