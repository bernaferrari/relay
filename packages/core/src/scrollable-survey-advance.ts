import type { SnapshotNode } from "./device.js";
import type { SnapshotPayload } from "./workspace-capture.js";
import { isSystemSemantic, normalizedSemanticPart } from "./scrollable-survey-seams.js";

export type SurveyFeatureRow = {
  label: string;
  y: number;
  height: number;
  bottom: number;
};

function isScrollContainer(node: SnapshotNode): boolean {
  return /scrollview|scrollarea|recycler.?view|listview/i.test(
    `${node.type ?? ""} ${node.role ?? ""}`,
  );
}

function scrollViewport(snapshot: SnapshotPayload): { y: number; height: number } | undefined {
  const views = snapshot.nodes.filter(
    (node) => isScrollContainer(node) && node.rect && node.rect.height >= 120,
  );
  const hinted = views.find((node) => node.hiddenContentBelow === true);
  const recycler = views.find((node) =>
    /recycler.?view|listview/i.test(`${node.type ?? ""} ${node.role ?? ""}`),
  );
  const chosen = hinted ?? recycler ?? views[0];
  return chosen?.rect ? { y: chosen.rect.y, height: chosen.rect.height } : undefined;
}

function stickyLegalFooter(snapshot: SnapshotPayload): SnapshotNode | undefined {
  const scroll = scrollViewport(snapshot);
  const scrollBottom = scroll ? scroll.y + scroll.height : (snapshot.bounds?.height ?? 0) * 0.92;
  return snapshot.nodes.find((node) => isStickyFooter(node, scrollBottom));
}

function hasStickyLegalFooter(snapshot: SnapshotPayload): boolean {
  return Boolean(stickyLegalFooter(snapshot));
}

const FOOTER_CLEARANCE_PX = 80;

/** Last feature is in the fade under the sticky legal row and is not yet clear. */
export function surveyLastFeatureObscuredByFooter(snapshot: SnapshotPayload): boolean {
  if (!hasStickyLegalFooter(snapshot)) return false;
  const last = surveyLastUnclippedFeature(snapshot) ?? surveyFeatureRows(snapshot).at(-1);
  if (!last) return false;
  const scroll = scrollViewport(snapshot);
  const scrollBottom = scroll ? scroll.y + scroll.height : (snapshot.bounds?.height ?? 0) * 0.92;
  const footer = stickyLegalFooter(snapshot);
  const fadeTop = Math.min(footer?.rect?.y ?? scrollBottom, scrollBottom) - FOOTER_CLEARANCE_PX;
  // Tall wrapped rows can dip into the fade while their label is already
  // readable. Only the row that starts in that band is still covered.
  return last.y > fadeTop - 12 && last.bottom > fadeTop;
}

function isStickyFooter(node: SnapshotNode, scrollBottom: number): boolean {
  if (!node.rect || !node.label?.trim()) return false;
  // A full-height legal row sitting on the scroll edge is chrome. A 3px
  // sliver at that same edge is clipped content and must stay a feature.
  if (node.rect.y >= scrollBottom - 4 && node.rect.height >= 36) return true;
  const label = normalizedSemanticPart(node.label);
  return (
    node.rect.y > scrollBottom - 80 &&
    /privacy|terms|شروط|سياسة|gizlilik|vilkår|privacidad|confidentialit|datenschutz/u.test(label)
  );
}

/** Lowest labeled content row that is not system chrome, tab chrome, or the sticky legal footer. */
export function surveyFeatureRows(snapshot: SnapshotPayload): SurveyFeatureRow[] {
  const boundsHeight = snapshot.bounds?.height ?? 0;
  const scroll = scrollViewport(snapshot);
  const scrollBottom = scroll ? scroll.y + scroll.height : boundsHeight * 0.92;
  const headerCut = Math.max(280, boundsHeight * 0.28);
  const rows: SurveyFeatureRow[] = [];
  for (const node of snapshot.nodes) {
    if (!node.rect || node.visibleToUser === false || isSystemSemantic(node)) continue;
    const label = node.label?.trim();
    if (!label) continue;
    if (/^(back|home|recents|close)$/iu.test(label)) continue;
    if (node.rect.y < headerCut) continue;
    if (isStickyFooter(node, scrollBottom)) continue;
    rows.push({
      label,
      y: node.rect.y,
      height: node.rect.height,
      bottom: node.rect.y + node.rect.height,
    });
  }
  return rows.sort((left, right) => left.bottom - right.bottom);
}

export function surveyHasHiddenContentBelow(snapshot: SnapshotPayload): boolean {
  return snapshot.nodes.some((node) => node.hiddenContentBelow === true);
}

/** Provider explicitly proved the scroller has nothing left below. Absence of
 * a hint is not exhaustion. */
export function surveyHasExplicitExhaustion(snapshot: SnapshotPayload): boolean {
  return snapshot.nodes.some((node) => node.hiddenContentBelow === false);
}

export function surveyRowFlushWithScroll(
  row: SurveyFeatureRow,
  snapshot: SnapshotPayload,
): boolean {
  const scroll = scrollViewport(snapshot);
  if (!scroll) return false;
  return row.bottom >= scroll.y + scroll.height - 4;
}

