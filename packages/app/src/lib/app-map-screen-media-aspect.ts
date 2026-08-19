/**
 * A grid of phone screenshots in landscape frames is mostly empty frame. The
 * canvas already avoids that — `screenCardGeometry` lets the frame follow the
 * captured media exactly — and the Screens grid and the locale grid want the
 * same thing without giving up a shared baseline across a row.
 *
 * So the grid picks one aspect for every tile in it, from the silhouette its
 * screens actually have. A map of one phone gets phone-shaped tiles that the
 * screenshot fills; a map that mixes a phone and a tablet picks whichever it
 * has more of, and the minority letterboxes inside a frame that still lines up.
 */

/** Matches `screenCardGeometry`, so a screen keeps one silhouette in both
 * views and neither is destabilized by a freak viewport. */
const MIN_RATIO = 0.46;
const MAX_RATIO = 2;

/** Used when nothing has been captured yet. Portrait, because an unmeasured
 * screen is far more often a phone than a tablet, and an empty portrait frame
 * is a smaller lie than an empty landscape one. */
export const FALLBACK_MEDIA_RATIO = 0.5;

export type MediaViewport = { width: number; height: number };

export function boundedMediaRatio(viewport: MediaViewport | undefined): number | undefined {
  if (!viewport?.width || !viewport.height) return undefined;
  const ratio = viewport.width / viewport.height;
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/**
 * Ratios are bucketed before they are counted: two captures of the same phone
 * can differ by a pixel of status bar, and that must not read as two different
 * devices and hand the grid a ratio neither screen has.
 */
function bucket(ratio: number): number {
  return Math.round(ratio * 50) / 50;
}

/** The most common silhouette among the screens that have one, as a CSS
 * `aspect-ratio` value. Ties go to the taller screen, which is the one whose
 * letterboxing would have been worst. */
export function dominantMediaRatio(viewports: ReadonlyArray<MediaViewport | undefined>): number {
  const counts = new Map<number, number>();
  for (const viewport of viewports) {
    const ratio = boundedMediaRatio(viewport);
    if (ratio === undefined) continue;
    const key = bucket(ratio);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (!counts.size) return FALLBACK_MEDIA_RATIO;
  let best = FALLBACK_MEDIA_RATIO;
  let bestCount = 0;
  for (const [ratio, count] of counts) {
    if (count > bestCount || (count === bestCount && ratio < best)) {
      best = ratio;
      bestCount = count;
    }
  }
  return best;
}

/** `aspect-ratio` wants a number or a ratio pair; a rounded decimal keeps the
 * inline style short and stable across re-renders. */
export function mediaAspectStyle(ratio: number): string {
  return String(Math.round(ratio * 1000) / 1000);
}

/** Height a tile's media aims for, so a column of phones is a readable
 * thumbnail rather than a poster. */
const TARGET_MEDIA_HEIGHT = 360;
const MIN_COLUMN = 132;
const MAX_COLUMN = 264;

/**
 * Tile width follows the silhouette: once the frame is portrait, a column wide
 * enough for a landscape screenshot would make every phone tile absurdly tall.
 * Deriving the column from the ratio keeps tile *height* roughly constant
 * across device families, which is what makes the grid read as one grid.
 */
export function screenGridColumnWidth(ratio: number): number {
  return Math.round(Math.min(MAX_COLUMN, Math.max(MIN_COLUMN, TARGET_MEDIA_HEIGHT * ratio)));
}
