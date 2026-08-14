import type { SnapshotNode } from "./device.js";
import { tourFallbackOverlap } from "./tour.js";
import type { TourStop } from "./tour.js";

export function leadingNavigationPoint(
  frame: { x: number; y: number; width: number; height: number } | undefined,
  rightToLeft: boolean,
): { x: number; y: number } {
  const insetX = frame ? Math.min(Math.max(frame.width * 0.08, 28), 44) : 44;
  const insetY = frame ? Math.min(Math.max(frame.height * 0.155, 56), 132) : 72;
  return {
    x: frame ? frame.x + (rightToLeft ? frame.width - insetX : insetX) : rightToLeft ? 1036 : 44,
    y: frame ? frame.y + insetY : 72,
  };
}

/**
 * Labels commonly exposed by native accessibility bridges for an app's
 * leading Back affordance. They are deliberately exact labels, rather than a
 * broad text search: a tour may only use a coordinate fallback when the
 * accessibility tree itself identifies the control as Back.
 */
const LOCALIZED_BACK_LABELS = new Set(
  [
    "back",
    "indietro",
    "atrás",
    "volver",
    "retour",
    "zurück",
    "voltar",
    "terug",
    "tillbaka",
    "tilbage",
    "tilbake",
    "takaisin",
    "geri",
    "назад",
    "رجوع",
    "عودة",
    "뒤로",
    "戻る",
    "返回",
  ].map((label) => label.toLocaleLowerCase()),
);

/**
 * Return the point for a leading app Back control only when accessibility
 * identifies it. Some Compose/SwiftUI bridges expose the arrow as a generic,
 * non-hittable View, so `pressNamedControl({ label })` cannot resolve it even
 * though its label and bounds are reliable. This keeps point input evidence
 * based, rather than guessing from a fixed corner.
 */
export function localizedLeadingBackPoint(
  nodes: readonly SnapshotNode[],
  rightToLeft = false,
): { x: number; y: number } | undefined {
  const candidates = nodes
    .flatMap((node) => {
      const label = node.label?.trim().toLocaleLowerCase();
      const rect = node.rect;
      if (!label || !rect || !LOCALIZED_BACK_LABELS.has(label)) return [];
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
      return [{ x, y }];
    })
    .filter((point) => point.y >= 0 && point.y <= 360)
    .filter((point) => (rightToLeft ? point.x >= 720 : point.x <= 360));
  return candidates.sort((left, right) => left.y - right.y)[0];
}

/**
 * Recover a parent list in the same direction a person would: first return to
 * its stable top boundary, then make a small bounded search toward the
 * recorded viewport. Starting by scrolling down can deepen an already-lost
 * Settings list and makes the next semantic row ambiguous.
 */
export function tourViewportRecoveryMoves(): Array<"up" | "down"> {
  return ["up", "up", "down", "down"];
}

/**
 * A verified screen identity only proves the parent surface. It does not
 * guarantee that the scroll checkpoint which contains a tour's recorded rows
 * is still in view. Sweep to the stable top first, then back through a small
 * window of the list. This is intentionally bounded: it is recovery for one
 * known parent, never blind exploration.
 */
export function tourMappedRowRecoveryMoves(): Array<"up" | "down"> {
  return ["up", "up", "up", "down", "down", "down"];
}

/**
 * A translated child can share labels and layout traits with its parent.
 * Never compensate for a failed return by scrolling: that turns an uncertain
 * Back action into destructive exploration inside the child. Locale runs
 * must first re-establish the exact mapped parent; otherwise they stop with
 * evidence for a person or agent to decide how to recover.
 */
export function mayRestoreTourViewportAfterReturn(input: {
  interactionSucceeded: boolean;
  localized: boolean;
  /** A locale-neutral app Back control was found in the child accessibility tree. */
  verifiedAppBack?: boolean;
}): boolean {
  return input.interactionSucceeded && (!input.localized || input.verifiedAppBack === true);
}

export function missingRequiredTourStops(
  live: ReadonlyArray<TourStop>,
  mapped: ReadonlyArray<TourStop>,
): TourStop[] {
  return mapped.filter((fallback) => {
    if (fallback.optional) return false;
    const expectedLabel = fallback.label.trim().toLocaleLowerCase();
    const expectedIdentifier = fallback.identifier?.trim().toLocaleLowerCase();
    return !live.some((candidate) => {
      const candidateLabel = candidate.label.trim().toLocaleLowerCase();
      const candidateIdentifier = candidate.identifier?.trim().toLocaleLowerCase();
      return (
        candidateLabel === expectedLabel ||
        Boolean(expectedIdentifier && candidateIdentifier === expectedIdentifier)
      );
    });
  });
}

export function mappedTourRowsNeedRefresh(
  live: ReadonlyArray<TourStop>,
  mapped: ReadonlyArray<TourStop>,
): boolean {
  return Boolean(mapped.length && missingRequiredTourStops(live, mapped).length);
}

