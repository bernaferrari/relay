/**
 * Tour step schema, split from recipe-step-schema.ts under the source-size
 * budget. The factory keeps the exact step-target typing of the parent module.
 */
import * as z from "zod/v4";

export function createTourStepSchema<
  Observation extends z.ZodTypeAny,
  Prelude extends z.ZodTypeAny,
  EvidenceSurface extends z.ZodTypeAny,
>(input: {
  metadataShape: Record<string, z.ZodTypeAny>;
  screenIdentityObservationSchema: Observation;
  mappedPreludeStepSchema: Prelude;
  destinationEvidenceSurfaceSchema: EvidenceSurface;
}) {
  return z
    .object({
      ...input.metadataShape,
      kind: z.literal("tour"),
      depth: z.number().optional(),
      screenshot: z.boolean().optional(),
      captureOrigin: z.boolean().optional(),
      originVerifiedBySetup: z.boolean().optional(),
      maxStops: z.number().optional(),
      excludeLanguageRows: z.boolean().optional(),
      originScreenId: z.string().optional(),
      originTitle: z.string().optional(),
      originFingerprint: z.string().optional(),
      originAliases: z.array(z.string()).optional(),
      originObservations: z.array(input.screenIdentityObservationSchema).optional(),
      preludeSteps: z.array(input.mappedPreludeStepSchema).max(16).optional(),
      preludeStartFingerprint: z.string().optional(),
      preludeStartAliases: z.array(z.string()).optional(),
      fallbackStops: z
        .array(
          z
            .object({
              label: z.string(),
              identifier: z.string().optional(),
              point: z.object({ x: z.number(), y: z.number() }).strict().optional(),
              capture: z.boolean().optional(),
              optional: z.boolean().optional(),
              evidenceSurface: input.destinationEvidenceSurfaceSchema.optional(),
            })
            .strict(),
        )
        .optional(),
      landmarkStops: z
        .array(
          z
            .object({
              label: z.string(),
              identifier: z.string().optional(),
              point: z.object({ x: z.number(), y: z.number() }).strict().optional(),
            })
            .strict(),
        )
        .optional(),
      mappedStopsOnly: z.boolean().optional(),
      scrollSearch: z
        .object({ maxScrolls: z.number().optional(), amount: z.number().optional() })
        .strict()
        .optional(),
      returnAfterLast: z.boolean().optional(),
    })
    .strict();
}
