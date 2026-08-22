export type ScrollSurfaceStopReason =
  | "end-of-content"
  | "screen-changed"
  | "inspection-unavailable"
  | "missing-page-anchor"
  | "seam-ambiguous"
  | "dimension-changed"
  | "scroll-failed"
  | "restore-failed"
  /** A force-recapture began from a viewport that could not be proven to be
   * the frozen document origin. Relay uses exact inverse restoration instead
   * of an origin fling; retained frames are repair input, not a baseline. */
  | "start-viewport-unproven"
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

/** The raw tree attached directly to an ordinary Screen Variant. The evidence
 * reference is the immutable authority; the optional observation facts bind a
 * newly-written reference to the exact normalized observation it accompanied.
 * Older maps predate those facts and remain readable, but must not be silently
 * upgraded or assumed to describe a newer observation. */
export type ScreenVariantRawAccessibilityTree = RawAccessibilityTreeEvidence & {
  observationId?: string;
  capturedAt?: number;
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

/** Immutable capture-process receipt for a document-origin proof. It is not
 * authorable map metadata: execution reopens these bytes from Relay's CAS and
 * verifies every bound field before it can authorize a high-distance restore. */
export type ScrollSurfaceDocumentOriginAttestation = ScrollSurfaceEvidence & {
  mime: "application/json";
};

/** Authorization made by Relay's local capture authority after it verified
 * the runtime-only survey issuance facts. The signature binds the attestation
 * digest, target/surface scope, first raw viewport, and terminal return.
 * App Map JSON can carry this reference, but cannot mint a replacement. */
export type ScrollSurfaceDocumentOriginAuthorization = {
  schemaVersion: 1;
  issuer: "relay-local-capture";
  signature: string;
};

/** Explicit provenance for a physical first viewport, bound to its immutable
 * raw evidence and an immutable capture-process attestation. Zero stitch
 * geometry—or a hand-authored hash pair—alone is not evidence that a viewport
 * was at the top of the underlying document. */
export type ScrollSurfaceDocumentOriginProof = {
  schemaVersion: 1;
  /** Relay emits this only after the live first and terminal viewports both
   * matched an earlier frozen document-origin checkpoint. */
  method: "frozen-origin-match";
  firstViewport: {
    screenshotSha256: string;
    accessibilityTreeSha256: string;
  };
  attestation: ScrollSurfaceDocumentOriginAttestation;
  authorization: ScrollSurfaceDocumentOriginAuthorization;
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
 * used by later recaptures and repair proposals.
 *
 * Bind a destination with `captureMode: "full-surface"`, `surfaceId`, and
 * `baselineCaptureId`. Combine lens `visual` / `every-screen` then surveys
 * after arrival instead of one viewport. */
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
  /** Optional because legacy/imported captures lack a genuine document-top
   * attestation. Those captures remain usable raw evidence but cannot enable
   * bounded origin restoration. */
  documentOriginProof?: ScrollSurfaceDocumentOriginProof;
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
