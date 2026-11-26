import * as z from "zod/v4";

const actorKindSchema = z.enum(["human", "agent", "system"]);
const captureReviewActorSchema = z
  .object({ id: z.string().min(1), kind: actorKindSchema })
  .strict();

const normalizedRegionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
    name: z.string().optional(),
  })
  .strict()
  .superRefine((region, context) => {
    if (region.x + region.width > 1.000_001 || region.y + region.height > 1.000_001) {
      context.addIssue({
        code: "custom",
        message: "region must fit inside normalized image bounds",
      });
    }
  });

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

const captureReferenceComparisonSchema = z
  .object({
    state: z.enum(["match", "changed", "new", "incomparable"]),
    comparedAt: z.number(),
    referenceId: z.string().optional(),
    referenceRunId: z.string().optional(),
    referenceApprovedAt: z.number().optional(),
    referenceApprovedBy: z.object({ id: z.string(), kind: actorKindSchema }).strict().optional(),
    changeRatio: z.number().optional(),
    consideredPixels: z.number().optional(),
    ignoredPixels: z.number().optional(),
    changedPixels: z.number().optional(),
    pixelThreshold: z.number().optional(),
    changeThreshold: z.number().optional(),
    changedBounds: normalizedRegionSchema.optional(),
    sizeChanged: z.boolean().optional(),
    ignoreRegions: z.array(normalizedRegionSchema).optional(),
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

export const captureReviewDecisionOutputSchema = z
  .object({
    captureId: z.string().min(1),
    action: z.enum(["accept", "accept-as-reference", "report-issue", "need-more-evidence"]),
    decidedAt: z.number(),
    decidedBy: captureReviewActorSchema,
    imageSha256: z.string().optional(),
    note: z.string().optional(),
    requestId: z.string().optional(),
    reviewVersion: z.number().int().nonnegative().optional(),
    referenceBaseId: z.string().nullable().optional(),
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
      run: z.record(z.string(), z.unknown()),
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
