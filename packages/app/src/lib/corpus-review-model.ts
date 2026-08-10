import type { CorpusScreen, CorpusSession } from "@relay/protocol";

export type CorpusScreenGroup = {
  canonicalKey: string;
  screens: CorpusScreen[];
  representative: CorpusScreen;
  coveredValues: number;
  expectedValues: number;
};

export type CorpusCoverageSummary = {
  logical: number;
  complete: number;
  partial: number;
  shots: number;
};

export type CorpusReviewModel = {
  groups: CorpusScreenGroup[];
  coverage: CorpusCoverageSummary;
};

/**
 * Projects a flat screenshot corpus into the screen-first review model used by
 * the desktop UI. A 7-value x 10-screen crawl therefore opens as ten cards,
 * while all seventy evidence frames remain available inside those cards.
 */
export function buildCorpusReviewModel(session: CorpusSession): CorpusReviewModel {
  const expectedValues = new Set(session.scope.locales);
  const buckets = new Map<string, CorpusScreen[]>();

  for (const screen of session.screens) {
    const bucket = buckets.get(screen.canonicalKey);
    if (bucket) bucket.push(screen);
    else buckets.set(screen.canonicalKey, [screen]);
  }

  const groups = [...buckets.entries()]
    .map(([canonicalKey, screens]) => {
      const coveredValues = new Set(screens.map((screen) => screen.locale)).size;
      return {
        canonicalKey,
        screens,
        representative:
          screens.find((screen) => screen.locale === session.scope.mapLocale) ?? screens[0]!,
        coveredValues,
        expectedValues: expectedValues.size,
      } satisfies CorpusScreenGroup;
    })
    .sort(compareCorpusScreenGroups);

  const complete = groups.filter(
    (group) =>
      group.expectedValues > 0 &&
      expectedValues.size ===
        new Set(
          group.screens
            .map((screen) => screen.locale)
            .filter((locale) => expectedValues.has(locale)),
        ).size,
  ).length;

  return {
    groups,
    coverage: {
      logical: groups.length,
      complete,
      partial: groups.length - complete,
      shots: session.screens.length,
    },
  };
}

function compareCorpusScreenGroups(left: CorpusScreenGroup, right: CorpusScreenGroup): number {
  if (left.representative.depth !== right.representative.depth) {
    return left.representative.depth - right.representative.depth;
  }
  return left.representative.path.join("/").localeCompare(right.representative.path.join("/"));
}
