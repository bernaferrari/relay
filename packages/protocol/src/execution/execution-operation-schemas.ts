import * as z from "zod/v4";
import {
  empty,
  explicitQueryBoolean,
  identifier,
  natural,
  queryBoolean,
  queryNumber,
  unknownRecord,
} from "../operation/operation-schema-primitives.js";
import { VISUAL_REVIEW_ACTIONS } from "../visual/visual-verification.js";
import { CAPTURE_REVIEW_ACTIONS } from "../capture/capture-review.js";
import { executionQueueMemberQuoteSchema } from "./execution-queue.js";
import { localAgentDeviceAdmissionTargetSchema } from "./execution-target-schemas.js";
import { localCampaignAdmissionRequestSchema } from "../campaign/campaign-capacity-operation-output-schemas.js";

const runRef = z.object({ runId: identifier("Persisted Run identifier") }).strict();
const replayRunRef = z
  .object({
    runId: identifier("Persisted Run identifier"),
    mode: z.enum(["saved-steps", "same-configuration"]).optional(),
  })
  .strict();
const batchRef = z.object({ batchId: identifier("Batch identifier") }).strict();
const durationCohort = z
  .object({
    targetId: identifier("Target identifier"),
    platform: z.enum(["android", "ios", "browser"]),
    testId: identifier("Test identifier"),
    action: identifier("Execution action"),
  })
  .strict();