export function foregroundApplicationBundle(nodes: SnapshotNode[]): string | undefined {
  const areas = new Map<string, number>();
  for (const node of nodes) {
    const bundleId = node.bundleId?.trim();
    if (
      !bundleId ||
      node.visibleToUser === false ||
      /^(?:com\.android\.systemui|com\.samsung\.android\.)/.test(bundleId)
    )
      continue;
    const area = node.rect ? node.rect.width * node.rect.height : 0;
    areas.set(bundleId, Math.max(areas.get(bundleId) ?? 0, area));
  }
  return [...areas].sort((left, right) => right[1] - left[1])[0]?.[0];
}

/** Preserve the saved screen order and fill individual accessibility gaps with
 * mapped points. A partially inspectable screen must not silently shrink an
 * exact coverage test. */
export function mergeMappedTourStops(
  live: TourStop[],
  mapped: TourStop[],
  options: {
    alignByOrder?: boolean;
    alignByPoint?: boolean;
    landmarkStops?: ReadonlyArray<TourStop>;
  } = {},
): TourStop[] {
  const landmarkPairs = options.landmarkStops
    ? mappedTourStopLandmarkPairs(live, mapped, options.landmarkStops)
    : undefined;
  if (landmarkPairs) {
    return mapped.map((mappedStop, index) => ({
      ...landmarkPairs[index]!,
      ...(mappedStop.capture === undefined ? {} : { capture: mappedStop.capture }),
      ...(mappedStop.optional === undefined ? {} : { optional: mappedStop.optional }),
    }));
  }
  const pointPairs = options.alignByPoint ? mappedTourStopPointPairs(live, mapped) : undefined;
  if (pointPairs) {
    return mapped.map((mappedStop, index) => {
      const liveStop = pointPairs[index]!;
      return {
        ...liveStop,
        ...(mappedStop.capture === undefined ? {} : { capture: mappedStop.capture }),
        ...(mappedStop.optional === undefined ? {} : { optional: mappedStop.optional }),
      };
    });
  }
  const labelMatches = tourFallbackOverlap(live, mapped);
  if (
    options.alignByOrder &&
    live.length === mapped.length &&
    labelMatches < Math.min(2, mapped.length)
  ) {
    return mapped.map((mappedStop, index) => ({
      ...live[index]!,
      // Use the live localized label for semantic interaction. The captured
      // map point remains a final fallback, never the primary selector.
      ...(mappedStop.capture === undefined ? {} : { capture: mappedStop.capture }),
      ...(mappedStop.optional === undefined ? {} : { optional: mappedStop.optional }),
    }));
  }
  const unused = new Set(live.map((_, index) => index));
  return mapped.map((fallback) => {
    const fallbackLabel = fallback.label.trim().toLocaleLowerCase();
    const fallbackIdentifier = fallback.identifier?.trim().toLocaleLowerCase();
    const matchIndex = live.findIndex((candidate, index) => {
      if (!unused.has(index)) return false;
      if (
        fallbackIdentifier &&
        candidate.identifier?.trim().toLocaleLowerCase() === fallbackIdentifier
      ) {
        return true;
      }
      return candidate.label.trim().toLocaleLowerCase() === fallbackLabel;
    });
    if (matchIndex < 0) return fallback;
    unused.delete(matchIndex);
    return {
      ...live[matchIndex]!,
      ...(fallback.capture === undefined ? {} : { capture: fallback.capture }),
      ...(fallback.optional === undefined ? {} : { optional: fallback.optional }),
    };
  });
}

function tourStopMapKey(stop: Pick<TourStop, "label" | "identifier" | "point">): string {
  const identifier = stop.identifier?.trim().toLocaleLowerCase();
  if (identifier) return `identifier:${identifier}`;
  if (stop.point) return `point:${Math.round(stop.point.x)}:${Math.round(stop.point.y)}`;
  return `label:${stop.label.trim().toLocaleLowerCase()}`;
}

/**
 * Localized exact tours may select a subset of a longer settings list. Pair
 * each selected row through the complete recorded row order, then use the
 * live row at that rank. This is intentionally fail-closed: if a landmark is
 * absent or ambiguous we do not turn a nearby row into a stale tap.
 */
export function mappedTourStopLandmarkPairs(
  live: ReadonlyArray<TourStop>,
  mapped: ReadonlyArray<TourStop>,
  landmarks: ReadonlyArray<TourStop>,
): TourStop[] | undefined {
  if (!mapped.length || !landmarks.length) return undefined;
  const landmarkIndexes = new Map<string, number[]>();
  for (const [index, landmark] of landmarks.entries()) {
    const key = tourStopMapKey(landmark);
    const indexes = landmarkIndexes.get(key) ?? [];
    indexes.push(index);
    landmarkIndexes.set(key, indexes);
  }
  const used = new Set<number>();
  const pairs: TourStop[] = [];
  for (const mappedStop of mapped) {
    const candidates = (landmarkIndexes.get(tourStopMapKey(mappedStop)) ?? []).filter(
      (index) => !used.has(index),
    );
    if (candidates.length !== 1) return undefined;
    const index = candidates[0]!;
    // Require every preceding landmark to be present before trusting a visual
    // rank. An inserted/deleted row is an authoring change, not a guess.
    if (live.length <= index) return undefined;
    used.add(index);
    pairs.push(live[index]!);
  }
  return pairs;
}

