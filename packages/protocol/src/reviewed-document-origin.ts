import type { ActorIdentity } from "./coordination.js";
import type { ScrollSurfaceEvidence } from "./scroll-surface.js";

/**
 * A server-owned authorization overlay for a legacy/imported full scroll
 * surface. It is deliberately separate from `LogicalScrollSurface`: raw
 * capture provenance is immutable, portable evidence; a reviewed decision is
 * local policy that must not travel through map import, duplicate, or a
 * generic proposal.
 */

export type ReviewedDocumentOriginEvidence = ScrollSurfaceEvidence & {
  mime: "application/json";
};

/** Every field is part of the signed authorization scope. `appMapDigest` and
 * the local `mapEpoch` mean that replacing/importing a byte-identical map can
 * never reactivate an earlier decision. */
export type ReviewedDocumentOriginBinding = {
  schemaVersion: 1;
  organizationId: string;
  projectId: string;
  appMapId: string;
  appMapRevision: number;
  appMapDigest: string;
  /** Opaque local map incarnation. It never appears in App Map JSON. */
  mapEpoch: string;
  screenId: string;
  variantId: string;
  surfaceId: string;
  captureId: string;
  targetProfileId: string;
  platform: "android";
  firstViewport: {
    index: 0;
    offsetY: 0;
    appendedHeight: 0;
    capturedAt: number;
    width: number;
    height: number;
    screenshot: ScrollSurfaceEvidence & { mime: "image/png" };
    accessibilityTree: ScrollSurfaceEvidence & { mime: "application/json" };
  };
};

export type ReviewedDocumentOriginDecision = {
  actor: ActorIdentity;
  reason: string;
  assertion: string;
  at: number;
  evidence: ReviewedDocumentOriginEvidence;
};

/** Immutable server-written projection. The HMAC makes this non-authorable
 * metadata even though a recipe may retain a read-only copy for execution. */
export type ReviewedDocumentOriginProjection = {
  schemaVersion: 1;
  id: string;
  binding: ReviewedDocumentOriginBinding;
  approval: ReviewedDocumentOriginDecision;
  authorization: {
    schemaVersion: 1;
    issuer: "relay-local-reviewed-origin";
    signature: string;
  };
};

/** Separate local lifecycle state. A projection is usable only when both the
 * immutable projection and this locally signed ledger are valid and active. */
export type ReviewedDocumentOriginLedger = {
  schemaVersion: 1;
  projectionId: string;
  status: "pending" | "active" | "revoked";
  createdAt: number;
  activatedAt?: number;
  revocation?: ReviewedDocumentOriginDecision;
  authorization: {
    schemaVersion: 1;
    issuer: "relay-local-reviewed-origin-ledger";
    signature: string;
  };
};

/** The only reviewed-origin data a compiled recipe may carry. Runtime reads
 * the authoritative local projection + ledger again, so this is never a
 * bearer capability and revocation invalidates already-compiled recipes. */
export type ReviewedDocumentOriginExecutionReference = {
  schemaVersion: 1;
  projection: ReviewedDocumentOriginProjection;
};

export type ReviewedDocumentOriginLineage = {
  projection: ReviewedDocumentOriginProjection;
  ledger?: ReviewedDocumentOriginLedger;
  /** Whether this exact approval still describes the current stored App Map.
   * It can be false without losing the immutable audit trail. */
  currentBinding: boolean;
};

export type ReviewedDocumentOriginInspection = {
  appMapId: string;
  screenId: string;
  variantId: string;
  captureId: string;
  lineage: ReviewedDocumentOriginLineage[];
};