const visualPolicyRegion = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    mode: z.enum(["compare", "ignore"]),
    frameIndex: z.number().int().nonnegative(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .catchall(z.unknown())
  .refine(
    ({ x, y, width, height }) => x + width <= 1 && y + height <= 1,
    "Visual region must fit inside normalized frame bounds",
  );

/** Job, campaign, Run, and evidence operation descriptors. */
export const executionOperationSchemas = {
  "campaign.capacity.preflight": z
    .object({
      targets: z
        .array(
          z
            .object({
              targetId: identifier("Target identifier"),
              platform: z.enum(["android", "ios", "browser"]),
            })
            .strict(),
        )
        .min(1),
      workItems: natural("Total campaign work items"),
      workItemsByPlatform: z.partialRecord(
        z.enum(["android", "ios", "browser"]),
        natural("Platform work items"),
      ),
      duration: z
        .object({
          workItemDurationMs: z.number(),
          provenance: z.enum(["observed-p50", "observed-p95", "supplied"]),
          observedAt: z.number().optional(),
          sampleCount: z.number().optional(),
          maxAgeMs: z.number().optional(),
        })
        .passthrough()
        .superRefine((value, ctx) => {
          if (value.provenance === "supplied") return;
          for (const field of ["observedAt", "sampleCount", "maxAgeMs"] as const) {
            if (value[field] === undefined) {
              ctx.addIssue({
                code: "custom",
                path: [field],
                message: `${field} is required for observed durations`,
              });
            }
          }
        }),
      deadlineMs: natural("Campaign deadline"),
      setupHeadroomMs: natural("Setup headroom").optional(),
      recoveryHeadroomMs: natural("Recovery headroom").optional(),
      queueMembers: z.array(executionQueueMemberQuoteSchema).optional(),
    })
    .strict(),
  "campaign.duration.cohorts.estimate": z
    .object({
      cohorts: z.array(durationCohort).min(1),
      maxAgeMs: natural("Maximum evidence age"),
      minSamples: natural("Minimum samples").optional(),
      maxSamples: natural("Maximum samples").optional(),
      percentile: z.enum(["p50", "p95"]).optional(),
      durationSource: z.enum(["run-wall-clock", "evidence-completion"]).optional(),
    })
    .strict(),
  "campaign.local-admission.preflight": z
    .object({
      workItems: z
        .array(
          z
            .object({
              id: identifier("Work-item identifier"),
              testId: identifier("Test identifier"),
              action: identifier("Execution action"),
              target: localAgentDeviceAdmissionTargetSchema,
            })
            .strict(),
        )
        .min(1),
      request: localCampaignAdmissionRequestSchema,
    })
    .strict(),
  "job.active.cancel": empty,
  "job.matrix.start": z
    .object({
      action: identifier("Action identifier"),
      matrixId: identifier("Matrix identifier").optional(),
      serial: z.string().optional(),
      cases: z.array(unknownRecord).optional(),
    })
    .catchall(z.unknown()),
  "job.compatibility-matrix.start": z
    .object({
      action: identifier("Action identifier"),
      matrixId: identifier("Compatibility matrix identifier"),
    })
    .catchall(z.unknown()),
  "job.soak.start": z
    .object({
      recipe: identifier("Compiled execution-plan identifier"),
      matrixId: identifier("Compatibility matrix identifier"),
      repetitions: z.number().int().positive().optional(),
      prodAccountMatch: z.string().optional(),
    })
    .strict(),
  "job.combine.export": batchRef,
  "job.combine.analysis": batchRef.extend({ triage: z.literal("jev").optional() }),
  "job.combine.capture.review": z
    .object({
      batchId: identifier("Plan campaign identifier"),
      pending: queryBoolean.optional(),
      screen: z.string().trim().min(1).max(256).optional(),
      device: z.string().trim().min(1).max(256).optional(),
      account: z.string().trim().min(1).max(256).optional(),
    })
    .strict(),
  "job.combine.capture.review.apply": z
    .object({
      batchId: identifier("Plan campaign identifier"),
      action: z.enum(CAPTURE_REVIEW_ACTIONS),
      items: z
        .array(
          z
            .object({
              runId: identifier("Persisted Run identifier"),
              captureId: identifier("Capture review identifier"),
              imageSha256: z.string().optional(),
              expectedReviewVersion: z.number().int().nonnegative().optional(),
              action: z.enum(CAPTURE_REVIEW_ACTIONS).optional(),
              note: z.string().max(2_000).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(500),
      pending: queryBoolean.optional(),
      screen: z.string().trim().min(1).max(256).optional(),
      device: z.string().trim().min(1).max(256).optional(),
      account: z.string().trim().min(1).max(256).optional(),
    })
    .strict(),
  "run.list": z
    .object({
      limit: queryNumber.optional(),
      appMapId: identifier("App Map identifier").optional(),
      cursor: z.string().min(1).max(512).optional(),
      latestPerTest: explicitQueryBoolean
        .optional()
        .describe("Only each saved Test's newest Run, from the whole history"),
    })
    .strict(),
  "run.get": runRef,
  "run.replay": replayRunRef,
  "run.review": z
    .object({
      runId: identifier("Persisted Run identifier"),
      action: z.enum(["approve", "reject", "defer"]),
      note: z.string().min(1).optional(),
    })
    .strict(),
  "run.evidence.get": z
    .object({
      runId: identifier("Persisted Run identifier"),
      limit: queryNumber.pipe(z.number().max(2000)).optional(),
      includeBodies: explicitQueryBoolean.optional(),
      testStepId: identifier("authored Test step identifier").optional(),
    })
    .strict(),
  "run.story.get": runRef,
  "run.verdict.get": runRef,
  "run.share.list": runRef,
  "run.share.create": z
    .object({
      runId: identifier("Persisted Run identifier"),
      expiresInHours: z.union([z.number(), z.string().trim().min(1).transform(Number)]).pipe(
        z
          .number()
          .min(5 / 60)
          .max(30 * 24),
      ),
      includeBatch: z.boolean().optional(),
    })
    .strict(),
  "run.share.revoke": z
    .object({
      runId: identifier("Persisted Run identifier"),
      shareId: identifier("Run share identifier"),
    })
    .strict(),
  "run.catalog.rebuild": empty,
  "run.retention.apply": z
    .object({
      maxAgeDays: z
        .number()
        .positive()
        .optional()
        .describe("Maximum age of an unprotected Run in days"),
      maxBytes: natural("Maximum retained bytes").optional(),
      dryRun: z.boolean().optional(),
    })
    .strict(),
  "run.visual.compare": runRef,
  "run.visual.review": z
    .object({
      runId: identifier("Persisted Run identifier"),
      comparisonId: identifier("Visual comparison identifier"),
      action: z.enum(VISUAL_REVIEW_ACTIONS),
      note: z.string().min(1).optional(),
    })
    .strict(),
  "run.capture.review": z
    .object({
      runId: identifier("Persisted Run identifier"),
      captureId: identifier("Capture review identifier"),
      action: z.enum(CAPTURE_REVIEW_ACTIONS),
      imageSha256: z.string().min(1).optional(),
      note: z.string().min(1).optional(),
      expectedReviewVersion: z.number().int().nonnegative().optional(),
    })
    .strict(),
  "run.visual-policy.get": runRef,
  "run.capture.reference.compare": runRef,
  "review.inbox.list": z
    .object({
      sinceDays: z.coerce.number().int().min(1).max(365).optional(),
      appMapId: identifier("App identifier").optional(),
      countOnly: queryBoolean.optional(),
    })
    .strict(),
  "run.capture.reference.ignore-regions.update": z
    .object({
      runId: identifier("Persisted Run identifier"),
      captureId: identifier("Capture review identifier"),
      regions: z
        .array(
          z
            .object({
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
              width: z.number().gt(0).max(1),
              height: z.number().gt(0).max(1),
              name: z.string().max(120).optional(),
            })
            .strict(),
        )
        .max(50),
    })
    .strict(),
  "run.visual-policy.update": z
    .object({
      runId: identifier("Persisted Run identifier"),
      expectedRevision: z.number().int().nonnegative().describe("Current visual-policy revision"),
      changeThreshold: z.number().min(0).max(1),
      pixelThreshold: z.number().int().min(0).max(255),
      regions: z.array(visualPolicyRegion).max(100),
    })
    .strict(),
  "run.visual-baseline.update": z
    .object({
      runId: identifier("Persisted Run identifier"),
      action: z.literal("approve-new-baseline"),
      note: z.string().min(1).optional(),
    })
    .strict(),
} as const satisfies Readonly<Record<string, z.ZodObject>>;