const LOCALIZED_POINT_MATCH_DISTANCE = 220;
const LOCALIZED_ROW_OFFSET_TOLERANCE = 72;

/**
 * A translated settings list commonly keeps its row geometry while moving the
 * whole visible block: text can grow, a section can wrap, or a preceding
 * dynamic row can be present. The saved point is deliberately a tap point
 * (often left aligned), whereas the live accessibility row reports its
 * centre. Matching each point independently can therefore pair every row to
 * the next one. Instead, first look for one ordered block with a common Y
 * translation. A block has to explain every selected row and win by a clear
 * margin; otherwise callers retain the existing fail-closed point matcher.
 */
function mappedTourStopOffsetPairs(
  live: ReadonlyArray<TourStop>,
  mapped: ReadonlyArray<TourStop>,
): TourStop[] | undefined {
  if (mapped.length < 2 || mapped.some((stop) => !stop.point)) return undefined;
  const mappedPoints = mapped.map((stop) => stop.point!);
  if (mappedPoints.some((point, index) => index > 0 && point.y <= mappedPoints[index - 1]!.y)) {
    return undefined;
  }
  const liveWithPoints = live
    .map((stop, index) => ({ stop, index }))
    .filter(
      (item): item is { stop: TourStop & { point: { x: number; y: number } }; index: number } =>
        Boolean(item.stop.point),
    );
  if (liveWithPoints.length < mapped.length) return undefined;

  const candidates = new Map<string, { pairs: TourStop[]; error: number }>();
  for (const seed of liveWithPoints) {
    for (const mappedPoint of mappedPoints) {
      const offset = seed.stop.point.y - mappedPoint.y;
      const pairs: TourStop[] = [];
      let previousIndex = -1;
      let error = 0;
      for (const point of mappedPoints) {
        const expectedY = point.y + offset;
        const nearest = liveWithPoints
          .filter((candidate) => candidate.index > previousIndex)
          .map((candidate) => ({
            candidate,
            distance: Math.abs(candidate.stop.point.y - expectedY),
          }))
          .sort(
            (left, right) =>
              left.distance - right.distance || left.candidate.index - right.candidate.index,
          )[0];
        if (!nearest || nearest.distance > LOCALIZED_ROW_OFFSET_TOLERANCE) {
          pairs.length = 0;
          break;
        }
        previousIndex = nearest.candidate.index;
        error += nearest.distance ** 2;
        pairs.push(nearest.candidate.stop);
      }
      if (pairs.length !== mapped.length) continue;
      const key = pairs.map((stop) => live.indexOf(stop)).join(":");
      const existing = candidates.get(key);
      if (!existing || error < existing.error) candidates.set(key, { pairs, error });
    }
  }
  const ranked = [...candidates.values()].sort((left, right) => left.error - right.error);
  const best = ranked[0];
  const runnerUp = ranked[1];
  // Regularly-spaced lists can admit two plausible windows. Only commit to a
  // translated mapping when its residual is materially better than the next
  // candidate; the alternative is a visible, actionable failure—not a wrong
  // tap on an adjacent setting.
  if (!best || (runnerUp && runnerUp.error - best.error < mapped.length * 64)) return undefined;
  return best.pairs;
}

/**
 * Match a deliberate subset of translated rows to their recorded tap areas.
 *
 * A localized list can contain more visible rows than the mapped test (for
 * example an exact four-row coverage tour inside a longer Settings viewport),
 * so whole-list index alignment is unsafe. A captured point belongs to a
 * specific row, however; pair it only with one nearby live accessible row and
 * keep that row's current label/identifier for the eventual interaction.
 */
export function mappedTourStopPointPairs(
  live: ReadonlyArray<TourStop>,
  mapped: ReadonlyArray<TourStop>,
): TourStop[] | undefined {
  if (!mapped.length || mapped.some((stop) => !stop.point)) return undefined;
  const translatedBlock = mappedTourStopOffsetPairs(live, mapped);
  if (translatedBlock) return translatedBlock;
  const remaining = new Set(live.map((_, index) => index));
  const pairs: TourStop[] = [];
  for (const mappedStop of mapped) {
    const target = mappedStop.point!;
    let closestIndex: number | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const index of remaining) {
      const candidate = live[index];
      if (!candidate?.point) continue;
      const distance = Math.hypot(candidate.point.x - target.x, candidate.point.y - target.y);
      if (distance < closestDistance) {
        closestIndex = index;
        closestDistance = distance;
      }
    }
    if (closestIndex === undefined || closestDistance > LOCALIZED_POINT_MATCH_DISTANCE) {
      return undefined;
    }
    remaining.delete(closestIndex);
    pairs.push(live[closestIndex]!);
  }
  return pairs;
}
