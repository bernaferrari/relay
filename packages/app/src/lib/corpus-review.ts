import type {
  CorpusAnalysisReport,
  CorpusCoverageReport,
  CorpusFinding,
  CorpusProgress,
  CorpusScreen,
  CorpusSession,
} from "@relay/protocol";
import {
  type LocaleCellVerdict,
  type LocaleVerdictTally,
  localeVerdictOrder,
  localeVerdictPresentation,
  worstLocaleVerdict,
} from "./locale-matrix-verdict";

/**
 * A locale sweep, arranged the way the Combine grid already reads.
 *
 * Relay grew two locale paths. A Combine batch runs one Test across the values
 * of a Variable, and its grid has spoken verdicts for a while. A corpus session
 * crawls every screen of an app once and replays that tree in every language,
 * which is the shape a person means by "forty screens, forty languages" — and
 * until now it only had a CLI.
 *
 * This module is the projection, not a second vocabulary: the verdicts, their
 * order and their copy come from locale-matrix-verdict, so a corpus finding and
 * a Combine cell read identically. Nothing here fetches or styles.
 */
export type CorpusReviewCell = {
  locale: string;
  /** Screenshot id for this language's copy of the screen, once captured. */
  screenId?: string;
  verdict: LocaleCellVerdict;
  findings: readonly CorpusFinding[];
  /** Findings somebody already accepted. Kept beside the cell so they can be
   * read and un-accepted, rather than silently dropped. */
  known: readonly CorpusFinding[];
};

/**
 * How much of the sweep the analysis could actually read.
 *
 * Every check except "was it captured at all" compares control labels, so a
 * screenshot taken while the accessibility tree was missing carries no evidence
 * to compare. Counting those is what stops a tree-less sweep from reading as
 * forty clean languages.
 */
export type CorpusReviewCoverage = {
  captured: number;
  inspected: number;
};

export type CorpusReviewScreen = {
  canonicalKey: string;
  label: string;
  /** The locale every other language on this row was compared against. */
  baselineScreenId?: string;
  cells: CorpusReviewCell[];
  defects: number;
};

export type CorpusReviewLocale = {
  locale: string;
  captured: number;
  total: number;
  /** The sweep reached the end of the mapped tree in this language. */
  complete: boolean;
};

export type CorpusReview = {
  sessionId: string;
  name: string;
  status: CorpusSession["status"];
  phase: CorpusProgress["phase"];
  baselineLocale: string;
  locales: readonly string[];
  screens: CorpusReviewScreen[];
  localeProgress: CorpusReviewLocale[];
  /** False until an analysis has looked at the sweep: absent is not clean. */
  analyzed: boolean;
  coverage: CorpusReviewCoverage;
  /** Still on device, so an uncaptured cell is pending rather than missing. */
  sweeping: boolean;
  tallies: LocaleVerdictTally[];
  defects: number;
  /** How much of this sweep is repeat news a person already signed off. */
  known: number;
};

const sweepingStatuses = new Set<CorpusSession["status"]>(["draft", "running", "paused"]);

function cellKey(canonicalKey: string, locale: string): string {
  return `${canonicalKey}\n${locale}`;
}

/**
 * The crawl recorded a control list for this screen, so its copy is there to be
 * compared. Same rule the Combine grid applies to a pack frame — a screenshot
 * taken while the tree was missing has been captured, not checked.
 */
function inspected(screen: CorpusScreen | undefined): boolean {
  return Boolean(screen?.controls?.length);
}

/** Mirrors the label buildCorpusCoverage picks, for sweeps read before a
 * coverage report has been asked for. */
function fallbackLabel(session: CorpusSession, canonicalKey: string): string {
  const group = session.screens.filter((screen) => screen.canonicalKey === canonicalKey);
  return (
    group.find((screen) => screen.title)?.title ??
    group[0]?.path.at(-1) ??
    canonicalKey.slice(0, 12)
  );
}

