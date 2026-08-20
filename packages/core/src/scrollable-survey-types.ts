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
  message: string;
};

export type ScrollSurveyDriver = {
  capture(): Promise<{
    screenshot: { base64: string; width?: number; height?: number; capturedAt: number };
    snapshot: SnapshotPayload;
  }>;
  scrollDown(): Promise<void>;
  scrollUp(): Promise<void>;
  /** A bounded, high-distance upward gesture. This is safe only when the
   * caller has already proven the starting viewport is the document origin;
   * captureScrollableSurvey always verifies that origin after every attempt. */
  scrollUpFast?(): Promise<void>;
  settle(): Promise<void>;
};

export type ScrollSurveyCapture = Awaited<ReturnType<ScrollSurveyDriver["capture"]>>;

export type ScrollSurveyOptions = {
  maxScrolls?: number;
  /** Fresh PNG/tree pair already verified before this survey. The caller owns
   * freshness; captureScrollableSurvey still applies every normal anchor,
   * seam, screen-boundary, and restoration check. */
  initialCapture?: ScrollSurveyCapture;
  /** Do not infer this from a title or screen identity. Callers may opt in
   * only after proving that initialCapture is the logical document origin.
   * Arbitrary mid-page captures retain exact inverse restoration. */
  initialViewport?: "proven-document-origin";
  /** Immutable first viewport from the compiled document. When present, the
   * survey proves the live capture is at this origin before it makes even one
   * scroll gesture. This prevents a changed/reflowed mid-page viewport from
   * turning a full-page recapture into navigation churn. */
  provenDocumentOrigin?: ScrollSurveyCapture;
};
