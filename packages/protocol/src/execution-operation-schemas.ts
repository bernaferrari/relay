import * as z from "zod/v4";
import {
  empty,
  identifier,
  natural,
  queryBoolean,
  unknownRecord,
} from "./operation-schema-primitives.js";
import { VISUAL_REVIEW_ACTIONS } from "./visual-verification.js";
import { CAPTURE_REVIEW_ACTIONS } from "./capture-review.js";
import { executionQueueMemberQuoteSchema } from "./execution-queue.js";

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
      duration: unknownRecord,
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
              target: unknownRecord,
            })
            .strict(),
        )
        .min(1),
      request: unknownRecord,
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
      limit: z.coerce.number().int().positive().optional(),
      appMapId: z.string().optional(),
      cursor: z.string().min(1).max(512).optional(),
    })
    .strict(),
  "run.get": runRef,
  "run.replay": replayRunRef,
  "run.review": z
    .object({
      runId: identifier("Persisted Run identifier"),
      action: z.enum(["approve", "reject", "defer"]),
      note: z.string().optional(),
    })
    .strict(),
  "run.evidence.get": z
    .object({
      runId: identifier("Persisted Run identifier"),
      limit: z.coerce.number().int().positive().optional(),
      includeBodies: queryBoolean.optional(),
      testStepId: identifier("authored Test step identifier").optional(),
    })
    .strict(),
  "run.story.get": runRef,
  "run.share.list": runRef,
  "run.share.create": z
    .object({
      runId: identifier("Persisted Run identifier"),
      expiresInHours: z
        .number()
        .positive()
        .min(5 / 60)
        .max(30 * 24),
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
      maxRuns: z.number().int().nonnegative().optional(),
      maxBytes: natural("Maximum retained bytes").optional(),
      olderThanMs: natural("Maximum Run age").optional(),
      dryRun: z.boolean().optional(),
    })
    .strict(),
  "run.visual.compare": runRef,
  "run.visual.review": z
    .object({
      runId: identifier("Persisted Run identifier"),
      comparisonId: identifier("Visual comparison identifier"),
      action: z.enum(VISUAL_REVIEW_ACTIONS),
      note: z.string().optional(),
    })
    .strict(),
  "run.capture.review": z
    .object({
      runId: identifier("Persisted Run identifier"),
      captureId: identifier("Capture review identifier"),
      action: z.enum(CAPTURE_REVIEW_ACTIONS),
      imageSha256: z.string().optional(),
      note: z.string().optional(),
      expectedReviewVersion: z.number().int().nonnegative().optional(),
    })
    .strict(),
  "run.visual-policy.get": runRef,
  "run.capture.reference.compare": runRef,
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
      expectedRevision: natural("Current visual-policy revision"),
      changeThreshold: z.number().min(0).max(1),
      pixelThreshold: z.number().int().min(0).max(255),
      regions: z.array(unknownRecord),
    })
    .strict(),
  "run.visual-baseline.update": z
    .object({
      runId: identifier("Persisted Run identifier"),
      action: z.literal("approve-new-baseline"),
      note: z.string().optional(),
    })
    .strict(),
} as const satisfies Readonly<Record<string, z.ZodObject>>;
