import * as z from "zod/v4";
import { persistedRunOutputSchema } from "../run/persisted-run-output-schema.js";
import {
  captureReferenceComparisonSchema,
  captureReviewActorSchema,
  captureReviewDecisionOutputSchema,
  normalizedCaptureRegionSchema,
} from "./capture-review-shared-schemas.js";

export { captureReferenceComparisonSchema, captureReviewDecisionOutputSchema };

const normalizedRegionSchema = normalizedCaptureRegionSchema;

const captureReviewConfigurationSchema = z
  .object({
    app: z.string().optional(),
    account: z.string().optional(),
    browser: z.string().optional(),
    viewport: z.string().optional(),
    locale: z.string().optional(),
    build: z.string().optional(),
  })
  .strict();

const captureReviewObservedSessionSchema = z
  .object({
    laneId: z.string().optional(),
    profileId: z.string().optional(),
    sessionStore: z.enum(["playwright-user-data", "electron-partition"]).optional(),
    iosHardwareClass: z
      .enum(["physical-ipad", "physical-iphone", "simulator", "unproven"])
      .optional(),
  })
  .strict();

export const captureReviewItemOutputSchema = z
  .object({
    captureId: z.string().min(1),
    caption: z.string(),
    status: z.enum(["pending", "accepted", "issue", "need-more-evidence", "missing"]),
    lookFor: z.string().optional(),
    framePath: z.string().optional(),
    imageSha256: z.string().optional(),
    stepId: z.string().optional(),
    slotId: z.string().optional(),
    requirementId: z.string().optional(),
    checkpointId: z.string().optional(),
    invocation: z.string().optional(),
    iteration: z.number().optional(),
    attempt: z.number().optional(),
    phase: z.string().optional(),
    settled: z.boolean().optional(),
    samples: z.number().optional(),
    stabilityMeasured: z.boolean().optional(),
    policy: z.enum(["fast", "stable", "sequence"]).optional(),
    configuration: captureReviewConfigurationSchema.optional(),
    observed: captureReviewObservedSessionSchema.optional(),
    masks: z.array(normalizedRegionSchema).optional(),
    decidedAt: z.number().optional(),
    decidedBy: captureReviewActorSchema.optional(),
    note: z.string().optional(),
    reviewVersion: z.number().int().nonnegative().optional(),
    reference: captureReferenceComparisonSchema.optional(),
  })
  .strict();

export const captureReviewSummaryOutputSchema = z
  .object({
    captured: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    issue: z.number().int().nonnegative(),
    needMoreEvidence: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative().optional(),
    changed: z.number().int().nonnegative().optional(),
    new: z.number().int().nonnegative().optional(),
  })
  .strict();

export const captureReviewQueueOutputSchema = z
  .object({
    items: z.array(captureReviewItemOutputSchema),
    summary: captureReviewSummaryOutputSchema,
  })
  .strict();

export const reviewInboxResultOutputSchema = z
  .object({
    entries: z.array(
      z
        .object({
          runId: z.string().min(1),
          title: z.string(),
          appMapId: z.string().optional(),
          testId: z.string().optional(),
          targetName: z.string().optional(),
          platform: z.string().optional(),
          data: z.record(z.string(), z.string()).optional(),
          finishedAt: z.number(),
          outcome: z.string().optional(),
          items: z.array(captureReviewItemOutputSchema),
        })
        .strict(),
    ),
    totals: captureReviewSummaryOutputSchema,
    runsConsidered: z.number().int().nonnegative(),
  })
  .strict();

export const captureReviewOperationOutputSchemas = {
  "review.inbox.list": reviewInboxResultOutputSchema,
  "run.capture.reference.compare": z.object({ queue: captureReviewQueueOutputSchema }).strict(),
  "run.capture.reference.ignore-regions.update": z
    .object({ queue: captureReviewQueueOutputSchema })
    .strict(),
  "run.capture.review": z
    .object({
      run: persistedRunOutputSchema,
      queue: captureReviewQueueOutputSchema,
      decision: captureReviewDecisionOutputSchema,
      referenceUpdate: z
        .object({
          status: z.enum(["updated", "revoked", "unchanged", "failed"]),
          message: z.string().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
} as const satisfies Readonly<Record<string, z.ZodType>>;
