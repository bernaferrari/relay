import * as z from "zod/v4";
import { CAPTURE_REVIEW_STATUSES } from "./capture-review.js";

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

export const planCaptureReviewItemSchema = z
  .object({
    captureId: z.string(),
    caption: z.string(),
    status: z.enum(CAPTURE_REVIEW_STATUSES),
    runId: z.string().min(1).optional(),
    executionCaseId: z.string().min(1).optional(),
  })
  .passthrough()
  .refine(
    (item) => Boolean(item.runId) || (item.status === "missing" && Boolean(item.executionCaseId)),
    {
      message: "Captured evidence requires a Run; unstarted captures require a planned case.",
    },
  );

export const planCaptureReviewQueueSchema = z
  .object({
    items: z.array(planCaptureReviewItemSchema),
    summary: z
      .object({
        captured: z.number(),
        missing: z.number(),
        pending: z.number(),
        accepted: z.number(),
        issue: z.number(),
        needMoreEvidence: z.number(),
        planned: z.number(),
        blocked: z.number(),
      })
      .strict(),
  })
  .strict();
