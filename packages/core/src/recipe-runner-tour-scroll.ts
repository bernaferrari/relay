import type { TourStop } from "./tour.js";

export type TourRowAlignment = {
  stops: TourStop[];
  missingRequired: TourStop[];
  missingOptional: TourStop[];
  strategy: "identifier" | "recorded-order" | "semantic";
};

function normalized(value: string | undefined): string | undefined {
  const result = value?.normalize("NFKC").trim().toLocaleLowerCase();
  return result || undefined;
}

export function tourRowKey(stop: Pick<TourStop, "identifier" | "label">): string {
  const identifier = normalized(stop.identifier);
  return identifier ? `id:${identifier}` : `label:${normalized(stop.label) ?? ""}`;
}

export function tourViewportKey(stops: ReadonlyArray<TourStop>): string {
  return stops
    .map((stop) => {
      // Geometry is used only to detect movement between adjacent snapshots
      // in the same live locale. It never participates in cross-locale row
      // alignment. Coarse buckets absorb ordinary AX measurement jitter.
      const y = stop.point ? Math.round(stop.point.y / 24) : undefined;
      return `${tourRowKey(stop)}${y === undefined ? "" : `@${y}`}`;
    })
    .join("|");
}

/**
 * Join consecutive, overlapping accessibility viewports without relying on
 * their geometry. A translated row may become taller, but its live label (or
 * stable identifier) remains the same while it crosses the viewport edge.
 */
export function mergeTourViewportRows(
  collected: ReadonlyArray<TourStop>,
  viewport: ReadonlyArray<TourStop>,
): TourStop[] {
  if (!collected.length) return [...viewport];
  if (!viewport.length) return [...collected];
  const maximumOverlap = Math.min(collected.length, viewport.length);
  let overlap = 0;
  for (let size = maximumOverlap; size > 0; size--) {
    const collectedTail = collected.slice(-size).map(tourRowKey);
    const viewportHead = viewport.slice(0, size).map(tourRowKey);
    if (collectedTail.every((key, index) => key === viewportHead[index])) {
      overlap = size;
      break;
    }
  }
  return [...collected, ...viewport.slice(overlap)];
}

function exactLiveMatch(live: ReadonlyArray<TourStop>, mapped: TourStop): TourStop | undefined {
  const identifier = normalized(mapped.identifier);
  if (identifier) {
    const matches = live.filter((candidate) => normalized(candidate.identifier) === identifier);
    if (matches.length === 1) return matches[0];
  }
  const label = normalized(mapped.label);
  const matches = live.filter((candidate) => normalized(candidate.label) === label);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Align the complete live list to the authored list. Stable identifiers win.
 * When labels translate, a complete landmark list permits position matching,
 * but only when both lists have the same cardinality. Inserted or missing rows
 * remain an explicit authoring gap instead of shifting every later tap.
 */
export function alignTourRowsAcrossReflow(
  live: ReadonlyArray<TourStop>,
  mapped: ReadonlyArray<TourStop>,
  landmarks: ReadonlyArray<TourStop> = [],
): TourRowAlignment {
  const exact = mapped.map((stop) => exactLiveMatch(live, stop));
  const allExact = exact.every((stop): stop is TourStop => Boolean(stop));
  if (allExact) {
    return {
      stops: exact,
      missingRequired: [],
      missingOptional: [],
      strategy: mapped.every((stop) => Boolean(stop.identifier)) ? "identifier" : "semantic",
    };
  }

  // When every recorded row is selected, the mapped list itself is the full
  // calibration order. This is safe only after the runtime has indexed the
  // complete live list—not for the old single-viewport order matcher.
  const calibration = landmarks.length ? landmarks : mapped;
  const landmarkIndexes = new Map<string, number[]>();
  for (const [index, landmark] of calibration.entries()) {
    const key = tourRowKey(landmark);
    const indexes = landmarkIndexes.get(key) ?? [];
    indexes.push(index);
    landmarkIndexes.set(key, indexes);
  }
  const mayUseRecordedOrder = calibration.length > 0 && live.length === calibration.length;
  const aligned: TourStop[] = [];
  const missingRequired: TourStop[] = [];
  const missingOptional: TourStop[] = [];
  for (const [index, mappedStop] of mapped.entries()) {
    const semanticMatch = exact[index];
    const recordedIndexes = landmarkIndexes.get(tourRowKey(mappedStop)) ?? [];
    const orderMatch =
      mayUseRecordedOrder && recordedIndexes.length === 1 ? live[recordedIndexes[0]!] : undefined;
    const match = semanticMatch ?? orderMatch;
    if (match) {
      aligned.push({
        ...match,
        ...(mappedStop.capture === undefined ? {} : { capture: mappedStop.capture }),
        ...(mappedStop.optional === undefined ? {} : { optional: mappedStop.optional }),
      });
    } else if (mappedStop.optional) {
      missingOptional.push(mappedStop);
    } else {
      missingRequired.push(mappedStop);
    }
  }
  return {
    stops: aligned,
    missingRequired,
    missingOptional,
    strategy: mayUseRecordedOrder ? "recorded-order" : "semantic",
  };
}

export function visibleTourRow(
  viewport: ReadonlyArray<TourStop>,
  target: Pick<TourStop, "identifier" | "label">,
): TourStop | undefined {
  return exactLiveMatch(viewport, target);
}

/** A returned parent is proven by a stable row identifier or by two live
 * labels from the exact viewport that launched the child. This survives row
 * height changes without accepting a child page that merely repeats its title. */
export function matchesTourViewportCheckpoint(
  viewport: ReadonlyArray<TourStop>,
  checkpoint: ReadonlyArray<TourStop>,
): boolean {
  if (!viewport.length || !checkpoint.length) return false;
  const identifiers = new Set(
    viewport.map((stop) => normalized(stop.identifier)).filter((value): value is string => !!value),
  );
  if (
    checkpoint.some((stop) => {
      const identifier = normalized(stop.identifier);
      return identifier ? identifiers.has(identifier) : false;
    })
  ) {
    return true;
  }
  const labels = new Set(viewport.map((stop) => normalized(stop.label)));
  const overlap = checkpoint.filter((stop) => labels.has(normalized(stop.label))).length;
  return overlap >= Math.min(2, checkpoint.length);
}
