import type { CombineEvidenceFinding, CombineEvidenceFindingCode } from "@relay/protocol";
import type { IconName } from "../components/icon";
import type { CombineCapture, CombineRow } from "./combine-review";

/**
 * Presentation vocabulary for one locale-aware Combine cell. Durable findings
 * and screenshots meet here, so a person does not have to compare every image
 * by eye. The module speaks the evidence contract directly and keeps
 * the heuristics honest: `confidence: "medium"` findings are phrased as
 * possibilities, because a layout heuristic cannot prove a translation wrong.
 */
export type CombineCellVerdict =
  | "pass"
  | "not-applied"
  | "clipped"
  | "untranslated"
  | "missing"
  | "failed"
  | "pending"
  | "unanalyzed"
  /** Everything this cell reported has already been looked at and accepted. */
  | "known";

/** Worst first. A cell shows one verdict, so it must be the one worth acting on. */
const findingVerdicts: Record<CombineEvidenceFindingCode, CombineCellVerdict> = {
  POSSIBLE_LOCALE_NOT_APPLIED: "not-applied",
  POSSIBLE_TEXT_CLIPPED: "clipped",
  POSSIBLE_UNTRANSLATED_TEXT: "untranslated",
  SCREEN_MISSING: "missing",
  CONTROL_MISSING: "missing",
};

const verdictRank: Record<CombineCellVerdict, number> = {
  failed: 0,
  "not-applied": 1,
  clipped: 2,
  untranslated: 3,
  missing: 4,
  pending: 5,
  unanalyzed: 6,
  pass: 7,
  known: 8,
};

export type CombineCellAnalysis = {
  findings: readonly CombineEvidenceFinding[];
  /** Locale each finding was compared against. Shown so a verdict is auditable. */
  baselineLabel?: string;
};

export type CombineCellInput = {
  status: string;
  capture: Pick<CombineCapture, "frame"> | undefined;
  /** Absent until analysis runs. Absent is not the same as clean. */
  analysis?: CombineCellAnalysis | undefined;
};

const activeStatuses = new Set(["queued", "running", "paused"]);
const failedStatuses = new Set(["error", "cancelled"]);

/**
 * The one verdict a set of findings earns across Combine analysis and review.
 */
export function worstCombineVerdict(
  findings: readonly CombineEvidenceFinding[],
): CombineCellVerdict | undefined {
  return findings
    .map((finding) => findingVerdicts[finding.code])
    .sort((left, right) => verdictRank[left] - verdictRank[right])[0];
}

export function combineCellVerdict(input: CombineCellInput): CombineCellVerdict {
  if (failedStatuses.has(input.status)) return "failed";
  if (activeStatuses.has(input.status)) return "pending";
  if (!input.capture?.frame) return "missing";
  const worst = worstCombineVerdict(input.analysis?.findings ?? []);
  if (worst) return worst;
  // A screenshot nobody has inspected is not a pass. Saying so is what makes the
  // grid trustworthy once analysis starts filling it in.
  return input.analysis ? "pass" : "unanalyzed";
}

export type CombineVerdictPresentation = {
  verdict: CombineCellVerdict;
  label: string;
  /** One-line explanation for tooltips and the legend. */
  hint: string;
  icon: IconName;
  /** Drives ink and fill through one switch instead of per-call ternaries. */
  tone: "pass" | "defect" | "warn" | "neutral" | "progress";
};

const presentations: Record<CombineCellVerdict, Omit<CombineVerdictPresentation, "verdict">> = {
  pass: {
    label: "Pass",
    hint: "Compared against the baseline locale with nothing to report.",
    icon: "check",
    tone: "pass",
  },
  "not-applied": {
    label: "Locale not applied",
    hint: "This screen still looks like the baseline locale, so the switch may not have taken.",
    icon: "alert",
    tone: "defect",
  },
  clipped: {
    label: "Clipped text",
    hint: "Translated text is probably too long for the control holding it.",
    icon: "alert",
    tone: "defect",
  },
  untranslated: {
    label: "Untranslated",
    hint: "Text appears to have been left in the baseline language.",
    icon: "info",
    tone: "warn",
  },
  missing: {
    label: "Missing",
    hint: "A screen or control the baseline has never showed up here.",
    icon: "camera",
    tone: "warn",
  },
  failed: {
    label: "Run failed",
    hint: "This locale never reached the screen, so there is nothing to compare.",
    icon: "slash",
    tone: "defect",
  },
  pending: {
    label: "Capturing",
    hint: "This cell is still queued or on device.",
    icon: "clock",
    tone: "progress",
  },
  unanalyzed: {
    label: "Not checked",
    hint: "Captured, but no locale analysis has looked at it yet.",
    icon: "circle",
    tone: "neutral",
  },
  known: {
    label: "Known",
    hint: "Everything reported here has already been looked at and accepted.",
    icon: "check",
    tone: "neutral",
  },
};

export function combineVerdictPresentation(
  verdict: CombineCellVerdict,
): CombineVerdictPresentation {
  return { verdict, ...presentations[verdict] };
}

/** Legend and filter order: defect-first, so problems are reachable without
 * scanning a forty-row grid. */
export const combineVerdictOrder: readonly CombineCellVerdict[] = [
  "not-applied",
  "clipped",
  "untranslated",
  "failed",
  "missing",
  "unanalyzed",
  "pending",
  "pass",
  "known",
];

/**
 * Heuristic findings are reported as possibilities, so the cell must not assert
 * a defect the analysis only suspects. Every "POSSIBLE_" code arrives with a
 * confidence, and medium confidence earns a hedge in the copy.
 */
export function combineFindingHeadline(finding: CombineEvidenceFinding): string {
  const label = combineVerdictPresentation(findingVerdicts[finding.code]).label;
  return finding.confidence === "medium" ? `Possible ${label.toLocaleLowerCase()}` : label;
}

export type CombineVerdictTally = { verdict: CombineCellVerdict; count: number };

export function summarizeCombineVerdicts(
  rows: readonly CombineRow[],
  captureIndex: number,
  analysisFor?: (row: CombineRow, captureIndex: number) => CombineCellAnalysis | undefined,
): CombineVerdictTally[] {
  const counts = new Map<CombineCellVerdict, number>();
  for (const row of rows) {
    const verdict = combineCellVerdict({
      status: row.job.status,
      capture: row.captures[captureIndex],
      analysis: analysisFor?.(row, captureIndex),
    });
    counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
  }
  return combineVerdictOrder.flatMap((verdict) => {
    const count = counts.get(verdict) ?? 0;
    return count ? [{ verdict, count }] : [];
  });
}

export function combineCellDefectCount(tallies: readonly CombineVerdictTally[]): number {
  return tallies
    .filter(({ verdict }) => combineVerdictPresentation(verdict).tone === "defect")
    .reduce((total, { count }) => total + count, 0);
}
