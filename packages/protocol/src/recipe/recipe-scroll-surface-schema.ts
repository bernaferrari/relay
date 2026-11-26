import * as z from "zod/v4";

export const scrollSurfaceEvidenceSchema = z
  .object({
    id: z.string(),
    uri: z.string(),
    sha256: z.string(),
    mime: z.enum(["image/png", "application/json"]),
    bytes: z.number(),
  })
  .strict();

export const scrollSurfaceViewportSchema = z
  .object({
    index: z.number(),
    offsetY: z.number(),
    appendedHeight: z.number(),
    capturedAt: z.number(),
    width: z.number(),
    height: z.number(),
    screenshot: scrollSurfaceEvidenceSchema.extend({ mime: z.literal("image/png") }).strict(),
    accessibilityTree: scrollSurfaceEvidenceSchema
      .extend({ mime: z.literal("application/json") })
      .strict(),
  })
  .strict();

export const scrollSurfaceDocumentOriginProofSchema = z
  .object({
    schemaVersion: z.literal(1),
    method: z.literal("frozen-origin-match"),
    firstViewport: z
      .object({ screenshotSha256: z.string(), accessibilityTreeSha256: z.string() })
      .strict(),
    attestation: scrollSurfaceEvidenceSchema
      .extend({ mime: z.literal("application/json") })
      .strict(),
    authorization: z
      .object({
        schemaVersion: z.literal(1),
        issuer: z.literal("relay-local-capture"),
        signature: z.string(),
      })
      .strict(),
  })
  .strict();

export const reviewedDocumentOriginReferenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    projection: z
      .object({
        schemaVersion: z.literal(1),
        id: z.string(),
        binding: z
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
                screenshot: scrollSurfaceEvidenceSchema
                  .extend({ mime: z.literal("image/png") })
                  .strict(),
                accessibilityTree: scrollSurfaceEvidenceSchema
                  .extend({ mime: z.literal("application/json") })
                  .strict(),
              })
              .strict(),
          })
          .strict(),
        approval: z
          .object({
            actor: z
              .object({ actorId: z.string(), actorKind: z.enum(["human", "agent"]) })
              .strict(),
            reason: z.string(),
            assertion: z.literal("reviewed-document-top"),
            confirmation: z.literal("confirm"),
            at: z.number(),
            evidence: scrollSurfaceEvidenceSchema
              .extend({ mime: z.literal("application/json") })
              .strict(),
          })
          .strict(),
        authorization: z
          .object({
            schemaVersion: z.literal(1),
            issuer: z.literal("relay-local-reviewed-origin"),
            signature: z.string(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const importedScrollEvidence = scrollSurfaceEvidenceSchema.extend({
  id: z.string().min(1),
  uri: z.string().min(1),
  sha256: z.string().min(1),
});
const importedScrollViewport = scrollSurfaceViewportSchema
  .extend({
    screenshot: importedScrollEvidence.extend({ mime: z.literal("image/png") }).passthrough(),
    accessibilityTree: importedScrollEvidence
      .extend({ mime: z.literal("application/json") })
      .passthrough(),
  })
  .passthrough();
export const logicalScrollSurfaceImportInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    targetProfileId: z.string().min(1),
    message: z.string().min(1),
    restoredStartViewport: z.boolean(),
    capturePolicy: z
      .object({
        captureMode: z.literal("full-surface"),
        source: z.enum(["default", "recommended", "explicit"]),
        reason: z.string().min(1),
        decidedAt: z.number(),
      })
      .passthrough(),
    viewports: z.array(importedScrollViewport).min(2),
  })
  .passthrough();
