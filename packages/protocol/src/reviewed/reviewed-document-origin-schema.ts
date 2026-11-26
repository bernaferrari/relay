import * as z from "zod/v4";
import {
  REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
} from "./reviewed-document-origin.js";

const evidenceBase = {
  id: z.string(),
  uri: z.string(),
  sha256: z.string(),
  bytes: z.number(),
} as const;

const jsonEvidenceSchema = z
  .object({ ...evidenceBase, mime: z.literal("application/json") })
  .strict();

const pngEvidenceSchema = z.object({ ...evidenceBase, mime: z.literal("image/png") }).strict();

const reviewedOriginActorSchema = z
  .object({ actorId: z.string(), actorKind: z.enum(["human", "agent"]) })
  .strict();

const bindingSchema = z
  .object({
    schemaVersion: z.literal(1),
    organizationId: z.string(),
    projectId: z.string(),
    appMapId: z.string(),
    appMapRevision: z.number(),
    appMapDigest: z.string(),
    mapEpoch: z.string(),
    screenId: z.string(),
    variantId: z.string(),
    surfaceId: z.string(),
    captureId: z.string(),
    targetProfileId: z.string(),
    platform: z.literal("android"),
    firstViewport: z
      .object({
        index: z.literal(0),
        offsetY: z.literal(0),
        appendedHeight: z.literal(0),
        capturedAt: z.number(),
        width: z.number(),
        height: z.number(),
        screenshot: pngEvidenceSchema,
        accessibilityTree: jsonEvidenceSchema,
      })
      .strict(),
  })
  .strict();

function decisionSchema(assertion: string) {
  return z
    .object({
      actor: reviewedOriginActorSchema,
      reason: z.string(),
      assertion: z.literal(assertion),
      confirmation: z.literal(REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION),
      at: z.number(),
      evidence: jsonEvidenceSchema,
    })
    .strict();
}

const approvalSchema = decisionSchema(REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION);
const revocationSchema = decisionSchema(REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION);

export const reviewedDocumentOriginProjectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    binding: bindingSchema,
    approval: approvalSchema,
    authorization: z
      .object({
        schemaVersion: z.literal(1),
        issuer: z.literal("relay-local-reviewed-origin"),
        signature: z.string(),
      })
      .strict(),
  })
  .strict();

export const reviewedDocumentOriginLedgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectionId: z.string(),
    sequence: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    previousAuthorizationSignature: z.string().optional(),
    status: z.enum(["pending", "active", "revoked"]),
    createdAt: z.number(),
    activatedAt: z.number().optional(),
    revocation: revocationSchema.optional(),
    authorization: z
      .object({
        schemaVersion: z.literal(1),
        issuer: z.literal("relay-local-reviewed-origin-ledger"),
        signature: z.string(),
      })
      .strict(),
  })
  .strict();

const lineageSchema = z
  .object({
    projection: reviewedDocumentOriginProjectionSchema,
    ledger: reviewedDocumentOriginLedgerSchema.optional(),
    ledgerEvents: z.array(reviewedDocumentOriginLedgerSchema),
    revocationTombstone: reviewedDocumentOriginLedgerSchema.optional(),
    currentBinding: z.boolean(),
  })
  .strict();

export const reviewedDocumentOriginInspectionSchema = z
  .object({
    appMapId: z.string(),
    screenId: z.string(),
    variantId: z.string(),
    captureId: z.string(),
    lineage: z.array(lineageSchema),
  })
  .strict();
