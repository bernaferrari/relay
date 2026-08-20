import type { SnapshotNode } from "./device.js";
import type { SnapshotPayload } from "./workspace-capture.js";

export type ScrollSurveyStopReason =
  | "end-of-content"
  | "screen-changed"
  | "inspection-unavailable"
  | "missing-page-anchor"
  | "seam-ambiguous"
  | "dimension-changed"
  | "scroll-failed"
  | "restore-failed"
  | "start-viewport-unproven"
  | "limit-reached";

export type ScrollSurveyFrame = {
  index: number;
  offsetY: number;
  screenshot: { base64: string; width: number; height: number; capturedAt: number };
  snapshot: SnapshotPayload;
  /** How much new vertical content this frame contributed to the stitch. */
  appendedHeight: number;
};

export type ScrollSurveyResult = {
  status: "completed" | "stopped";
  reason: ScrollSurveyStopReason;
  frames: ScrollSurveyFrame[];
  /** Captured candidates rejected from the logical surface. These remain raw,
   * decomposable evidence and never contribute to the composite or tree. */
  diagnosticFrames: ScrollSurveyFrame[];
  /** A composite preview only. Original frames remain authoritative evidence. */
  stitched?: { base64: string; width: number; height: number; mime: "image/png" };
  /** Leaf semantics translated into the stitched document coordinate space. */
  mergedNodes: SnapshotNode[];
  restoredStartViewport: boolean;
  /** Present only when this run began at, and finally returned to, an
   * immutable frozen document origin. A stored frame index/offset of zero is
   * merely local stitch geometry and must never be inferred as this proof. */
  documentOriginProven?: true;
  message: string;
};

export type ScrollSurveyDriver = {
  capture(): Promise<{
    screenshot: { base64: string; width?: number; height?: number; capturedAt: number };
    snapshot: SnapshotPayload;
  }>;
  scrollDown(): Promise<void>;
  scrollUp(): Promise<void>;
  /** A bounded, high-distance Android-only upward gesture. This is safe only
   * when the caller supplied immutable document-origin evidence and the live
   * first viewport matched it. Target adapters must omit this on iOS; an
   * absent capability deliberately falls back to exact inverse restoration. */
  scrollUpFast?(): Promise<void>;
  settle(): Promise<void>;
};

export type ScrollSurveyCapture = Awaited<ReturnType<ScrollSurveyDriver["capture"]>>;

/**
 * A capability minted only after the recipe runtime rehydrates and validates
 * evidence-bound document-origin proof. It intentionally cannot be satisfied
 * by an ordinary captured viewport, even if its local stitch geometry happens
 * to start at zero. This is a compile-time boundary; runtime callers must use
 * the evidence loader before they can opt into bounded Android restoration.
 */
declare const validatedFrozenDocumentOriginBrand: unique symbol;

export type ValidatedFrozenDocumentOrigin = ScrollSurveyCapture & {
  readonly [validatedFrozenDocumentOriginBrand]: "validated-frozen-document-origin";
};

export type ScrollSurveyOptions = {
  maxScrolls?: number;
  /** Fresh PNG/tree pair already verified before this survey. The caller owns
   * freshness for ordinary collection; a supplied frozen document origin
   * deliberately forces a new capture before the first scroll so a cached
   * checkpoint can never authorize a fast origin restore. */
  initialCapture?: ScrollSurveyCapture;
  /** Evidence-validated first viewport from a trusted, completed logical
   * surface. This capability is the sole opt-in for bounded Android origin
   * restoration: the survey still has to prove that the live first viewport
   * matches it. If it disagrees, the survey remains useful but restores every
   * movement with exact inverse gestures and marks the result for review. */
  frozenDocumentOrigin?: ValidatedFrozenDocumentOrigin;
};
