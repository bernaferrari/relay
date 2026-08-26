import type { ActorIdentity } from "./coordination.js";
import type { ScrollSurfaceEvidence } from "./scroll-surface.js";

/** Exact statements required for the two durable manual-authority decisions.
 * They are protocol constants rather than UI copy: a free-form explanation is
 * useful as a reason, but it cannot silently become authorization. */
export const REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION = "reviewed-document-top" as const;
export const REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION = "revoke-reviewed-document-origin" as const;
export const REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION = "confirm" as const;

/** Scheduler/recovery actors can operate Relay, but may not create or remove
 * a manual reviewed-origin decision. */
export type ReviewedDocumentOriginActor = Omit<ActorIdentity, "actorKind"> & {
  actorKind: "human" | "agent";
};

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

export type ReviewedDocumentOriginDecision<Assertion extends string = string> = {
  actor: ReviewedDocumentOriginActor;
  reason: string;
  assertion: Assertion;
  /** Deliberate confirmation is persisted with the signed decision rather
   * than being an ephemeral client-only affordance. */
  confirmation: typeof REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION;
  at: number;
  evidence: ReviewedDocumentOriginEvidence;
};

export type ReviewedDocumentOriginApproval = ReviewedDocumentOriginDecision<
  typeof REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION
>;

export type ReviewedDocumentOriginRevocation = ReviewedDocumentOriginDecision<
  typeof REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION
>;

/** Immutable server-written projection. The HMAC makes this non-authorable
 * metadata even though a recipe may retain a read-only copy for execution. */
export type ReviewedDocumentOriginProjection = {
  schemaVersion: 1;
  id: string;
  binding: ReviewedDocumentOriginBinding;
  approval: ReviewedDocumentOriginApproval;
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
  /** Immutable event order within one local projection lineage. */
  sequence: 1 | 2 | 3;
  /** HMAC signature of the immediately preceding immutable lifecycle event. */
  previousAuthorizationSignature?: string;
  status: "pending" | "active" | "revoked";
  createdAt: number;
  activatedAt?: number;
  revocation?: ReviewedDocumentOriginRevocation;
  authorization: {
    schemaVersion: 1;
    issuer: "relay-local-reviewed-origin-ledger";
    signature: string;
  };
};

/** The only reviewed-origin data a compiled execution plan may carry. Runtime reads
 * the authoritative local projection + ledger again, so this is never a
 * bearer capability and revocation invalidates already-compiled plans. */
export type ReviewedDocumentOriginExecutionReference = {
  schemaVersion: 1;
  projection: ReviewedDocumentOriginProjection;
};

export type ReviewedDocumentOriginLineage = {
  projection: ReviewedDocumentOriginProjection;
  ledger?: ReviewedDocumentOriginLedger;
  /** Append-only pending → active → revoked history, oldest first. */
  ledgerEvents: ReviewedDocumentOriginLedger[];
  /** Durable signed revocation record, retained independently so a stale
   * active ledger prefix cannot quietly revive authority. */
  revocationTombstone?: ReviewedDocumentOriginLedger;
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
