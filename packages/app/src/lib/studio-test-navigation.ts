import type { AppMap } from "@relay/protocol";

export type StudioTestNavigation = {
  appMap: AppMap;
  /** Present only when the requested identity is a canonical Test. */
  testId?: string;
};

/** Resolve a Run's authored identity without replacing it with recency-based selection. */
export function resolveStudioTestNavigation(
  appMaps: readonly AppMap[],
  authoredId: string,
): StudioTestNavigation | undefined {
  const appMap = appMaps.find(
    (candidate) =>
      candidate.id === authoredId ||
      Boolean(candidate.tests[authoredId]) ||
      Boolean(candidate.flows[authoredId]) ||
      Boolean(candidate.routines[authoredId]),
  );
  if (!appMap) return undefined;
  return {
    appMap,
    ...(appMap.tests[authoredId] ? { testId: authoredId } : {}),
  };
}
