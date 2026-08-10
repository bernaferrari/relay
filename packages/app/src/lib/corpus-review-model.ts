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

export type CorpusComparisonModel = {
  baseline: CorpusScreen;
  values: string[];
  selectedValue: string | null;
  target: CorpusScreen | null;
};

export type CorpusRunProgressModel = {
  completed: number;
  total: number;
  percentage: number;
  currentValue: string | null;
  currentPosition: number | null;
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

/** Builds a bounded two-up comparison regardless of corpus size. */
export function buildCorpusComparison(
  session: CorpusSession,
  canonicalKey: string | null,
  requestedValue?: string | null,
): CorpusComparisonModel | null {
  if (!canonicalKey) return null;
  const screens = session.screens.filter((screen) => screen.canonicalKey === canonicalKey);
  if (screens.length === 0) return null;
  const baseline =
    screens.find((screen) => screen.locale === session.scope.mapLocale) ?? screens[0]!;
  const values = session.scope.locales.filter((locale) => locale !== baseline.locale);
  if (values.length === 0) return null;
  const selectedValue =
    (requestedValue && values.includes(requestedValue) ? requestedValue : undefined) ??
    values.find((locale) => screens.some((screen) => screen.locale === locale)) ??
    values[0] ??
    null;
  return {
    baseline,
    values,
    selectedValue,
    target: screens.find((screen) => screen.locale === selectedValue) ?? null,
  };
}

export function buildCorpusRunProgress(session: CorpusSession): CorpusRunProgressModel {
  const values = session.scope.locales;
  const completedValues =
    session.status === "complete"
      ? values
      : (session.progress.completedLocales ?? []).filter((locale) => values.includes(locale));
  const completed = new Set(completedValues).size;
  const currentValue = session.progress.locale ?? session.currentLocale ?? null;
  const currentIndex = currentValue ? values.indexOf(currentValue) : -1;
  return {
    completed,
    total: values.length,
    percentage: values.length > 0 ? Math.round((completed / values.length) * 100) : 0,
    currentValue,
    currentPosition: currentIndex >= 0 ? currentIndex + 1 : null,
  };
}

function compareCorpusScreenGroups(left: CorpusScreenGroup, right: CorpusScreenGroup): number {
  if (left.representative.depth !== right.representative.depth) {
    return left.representative.depth - right.representative.depth;
  }
  return left.representative.path.join("/").localeCompare(right.representative.path.join("/"));
}