export function corpusReview(input: {
  session: CorpusSession;
  coverage?: CorpusCoverageReport | null;
  analysis?: CorpusAnalysisReport | null;
  /** Ids of findings already accepted, so a repeat sweep stays quiet about them. */
  known?: ReadonlySet<string> | null;
}): CorpusReview {
  const { session, coverage, analysis } = input;
  const accepted = input.known ?? new Set<string>();
  const locales = session.scope.locales;
  const baselineLocale =
    analysis?.baselineLocale ??
    session.scope.mapLocale ??
    locales[0] ??
    session.currentLocale ??
    "";
  const sweeping = sweepingStatuses.has(session.status);

  const captured = new Map<string, CorpusScreen>();
  for (const screen of session.screens) {
    captured.set(cellKey(screen.canonicalKey, screen.locale), screen);
  }
  const findingsByCell = new Map<string, CorpusFinding[]>();
  for (const finding of analysis?.findings ?? []) {
    const key = cellKey(finding.canonicalKey, finding.locale);
    findingsByCell.set(key, [...(findingsByCell.get(key) ?? []), finding]);
  }

  const keys = coverage?.screens.length
    ? coverage.screens.map((item) => ({ canonicalKey: item.canonicalKey, label: item.label }))
    : [...new Set(session.screens.map((screen) => screen.canonicalKey))]
        .map((canonicalKey) => ({ canonicalKey, label: fallbackLabel(session, canonicalKey) }))
        .sort((left, right) => left.label.localeCompare(right.label));

  const screens = keys.map(({ canonicalKey, label }) => {
    const baselineScreen = captured.get(cellKey(canonicalKey, baselineLocale));
    // Nothing on this row is comparable unless the baseline itself was read, so
    // a baseline captured without a tree leaves the whole row unchecked.
    const comparable = inspected(baselineScreen);
    const cells = locales.map((locale): CorpusReviewCell => {
      const screen = captured.get(cellKey(canonicalKey, locale));
      const found = findingsByCell.get(cellKey(canonicalKey, locale)) ?? [];
      // A sweep that has not reached this language yet is missing nothing. The
      // analysis is happy to call an uncaptured screen SCREEN_MISSING mid-run,
      // so those findings are held back rather than shown as defects a person
      // would go looking for.
      const reported = screen || !sweeping ? found : [];
      const known = reported.filter((finding) => accepted.has(finding.id));
      const findings = reported.filter((finding) => !accepted.has(finding.id));
      // A cell whose every finding was accepted says so. Calling it a pass
      // would claim the analysis found nothing, which is not what happened.
      const settled: LocaleCellVerdict = known.length
        ? "known"
        : analysis && comparable && inspected(screen)
          ? "pass"
          : "unanalyzed";
      const verdict: LocaleCellVerdict = screen
        ? (worstLocaleVerdict(findings) ?? settled)
        : sweeping
          ? "pending"
          : (worstLocaleVerdict(findings) ?? (known.length ? "known" : "missing"));
      return { locale, verdict, findings, known, ...(screen ? { screenId: screen.id } : {}) };
    });
    return {
      canonicalKey,
      label,
      cells,
      defects: countDefects(cells),
      ...(baselineScreen ? { baselineScreenId: baselineScreen.id } : {}),
    };
  });

  const completedLocales = new Set(session.progress.completedLocales ?? []);
  const localeProgress = locales.map((locale) => ({
    locale,
    captured: screens.filter((screen) =>
      screen.cells.some((cell) => cell.locale === locale && cell.screenId),
    ).length,
    total: screens.length,
    complete: completedLocales.has(locale),
  }));

  const cells = screens.flatMap((screen) => screen.cells);
  return {
    sessionId: session.id,
    name: session.name,
    status: session.status,
    phase: session.progress.phase,
    baselineLocale,
    locales,
    screens,
    localeProgress,
    analyzed: Boolean(analysis),
    coverage: {
      captured: session.screens.length,
      inspected: session.screens.filter(inspected).length,
    },
    sweeping,
    tallies: tallyCorpusVerdicts(cells),
    defects: countDefects(cells),
    known: cells.reduce((total, cell) => total + cell.known.length, 0),
  };
}

export function tallyCorpusVerdicts(cells: readonly CorpusReviewCell[]): LocaleVerdictTally[] {
  const counts = new Map<LocaleCellVerdict, number>();
  for (const cell of cells) counts.set(cell.verdict, (counts.get(cell.verdict) ?? 0) + 1);
  return localeVerdictOrder.flatMap((verdict) => {
    const count = counts.get(verdict) ?? 0;
    return count ? [{ verdict, count }] : [];
  });
}

function countDefects(cells: readonly CorpusReviewCell[]): number {
  return cells.filter((cell) => localeVerdictPresentation(cell.verdict).tone === "defect").length;
}

/** The immutable PNG for one captured screen, served straight from the sweep. */
export function corpusScreenUrl(serverUrl: string, sessionId: string, screenId: string): string {
  return `${serverUrl.replace(/\/+$/, "")}/corpus/${encodeURIComponent(sessionId)}/screens/${encodeURIComponent(screenId)}`;
}

const phaseLabels: Record<CorpusProgress["phase"], string> = {
  idle: "Not started",
  opening: "Opening the app",
  mapping: "Mapping screens",
  "switching-language": "Switching language",
  replaying: "Replaying in this language",
  crawling: "Crawling screens",
  exporting: "Writing the pack",
  complete: "Finished",
  failed: "Stopped on an error",
};

export function corpusPhaseLabel(phase: CorpusProgress["phase"]): string {
  return phaseLabels[phase];
}

const statusLabels: Record<CorpusSession["status"], string> = {
  draft: "Not started",
  running: "Sweeping",
  paused: "Paused",
  complete: "Finished",
  stopped: "Stopped",
  failed: "Failed",
};

/**
 * What a sweep is doing, in one phrase. Mid-sweep the phase is the interesting
 * half — "switching language" is the answer to "why has nothing moved". Once it
 * has stopped, the status is the durable truth: a finished sweep whose progress
 * was never written must not read as "Not started".
 */
export function corpusStateLabel(review: Pick<CorpusReview, "status" | "phase">): string {
  return review.status === "running" ? corpusPhaseLabel(review.phase) : statusLabels[review.status];
}

/** Sweeps a person is most likely to want first: the live one, then the newest. */
export function sortCorpusSessions(sessions: readonly CorpusSession[]): CorpusSession[] {
  return [...sessions].sort((left, right) => {
    const live = Number(right.status === "running") - Number(left.status === "running");
    return live || right.updatedAt - left.updatedAt;
  });
}
