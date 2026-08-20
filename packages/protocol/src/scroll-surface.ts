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

/** One immutable raw accessibility tree. This is shared by a normal Screen
 * Variant and each viewport of a logical scroll surface, so offline planning
 * can consume either without inventing a lossy second evidence format. */
export type RawAccessibilityTreeEvidence = ScrollSurfaceEvidence & {
  mime: "application/json";
};

export type ScrollSurfaceViewport = {
  index: number;
  offsetY: number;
  appendedHeight: number;
  capturedAt: number;
  width: number;
  height: number;
  screenshot: ScrollSurfaceEvidence & { mime: "image/png" };
  accessibilityTree: RawAccessibilityTreeEvidence;
};

export type ScrollSurfaceCapturePolicy = {
  captureMode: "viewport" | "full-surface";
  source: "default" | "recommended" | "explicit";
  reason: string;
  decidedAt: number;
};

/** Compact, derived navigation geometry compiled from the raw viewport trees.
 * The raw screenshot/tree pairs remain authoritative; this index can always be
 * regenerated and exists only so execution can navigate by semantic position. */
export type ScrollSurfaceSemanticAnchor = {
  order: number;
  documentY: number;
  target: StepTarget;
  /** Capture-time semantic hints. Geometry remains derived and the target is
   * still authoritative, but exploration must not guess whether a row was a
   * button, switch, or inert heading after the raw tree leaves memory. */
  label?: string;
  role?: string;
  value?: string;
  enabled?: boolean;
  selected?: boolean;
};

export type ScrollSurfaceSemanticIndex = {
  schemaVersion: 1;
  documentHeight: number;
  viewportHeight: number;
  anchors: ScrollSurfaceSemanticAnchor[];
};

/** Frozen subset of one captured surface carried by an executable reveal. */
export type SemanticRevealPlan = ScrollSurfaceSemanticIndex & {
  surfaceId: string;
  captureId: string;
  targetOrder: number;
  targetDocumentY: number;
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
  /** Captured but rejected candidates retained for repair diagnostics. They
   * are never part of the composite, merged tree, or semantic index. */
  diagnosticViewports?: ScrollSurfaceViewport[];
  composite?: ScrollSurfaceEvidence & {
    mime: "image/png";
    width: number;
    height: number;
  };
  mergedTree: ScrollSurfaceEvidence & {
    mime: "application/json";
    nodeCount: number;
  };
  /** Regenerable semantic ordering for viewport-independent reveal steps. */
  semanticIndex?: ScrollSurfaceSemanticIndex;
  /** Self-contained JSON manifest for tools that need to reconstruct this
   * surface without loading the entire App Map. */
  manifest: ScrollSurfaceEvidence & { mime: "application/json" };
};

/** Public import boundary for viewport captures that already exist in Relay's
 * evidence store. Callers provide only immutable raw evidence and explicit
 * document offsets; Relay derives and owns the merged tree, capture identity,
 * and manifest. */
export type LogicalScrollSurfaceImport = {
  schemaVersion: 1;
  id: string;
  targetProfileId: string;
  capturePolicy: ScrollSurfaceCapturePolicy & { captureMode: "full-surface" };
  message: string;
  restoredStartViewport: boolean;
  viewports: ScrollSurfaceViewport[];
};
import type { StepTarget } from "./recipes.js";
