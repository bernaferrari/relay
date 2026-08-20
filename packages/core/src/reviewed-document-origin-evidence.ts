/** Immutable evidence checks shared by review, compilation, and execution.
 * This module deliberately contains no control-store writes or device access. */
import { createHash } from "node:crypto";
import {
  REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
  type AppMap,
  type ReviewedDocumentOriginApproval,
  type ReviewedDocumentOriginBinding,
  type ReviewedDocumentOriginProjection,
  type ReviewedDocumentOriginRevocation,
  type ScrollSurfaceEvidence,
} from "@relay/protocol";
import { PNG } from "pngjs";
import { readAuthoringEvidence } from "./authoring-evidence.js";
import { serializeAppMap } from "./app-map/serialization.js";

const SHA256 = /^[a-f0-9]{64}$/u;

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && /\S/u.test(value);
}

export function reviewedDocumentOriginAppMapDigest(map: AppMap): string {
  return createHash("sha256")
    .update(JSON.stringify(serializeAppMap(map)))
    .digest("hex");
}

export function reviewedDocumentOriginEvidenceIsComplete(
  evidence: ScrollSurfaceEvidence | undefined,
  mime: ScrollSurfaceEvidence["mime"],
): evidence is ScrollSurfaceEvidence {
  return Boolean(
    evidence &&
    nonEmptyText(evidence.id) &&
    evidence.mime === mime &&
    typeof evidence.sha256 === "string" &&
    SHA256.test(evidence.sha256) &&
    evidence.uri === `relay-evidence://${evidence.sha256}` &&
    Number.isSafeInteger(evidence.bytes) &&
    evidence.bytes >= 0,
  );
}

export function sameReviewedDocumentOriginEvidence(
  left: ScrollSurfaceEvidence,
  right: ScrollSurfaceEvidence,
): boolean {
  return (
    left.id === right.id &&
    left.uri === right.uri &&
    left.sha256 === right.sha256 &&
    left.mime === right.mime &&
    left.bytes === right.bytes
  );
}

export function canonicalReviewedDocumentOriginBinding(
  binding: ReviewedDocumentOriginBinding,
): object {
  return {
    schemaVersion: binding.schemaVersion,
    organizationId: binding.organizationId,
    projectId: binding.projectId,
    appMapId: binding.appMapId,
    appMapRevision: binding.appMapRevision,
    appMapDigest: binding.appMapDigest,
    mapEpoch: binding.mapEpoch,
    screenId: binding.screenId,
    variantId: binding.variantId,
    surfaceId: binding.surfaceId,
    captureId: binding.captureId,
    targetProfileId: binding.targetProfileId,
    platform: binding.platform,
    firstViewport: {
      index: binding.firstViewport.index,
      offsetY: binding.firstViewport.offsetY,
      appendedHeight: binding.firstViewport.appendedHeight,
      capturedAt: binding.firstViewport.capturedAt,
      width: binding.firstViewport.width,
      height: binding.firstViewport.height,
      screenshot: binding.firstViewport.screenshot,
      accessibilityTree: binding.firstViewport.accessibilityTree,
    },
  };
}

function evidenceBytesMatch(bytes: Buffer, evidence: ScrollSurfaceEvidence): boolean {
  return (
    bytes.byteLength === evidence.bytes &&
    createHash("sha256").update(bytes).digest("hex") === evidence.sha256
  );
}

function inspectableTree(bytes: Buffer): boolean {
  try {
    const tree = JSON.parse(bytes.toString("utf8")) as { inspectable?: unknown; nodes?: unknown };
    return tree.inspectable === true && Array.isArray(tree.nodes);
  } catch {
    return false;
  }
}

/** Reopen actual immutable raw bytes. A hash/reference or normalized geometry
 * alone can never bless an origin. */
