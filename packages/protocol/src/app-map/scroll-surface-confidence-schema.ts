import * as z from "zod/v4";
import { stepTargetSchema } from "../recipe/recipe-step-schema.js";

const rect = z
  .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
  .strict();
const confidence = z.number();
const sourceViewportIndexes = z.array(z.number());

export const scrollSurfaceConfidenceModelSchema = z
  .object({
    schemaVersion: z.literal(1),
    classification: z.enum(["complete", "partial", "dynamic", "unsupported"]),
    confidence,
    capturedPixels: z.number(),
    documentExtent: z.enum(["known", "open"]),
    coverage: z.array(
      z
        .object({
          startY: z.number(),
          endY: z.number().nullable(),
          state: z.enum(["captured", "dynamic", "not-reached"]),
          confidence,
          sourceViewportIndexes,
        })
        .strict(),
    ),
    mergeAnchors: z.array(
      z
        .object({
          fromViewportIndex: z.number(),
          toViewportIndex: z.number(),
          documentY: z.number(),
          shiftY: z.number(),
          confidence,
          basis: z.enum(["semantic-or-visual", "capture-offset"]),
        })
        .strict(),
    ),
    regions: z.array(
      z
        .object({
          kind: z.enum(["sticky", "dynamic"]),
          coordinateSpace: z.literal("viewport"),
          rect,
          confidence,
          sourceViewportIndexes,
          target: stepTargetSchema.optional(),
          reason: z.string(),
        })
        .strict(),
    ),
    scrollContainer: z
      .object({
        target: stepTargetSchema,
        role: z.string().optional(),
        viewportRect: rect.optional(),
        nested: z.boolean(),
        confidence,
        sourceViewportIndexes,
      })
      .strict()
      .optional(),
  })
  .strict();