/** Last feature that is fully inside the scroll viewport (not the faded/clipped tail). */
export function surveyLastUnclippedFeature(
  snapshot: SnapshotPayload,
): SurveyFeatureRow | undefined {
  const rows = surveyFeatureRows(snapshot);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (!surveyRowFlushWithScroll(row, snapshot)) return row;
  }
  return undefined;
}

export type EndOfContentEvidence =
  | "helper-exhausted-and-last-row-unclipped"
  | "physical-scroll-stationary";

export type SurveyExtent =
  | { kind: "complete"; evidence: EndOfContentEvidence }
  | { kind: "partial"; reason: string }
  | { kind: "unknown"; reason: string };

/**
 * Completeness is independent of whether another fling is worth trying.
 * Hidden content below a fully visible last label is unknown, not complete.
 */
export function surveyExtent(snapshot: SnapshotPayload): SurveyExtent {
  const rows = surveyFeatureRows(snapshot);
  const last = surveyLastUnclippedFeature(snapshot) ?? rows.at(-1);
  const clipped = rows.some((row) => surveyRowFlushWithScroll(row, snapshot));
  if (surveyLastFeatureObscuredByFooter(snapshot)) {
    return { kind: "partial", reason: "last labeled row sits under the sticky legal footer" };
  }
  if (surveyHasHiddenContentBelow(snapshot)) {
    if (last && !clipped) {
      return {
        kind: "unknown",
        reason: "helper reports hidden content below the last visible label",
      };
    }
    return { kind: "partial", reason: "helper reports hidden content below" };
  }
  if (!surveyHasExplicitExhaustion(snapshot)) {
    return {
      kind: "unknown",
      reason: "scroll helper did not report whether more content exists",
    };
  }
  if (clipped) {
    return { kind: "partial", reason: "last labeled row is clipped or flush with the fold" };
  }
  if (!last) {
    return { kind: "complete", evidence: "physical-scroll-stationary" };
  }
  return { kind: "complete", evidence: "helper-exhausted-and-last-row-unclipped" };
}

/**
 * Scroll only when the tree says there is more, a row is clipped into the
 * fade, or the last row sits too close to the fold to be sure.
 *
 * A false result is a bounded fling skip (Compose bounce / flush legal
 * footer). It is not evidence that the document is complete — use
 * `surveyExtent` for that claim.
 */
export function surveyShouldAttemptScroll(snapshot: SnapshotPayload): boolean {
  const scroll = scrollViewport(snapshot);
  if (!scroll) return true;
  const rows = surveyFeatureRows(snapshot);
  if (rows.some((row) => surveyRowFlushWithScroll(row, snapshot))) return true;
  if (surveyLastFeatureObscuredByFooter(snapshot)) return true;
  const last = surveyLastUnclippedFeature(snapshot) ?? rows.at(-1);
  if (!last) return true;
  const fullyOnScreen = last.bottom <= scroll.y + scroll.height - 8;
  // Compose paywalls keep can-scroll-forward after the last feature while a
  // legal footer is already flush. Nested Settings lists have the same hint
  // because more rows exist — trust the hint when there is no footer.
  if (surveyHasHiddenContentBelow(snapshot) && !hasStickyLegalFooter(snapshot)) return true;
  if (fullyOnScreen) return false;
  return surveyHasHiddenContentBelow(snapshot);
}

function contentLabels(snapshot: SnapshotPayload): Set<string> {
  return new Set(surveyFeatureRows(snapshot).map((row) => normalizedSemanticPart(row.label)));
}

/**
 * Keep a scrolled viewport when it reveals a new labeled row or unclips a
 * previously faded row. Title-only slides add neither.
 */
export function surveyShouldKeepScrolledFrame(
  previous: SnapshotPayload,
  current: SnapshotPayload,
): boolean {
  const previousRows = surveyFeatureRows(previous);
  const currentRows = surveyFeatureRows(current);
  if (previousRows.length === 0 && currentRows.length === 0) return true;
  const before = contentLabels(previous);
  const after = contentLabels(current);
  for (const label of after) {
    if (!before.has(label)) return true;
  }
  for (const label of before) {
    if (!after.has(label)) return true;
  }
  const currentByLabel = new Map(
    currentRows.map((row) => [normalizedSemanticPart(row.label), row]),
  );
  for (const row of previousRows) {
    if (!surveyRowFlushWithScroll(row, previous)) continue;
    const next = currentByLabel.get(normalizedSemanticPart(row.label));
    if (next && next.height > row.height + 4) return true;
    if (next && !surveyRowFlushWithScroll(next, current)) return true;
  }
  if (surveyLastFeatureObscuredByFooter(previous) && !surveyLastFeatureObscuredByFooter(current)) {
    return true;
  }
  return false;
}

export {
  surveyPaywallFrameDecision,
  type SurveyPaywallFrameDecision,
} from "./scrollable-survey-settle.js";

/** Cut a non-final frame above the fade / clipped tail so the next frame supplies the sharp pixels. */
export function surveyStitchCutY(snapshot: SnapshotPayload, fallback: number): number {
  const last = surveyLastUnclippedFeature(snapshot);
  if (!last) return fallback;
  if (last.bottom <= 0 || last.bottom >= fallback) return fallback;
  return Math.floor(last.bottom);
}
