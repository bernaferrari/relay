import * as z from "zod/v4";
import { empty, identifier, natural, unknownRecord } from "./operation-schema-primitives.js";

const runRef = z.object({ runId: identifier("Persisted Run identifier") }).strict();
const batchRef = z.object({ batchId: identifier("Batch identifier") }).strict();
const durationCohort = z
  .object({
    targetId: identifier("Target identifier"),
    platform: z.enum(["android", "ios"]),
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
              platform: z.enum(["android", "ios"]),
            })
            .strict(),
        )
        .min(1),
      workItems: natural("Total campaign work items"),
      workItemsByPlatform: z.record(z.enum(["android", "ios"]), natural("Platform work items")),
      duration: unknownRecord,
      deadlineMs: natural("Campaign deadline"),
      setupHeadroomMs: natural("Setup headroom").optional(),
      recoveryHeadroomMs: natural("Recovery headroom").optional(),
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
  "job.combine.analysis": batchRef,
  "run.list": z
    .object({
      limit: z.number().int().positive().optional(),
      appMapId: z.string().optional(),
      cursor: z.string().min(1).max(512).optional(),
    })
    .strict(),
  "run.get": runRef,
  "run.replay": runRef,
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
      limit: z.number().int().positive().optional(),
      includeBodies: z.boolean().optional(),
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
      action: z.enum(["approve", "reject"]),
      note: z.string().optional(),
    })
    .strict(),
  "run.visual-policy.get": runRef,
  "run.visual-policy.update": z
    .object({
      runId: identifier("Persisted Run identifier"),
      expectedRevision: natural("Current visual-policy revision"),
      changeThreshold: z.number().min(0).max(1),
      pixelThreshold: z.number().min(0).max(1),
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
