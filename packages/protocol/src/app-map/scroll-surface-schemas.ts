import * as z from "zod/v4";
import { stepTargetSchema } from "../recipe/recipe-step-schema.js";
import { scrollSurfaceConfidenceModelSchema } from "./scroll-surface-confidence-schema.js";

const id = z.string().min(1);
const at = z.number();

export const scrollSurfaceEvidenceSchema = z
  .object({
    id,
    uri: z.string(),
    sha256: z.string(),
    mime: z.enum(["image/png", "application/json"]),
    bytes: z.number(),
  })
  .strict();

const rawAccessibilityTreeEvidenceSchema = scrollSurfaceEvidenceSchema
  .extend({
    mime: z.literal("application/json"),
  })
  .strict();

export const screenVariantRawAccessibilityTreeSchema = rawAccessibilityTreeEvidenceSchema
  .extend({
    observationId: z.string().optional(),
    capturedAt: at.optional(),
  })
  .strict();

export const scrollSurfaceCapturePolicySchema = z
  .object({
    captureMode: z.enum(["viewport", "full-surface"]),
    source: z.enum(["default", "recommended", "explicit"]),
    reason: z.string(),
    decidedAt: at,
  })
  .strict();

const scrollSurfaceViewportSchema = z
  .object({
    index: z.number(),
    offsetY: z.number(),
    appendedHeight: z.number(),
    capturedAt: at,
    width: z.number(),
    height: z.number(),
    screenshot: scrollSurfaceEvidenceSchema.extend({ mime: z.literal("image/png") }).strict(),
    accessibilityTree: rawAccessibilityTreeEvidenceSchema,
  })
  .strict();

const scrollSurfaceDocumentOriginProofSchema = z
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

const scrollSurfaceSemanticIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    documentHeight: z.number(),
    viewportHeight: z.number(),
    anchors: z.array(
      z
        .object({
          order: z.number(),
          documentY: z.number(),
          target: stepTargetSchema,
          label: z.string().optional(),
          role: z.string().optional(),
          value: z.string().optional(),
          enabled: z.boolean().optional(),
          selected: z.boolean().optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const logicalScrollSurfaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    captureId: id,
    targetProfileId: id,
    capturePolicy: scrollSurfaceCapturePolicySchema
      .extend({
        captureMode: z.literal("full-surface"),
      })
      .strict(),
    capturedAt: at,
    status: z.enum(["completed", "stopped"]),
    reason: z.enum([
      "end-of-content",
      "screen-changed",
      "inspection-unavailable",
      "missing-page-anchor",
      "seam-ambiguous",
      "dimension-changed",
      "scroll-failed",
      "restore-failed",
      "start-viewport-unproven",
      "extent-unproven",
      "limit-reached",
    ]),
    message: z.string(),
    restoredStartViewport: z.boolean(),
    documentOriginProof: scrollSurfaceDocumentOriginProofSchema.optional(),
    viewports: z.array(scrollSurfaceViewportSchema),
    diagnosticViewports: z.array(scrollSurfaceViewportSchema).optional(),
    composite: scrollSurfaceEvidenceSchema
      .extend({ mime: z.literal("image/png"), width: z.number(), height: z.number() })
      .strict()
      .optional(),
    mergedTree: scrollSurfaceEvidenceSchema
      .extend({ mime: z.literal("application/json"), nodeCount: z.number() })
      .strict(),
    semanticIndex: scrollSurfaceSemanticIndexSchema.optional(),
    confidenceModel: scrollSurfaceConfidenceModelSchema.optional(),
    manifest: scrollSurfaceEvidenceSchema.extend({ mime: z.literal("application/json") }).strict(),
  })
  .strict();
