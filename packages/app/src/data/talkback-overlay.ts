import type { TalkBackReview, TalkBackReviewItem } from "@relay/protocol";

export type OverlayBox = { left: number; top: number; width: number; height: number };

export const ACCESSIBILITY_LABELS_STORAGE_KEY = "live.accessibilityLabels";

export type AccessibilityLabelMode = "off" | "hover" | "always";

export const ACCESSIBILITY_LABEL_MODE_OPTIONS = [
  { value: "off", label: "Off", description: "Hide names on the live view" },
  { value: "hover", label: "On hover", description: "Show the name under the pointer" },
  { value: "always", label: "Always show", description: "Keep names on the live view" },
] as const;

export function validAccessibilityLabelMode(
  value: string | null | undefined,
): AccessibilityLabelMode {
  return value === "off" || value === "always" ? value : "hover";
}

export function containsOverlayBox(box: OverlayBox, point: { x: number; y: number }): boolean {
  return (
    point.x >= box.left &&
    point.y >= box.top &&
    point.x <= box.left + box.width &&
    point.y <= box.top + box.height
  );
}

/** Smallest box under the pointer wins so a row does not hide its label. */
export function talkBackItemAtPoint<T extends { box: OverlayBox }>(
  items: readonly T[],
  point: { x: number; y: number },
): T | undefined {
  let match: T | undefined;
  let area = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (!containsOverlayBox(item.box, point)) continue;
    const next = item.box.width * item.box.height;
    if (next < area) {
      match = item;
      area = next;
    }
  }
  return match;
}

export type TalkBackCaptureResult = {
  conditionSuggestions?: readonly string[];
  bounds?: { width: number; height: number };
  inspectable: boolean;
  review: TalkBackReview;
  message?: string;
  targetId?: string;
  observationId?: string;
  stale?: boolean;
  coverage?: "complete" | "partial" | "unknown";
};

export function accessibilityObservationId(input: {
  targetId?: string;
  refreshKey?: number;
}): string {
  return `${input.targetId ?? ""}:${input.refreshKey ?? 0}`;
}

export type AccessibilityInspection = {
  conditionSuggestions?: readonly string[];
  bounds?: { width: number; height: number };
  overlayItems: readonly TalkBackReviewItem[];
  review?: TalkBackReview;
  inspectable?: boolean;
  message?: string;
};

const EMPTY_INSPECTION: AccessibilityInspection = { overlayItems: [] };

function targetIdFromObservationId(observationId: string): string {
  const separator = observationId.lastIndexOf(":");
  return separator === -1 ? observationId : observationId.slice(0, separator);
}

/** Current overlay and details, or empty when the result is stale, foreign, or
 * from another observation epoch. Pages must not read the raw capture bag. */
export function currentAccessibilityInspection(
  result: TalkBackCaptureResult | undefined,
  observationId?: string,
): AccessibilityInspection {
  if (!result || result.stale) return EMPTY_INSPECTION;
  if (observationId) {
    if (result.observationId && result.observationId !== observationId) return EMPTY_INSPECTION;
    const expectedTarget = targetIdFromObservationId(observationId);
    if (result.targetId && expectedTarget && result.targetId !== expectedTarget) {
      return EMPTY_INSPECTION;
    }
  }
  return {
    ...(result.conditionSuggestions ? { conditionSuggestions: result.conditionSuggestions } : {}),
    overlayItems: result.review.items,
    bounds: result.bounds,
    review: result.review,
    inspectable: result.inspectable,
    ...(result.message ? { message: result.message } : {}),
  };
}

/** Hide names that belong to another surface, epoch, or a stale observation. */
export function visibleTalkBackOverlayItems(
  result: TalkBackCaptureResult | undefined,
  observationId?: string,
): readonly TalkBackReviewItem[] {
  return currentAccessibilityInspection(result, observationId).overlayItems;
}

/** Keep a newer observation; ignore late captures for another target/epoch. */
export function retainAccessibilityObservation(input: {
  currentId: string;
  incomingId: string;
  previous?: TalkBackCaptureResult;
  next: TalkBackCaptureResult;
}): TalkBackCaptureResult | undefined {
  if (input.incomingId !== input.currentId) {
    return input.previous
      ? { ...input.previous, stale: input.previous.observationId !== input.currentId }
      : undefined;
  }
  return {
    ...input.next,
    observationId: input.incomingId,
    stale: false,
  };
}

/** Map device pixels into the scroll content holding the letterboxed canvas. */
export function talkBackOverlayBox(
  canvas: { width: number; height: number; getBoundingClientRect(): DOMRect },
  parent: { getBoundingClientRect(): DOMRect; scrollLeft?: number; scrollTop?: number },
  rect: { x: number; y: number; width: number; height: number },
  bounds?: { width: number; height: number },
): OverlayBox | undefined {
  if (canvas.width <= 0 || canvas.height <= 0) return undefined;
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  const box = canvas.getBoundingClientRect();
  const frame = parent.getBoundingClientRect();
  const source = bounds ?? canvas;
  if (source.width <= 0 || source.height <= 0) return undefined;
  const scale = Math.min(box.width / source.width, box.height / source.height);
  if (!Number.isFinite(scale) || scale <= 0) return undefined;
  const drawnWidth = source.width * scale;
  const drawnHeight = source.height * scale;
  const padX = (box.width - drawnWidth) / 2;
  const padY = (box.height - drawnHeight) / 2;
  return {
    left: box.left - frame.left + (parent.scrollLeft ?? 0) + padX + rect.x * scale,
    top: box.top - frame.top + (parent.scrollTop ?? 0) + padY + rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}
