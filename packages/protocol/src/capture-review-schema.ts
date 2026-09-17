import * as z from "zod/v4";

/** Frozen obligations cross the API before any Run or image exists. */
export const captureReviewPlannedSlotSchema = z
  .object({
    requirementId: z.string().optional(),
    checkpointId: z.string().min(1),
    configuration: z
      .object({
        app: z.string().optional(),
        account: z.string().optional(),
        browser: z.string().optional(),
        viewport: z.string().optional(),
        locale: z.string().optional(),
        build: z.string().optional(),
      })
      .strict()
      .optional(),
    invocation: z.string().optional(),
    iteration: z.number().int().nonnegative().optional(),
    attempt: z.number().int().positive().optional(),
    phase: z.string().optional(),
    caption: z.string(),
    lookFor: z.string().optional(),
    stepId: z.string().optional(),
    intervalMs: z.number().nonnegative().optional(),
  })
  .strict();