export async function reviewedDocumentOriginRawEvidenceIsValid(
  binding: ReviewedDocumentOriginBinding,
): Promise<boolean> {
  const first = binding?.firstViewport;
  if (
    !first ||
    binding.schemaVersion !== 1 ||
    binding.platform !== "android" ||
    first.index !== 0 ||
    first.offsetY !== 0 ||
    first.appendedHeight !== 0 ||
    !Number.isSafeInteger(first.capturedAt) ||
    !Number.isSafeInteger(first.width) ||
    !Number.isSafeInteger(first.height) ||
    first.width <= 0 ||
    first.height <= 0 ||
    !reviewedDocumentOriginEvidenceIsComplete(first.screenshot, "image/png") ||
    !reviewedDocumentOriginEvidenceIsComplete(first.accessibilityTree, "application/json")
  ) {
    return false;
  }
  const [image, tree] = await Promise.all([
    readAuthoringEvidence(first.screenshot.sha256),
    readAuthoringEvidence(first.accessibilityTree.sha256),
  ]);
  if (
    !image ||
    !tree ||
    !evidenceBytesMatch(image, first.screenshot) ||
    !evidenceBytesMatch(tree, first.accessibilityTree)
  ) {
    return false;
  }
  try {
    const decoded = PNG.sync.read(image);
    return (
      decoded.width === first.width && decoded.height === first.height && inspectableTree(tree)
    );
  } catch {
    return false;
  }
}

export function reviewedDocumentOriginApprovalPayload(projection: {
  id: string;
  binding: ReviewedDocumentOriginBinding;
  approval: Omit<ReviewedDocumentOriginApproval, "evidence">;
}): object {
  return {
    schemaVersion: 1,
    kind: "relay.reviewed-document-origin-approval",
    projectionId: projection.id,
    binding: canonicalReviewedDocumentOriginBinding(projection.binding),
    actor: projection.approval.actor,
    reason: projection.approval.reason,
    assertion: projection.approval.assertion,
    confirmation: projection.approval.confirmation,
    approvedAt: projection.approval.at,
  };
}

export function reviewedDocumentOriginRevocationPayload(
  projection: ReviewedDocumentOriginProjection,
  decision: Omit<ReviewedDocumentOriginRevocation, "evidence">,
): object {
  return {
    schemaVersion: 1,
    kind: "relay.reviewed-document-origin-revocation",
    projectionId: projection.id,
    binding: canonicalReviewedDocumentOriginBinding(projection.binding),
    actor: decision.actor,
    reason: decision.reason,
    assertion: decision.assertion,
    confirmation: decision.confirmation,
    revokedAt: decision.at,
  };
}

function payloadMatches(bytes: Buffer, evidence: ScrollSurfaceEvidence, expected: object): boolean {
  if (!evidenceBytesMatch(bytes, evidence)) return false;
  try {
    return JSON.stringify(JSON.parse(bytes.toString("utf8"))) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

export async function reviewedDocumentOriginApprovalEvidenceIsValid(
  projection: ReviewedDocumentOriginProjection,
): Promise<boolean> {
  const approval = projection?.approval;
  if (
    !approval ||
    !approval.actor ||
    !nonEmptyText(approval.actor.actorId) ||
    !["human", "agent"].includes(approval.actor.actorKind) ||
    !nonEmptyText(approval.reason) ||
    approval.assertion !== REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION ||
    approval.confirmation !== REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION ||
    !Number.isSafeInteger(approval.at) ||
    !reviewedDocumentOriginEvidenceIsComplete(approval.evidence, "application/json")
  ) {
    return false;
  }
  const bytes = await readAuthoringEvidence(approval.evidence.sha256);
  return Boolean(
    bytes &&
    payloadMatches(
      bytes,
      approval.evidence,
      reviewedDocumentOriginApprovalPayload({
        id: projection.id,
        binding: projection.binding,
        approval: {
          actor: approval.actor,
          reason: approval.reason,
          assertion: approval.assertion,
          confirmation: approval.confirmation,
          at: approval.at,
        },
      }),
    ),
  );
}

export async function reviewedDocumentOriginRevocationEvidenceIsValid(input: {
  projection: ReviewedDocumentOriginProjection;
  ledger: { status: string; revocation?: ReviewedDocumentOriginRevocation };
}): Promise<boolean> {
  const decision = input.ledger?.revocation;
  if (
    input.ledger?.status !== "revoked" ||
    !decision ||
    !decision.actor ||
    !nonEmptyText(decision.actor.actorId) ||
    !["human", "agent"].includes(decision.actor.actorKind) ||
    !nonEmptyText(decision.reason) ||
    decision.assertion !== REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION ||
    decision.confirmation !== REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION ||
    !Number.isSafeInteger(decision.at) ||
    !reviewedDocumentOriginEvidenceIsComplete(decision.evidence, "application/json")
  ) {
    return false;
  }
  const bytes = await readAuthoringEvidence(decision.evidence.sha256);
  return Boolean(
    bytes &&
    payloadMatches(
      bytes,
      decision.evidence,
      reviewedDocumentOriginRevocationPayload(input.projection, decision),
    ),
  );
}
