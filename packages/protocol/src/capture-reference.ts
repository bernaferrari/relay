/**
 * Reference screenshots.
 *
 * When a person marks a captured screenshot "Accept as reference", that image becomes
 * the reference for the same checkpoint of the same Test on the same device
 * setup. Later runs are compared with it pixel by pixel: unchanged screenshots
 * are approved automatically, and only changed or new ones wait for a person.
 */
import type { ActorKind } from "./coordination.js";

/** A rectangle in normalized (0..1) image coordinates. */
export type CaptureReferenceRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
};

export const CAPTURE_REFERENCE_STATES = ["match", "changed", "new", "incomparable"] as const;
export type CaptureReferenceState = (typeof CAPTURE_REFERENCE_STATES)[number];

/** Saved Plan choice. Older Plans and Runs use human review. */
export type CaptureReferenceReviewMode = "human" | "approved-reference";

/** Result of comparing one capture with its reference. */
export type CaptureReferenceComparison = {
  state: CaptureReferenceState;
  comparedAt: number;
  referenceId?: string;
  referenceRunId?: string;
  referenceApprovedAt?: number;
  referenceApprovedBy?: { id: string; kind: ActorKind };
  /** Share of compared pixels that differ beyond the per-pixel threshold. */
  changeRatio?: number;
  /** Pixel counts and tolerance used to reach this result. */
  consideredPixels?: number;
  ignoredPixels?: number;
  changedPixels?: number;
  pixelThreshold?: number;
  changeThreshold?: number;
  /** Bounding box of every changed pixel, normalized. */
  changedBounds?: CaptureReferenceRegion;
  /** The reference and the new image have different dimensions. */
  sizeChanged?: boolean;
  /** Areas excluded from the comparison (clocks, live data, avatars...). */
  ignoreRegions?: CaptureReferenceRegion[];
};

/** Decisions written by the reference comparison, never by a person. */
export const CAPTURE_REFERENCE_ACTOR = { id: "system:reference", kind: "system" } as const;

export const CAPTURE_REFERENCE_DEFAULTS = {
  /** Per-channel difference (0-255) below which a pixel counts as unchanged. */
  pixelThreshold: 16,
  /** Share of changed pixels allowed before a screenshot counts as changed. */
  changeThreshold: 0.0035,
} as const;

export function isCaptureReferenceRegion(value: unknown): value is CaptureReferenceRegion {
  if (!value || typeof value !== "object") return false;
  const region = value as Record<string, unknown>;
  const unit = (item: unknown) =>
    typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 1;
  return (
    unit(region.x) &&
    unit(region.y) &&
    unit(region.width) &&
    unit(region.height) &&
    (region.width as number) > 0 &&
    (region.height as number) > 0 &&
    (region.x as number) + (region.width as number) <= 1.000_001 &&
    (region.y as number) + (region.height as number) <= 1.000_001 &&
    (region.name === undefined || typeof region.name === "string")
  );
}

/** True when a person has not looked at this capture yet: the system approved it. */
export function decidedByReference(decidedBy?: { id: string }): boolean {
  return decidedBy?.id === CAPTURE_REFERENCE_ACTOR.id;
}

/** One run in the review inbox, with only the screenshots that need a person. */
export type ReviewInboxEntry = {
  runId: string;
  title: string;
  appMapId?: string;
  testId?: string;
  targetName?: string;
  platform?: string;
  /** Data set values for Run Across cases. */
  data?: Record<string, string>;
  finishedAt: number;
  outcome?: string;
  items: import("./capture-review.js").CaptureReviewItem[];
};

export type ReviewInboxResult = {
  entries: ReviewInboxEntry[];
  /** Screenshot counts across the latest run of every Test and device. */
  totals: import("./capture-review.js").CaptureReviewSummary;
  runsConsidered: number;
};
