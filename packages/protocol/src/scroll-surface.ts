export type ScrollSurfaceStopReason =
  | "end-of-content"
  | "screen-changed"
  | "inspection-unavailable"
  | "missing-page-anchor"
  | "seam-ambiguous"
  | "dimension-changed"
  | "scroll-failed"
  | "restore-failed"
  | "limit-reached";

/** Immutable content-addressed evidence. The bytes live in Relay's evidence
 * store; App Maps retain only enough metadata to inspect and regenerate the
 * logical surface without depending on renderer-owned blobs. */
export type ScrollSurfaceEvidence = {
  id: string;
  uri: string;
  sha256: string;
  mime: "image/png" | "application/json";
  bytes: number;
};

export type ScrollSurfaceViewport = {
  index: number;
  offsetY: number;
  appendedHeight: number;
  capturedAt: number;
  width: number;
  height: number;
  screenshot: ScrollSurfaceEvidence & { mime: "image/png" };
  accessibilityTree: ScrollSurfaceEvidence & { mime: "application/json" };
};

export type ScrollSurfaceCapturePolicy = {
  captureMode: "viewport" | "full-surface";
  source: "default" | "recommended" | "explicit";
  reason: string;
  decidedAt: number;
};

/** Stable graph-Test binding. A viewport is the conservative default; a full
 * surface pins an immutable baseline capture while retaining the logical id
 * used by later recaptures and repair proposals. */
export type ScrollSurfaceTestBinding = {
  screenId: string;
  variantId: string;
  captureMode: "viewport" | "full-surface";
  reason: string;
  surfaceId?: string;
  baselineCaptureId?: string;
  compare: "visual-and-semantic";
  repair: "propose-recapture";
};

/** One immutable, decomposable capture of a scrollable logical screen. Raw
 * viewports are authoritative; the composite and merged tree are derived
 * artifacts that can be regenerated from them later. */
export type LogicalScrollSurface = {
  schemaVersion: 1;
  /** Stable identity of the logical Test surface across recaptures. */
  id: string;
  /** Immutable identity of this specific lossless capture revision. */
  captureId: string;
  targetProfileId: string;
  capturePolicy: ScrollSurfaceCapturePolicy & { captureMode: "full-surface" };
  capturedAt: number;
  status: "completed" | "stopped";
  reason: ScrollSurfaceStopReason;
  message: string;
  restoredStartViewport: boolean;
  viewports: ScrollSurfaceViewport[];
  composite?: ScrollSurfaceEvidence & {
    mime: "image/png";
    width: number;
    height: number;
  };
  mergedTree: ScrollSurfaceEvidence & {
    mime: "application/json";
    nodeCount: number;
  };
  /** Self-contained JSON manifest for tools that need to reconstruct this
   * surface without loading the entire App Map. */
  manifest: ScrollSurfaceEvidence & { mime: "application/json" };
};
