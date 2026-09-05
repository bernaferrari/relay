import type { SnapshotNode } from "./device.js";
import type { SnapshotPayload } from "./workspace-capture.js";
import { isSystemSemantic, normalizedSemanticPart } from "./scrollable-survey-seams.js";

export type SurveyFeatureRow = {
  label: string;
  y: number;
  height: number;
  bottom: number;
};

function scrollViewport(snapshot: SnapshotPayload): { y: number; height: number } | undefined {
  const views = snapshot.nodes.filter((node) =>
    /scrollview|scrollarea|recycler.?view|listview/i.test(`${node.type ?? ""} ${node.role ?? ""}`),
  );
  const withRect = views.find((node) => node.rect && node.rect.height >= 120);
  return withRect?.rect
    ? { y: withRect.rect.y, height: withRect.rect.height }
    : undefined;
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

export function surveyRowFlushWithScroll(row: SurveyFeatureRow, snapshot: SnapshotPayload): boolean {
  const scroll = scrollViewport(snapshot);
  if (!scroll) return false;
  return row.bottom >= scroll.y + scroll.height - 4;
}

/** Last feature that is fully inside the scroll viewport (not the faded/clipped tail). */
export function surveyLastUnclippedFeature(snapshot: SnapshotPayload): SurveyFeatureRow | undefined {
  const rows = surveyFeatureRows(snapshot);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (!surveyRowFlushWithScroll(row, snapshot)) return row;
  }
  return undefined;
}

/**
 * Scroll only when the tree says there is more, a row is clipped into the
 * fade, or the last row sits too close to the fold to be sure.
 */
export function surveyShouldAttemptScroll(snapshot: SnapshotPayload): boolean {
  if (surveyHasHiddenContentBelow(snapshot)) return true;
  const scroll = scrollViewport(snapshot);
  if (!scroll) return true;
  const rows = surveyFeatureRows(snapshot);
  if (rows.some((row) => surveyRowFlushWithScroll(row, snapshot))) return true;
  const last = surveyLastUnclippedFeature(snapshot) ?? rows.at(-1);
  if (!last) return true;
  const emptyTail = Math.max(96, Math.round(scroll.height * 0.07));
  return last.bottom > scroll.y + scroll.height - emptyTail;
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
  return false;
}

/** Cut a non-final frame above the fade / clipped tail so the next frame supplies the sharp pixels. */
export function surveyStitchCutY(
  snapshot: SnapshotPayload,
  fallback: number,
): number {
  const last = surveyLastUnclippedFeature(snapshot);
  if (!last) return fallback;
  if (last.bottom <= 0 || last.bottom >= fallback) return fallback;
  return Math.floor(last.bottom);
}
