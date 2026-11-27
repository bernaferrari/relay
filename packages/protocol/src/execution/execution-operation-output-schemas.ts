import * as z from "zod/v4";
import { planCaptureReviewQueueSchema } from "../capture/capture-review-schema.js";
import { repeatFailureClusterReportSchema } from "../repeat-failure.js";
import { executionJobSchema } from "./execution-target-schemas.js";
import {
  admissionSchema,
  appMapCellStateSchema,
  combineBatchSchema,
  combineCampaignSchema,
  combineEvidenceAnalysisReportSchema,
  combineEvidencePackManifestSchema,
  jobSummarySchema,
  matrixExpansionSchema,
  preparedCasePlanSchema,
} from "../combine/combine-output-schemas.js";
import { sourceRevisionSchema } from "../app-map/app-map-test-run-schemas.js";
import { persistedRunOutputSchema } from "../run/persisted-run-output-schema.js";

const runSummarySchema = jobSummarySchema
  .extend({
    writtenAt: z.number(),
    artifactCount: z.number(),
    artifactBytes: z.number(),
    captureSummary: z
      .object({
        captured: z.number(),
        missing: z.number(),
        pending: z.number(),
        accepted: z.number(),
        issue: z.number(),
        needMoreEvidence: z.number(),
      })
      .strict()
      .optional(),
    storageBytes: z.number(),
    pinned: z.boolean(),
    retentionClass: z.enum(["standard", "protected"]),
    sourceRevision: sourceRevisionSchema.optional(),
  })
  .strict();

/** Runtime response contracts for case plans, Combines, jobs, and Run maintenance. */
const runShareSummaryOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    runId: z.string().min(1),
    batchId: z.string().optional(),
    title: z.string().min(1),
    createdAt: z.number(),
    expiresAt: z.number(),
    createdBy: z.string().min(1),
    runCount: z.number(),
    frameCount: z.number(),
    status: z.enum(["active", "expired", "revoked"]),
    revokedAt: z.number().optional(),
  })
  .strict();

const visualReviewActorOutputSchema = z
  .object({ id: z.string().min(1), kind: z.enum(["human", "agent", "system"]) })
  .strict();
const visualRegionOutputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    mode: z.enum(["compare", "ignore"]),
    frameIndex: z.number().int().nonnegative(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict()
  .superRefine((region, context) => {
    if (region.x + region.width > 1 || region.y + region.height > 1) {
      context.addIssue({
        code: "custom",
        message: "visual region must fit inside normalized frame bounds",
      });
    }
  });
const visualComparisonPolicyOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    recipeId: z.string().min(1),
    projectKey: z.string().min(1),
    targetKey: z.string().min(1),
    revision: z.number().int().nonnegative(),
    changeThreshold: z.number().min(0).max(1),
    pixelThreshold: z.number().int().min(0).max(255),
    regions: z.array(visualRegionOutputSchema).max(100),
    updatedAt: z.number(),
    updatedBy: visualReviewActorOutputSchema,
  })
  .strict();
const visualFrameMetadataOutputSchema = z
  .object({
    index: z.number().int().nonnegative(),
    path: z.string().min(1),
    artifactPath: z.string().optional(),
    caption: z.string(),
    capturedAt: z.number(),
    bytes: z.number(),
    sha256: z.string().min(1),
    width: z.number().optional(),
    height: z.number().optional(),
    stepId: z.string().optional(),
  })
  .strict();
const visualRunSnapshotOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    recipeId: z.string().min(1),
    projectKey: z.string().min(1),
    targetKey: z.string().min(1),
    platform: z.string().optional(),
    targetProfileId: z.string().optional(),
    appVersion: z.string().optional(),
    capturedAt: z.number(),
    frameCount: z.number().int().nonnegative(),
    aggregateSha256: z.string().min(1),
    frames: z.array(visualFrameMetadataOutputSchema),
  })
  .strict();
const visualBaselineOutputSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: z.string().min(1),
    recipeId: z.string().min(1),
    projectKey: z.string().min(1),
    targetKey: z.string().min(1),
    runId: z.string().min(1),
    approvedAt: z.number(),
    approvedBy: visualReviewActorOutputSchema,
    approved: visualRunSnapshotOutputSchema,
  })
  .strict();
const visualFrameDiffOutputSchema = z
  .object({
    index: z.number().int().nonnegative(),
    code: z.enum([
      "FRAME_MATCH",
      "FRAME_CHANGED",
      "FRAME_ADDED",
      "FRAME_REMOVED",
      "FRAME_NOT_COMPARABLE",
    ]),
    approved: visualFrameMetadataOutputSchema.optional(),
    latest: visualFrameMetadataOutputSchema.optional(),
    consideredPixels: z.number().optional(),
    changedPixels: z.number().optional(),
    changeRatio: z.number().optional(),
    changedBounds: z
      .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .strict()
      .optional(),
  })
  .strict();
const visualComparisonOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    recipeId: z.string().min(1),
    projectKey: z.string().min(1),
    targetKey: z.string().min(1),
    comparedAt: z.number(),
    code: z.enum([
      "VISUAL_MATCH",
      "VISUAL_CHANGED",
      "VISUAL_BASELINE_MISSING",
      "VISUAL_EXPECTED_VARIATION",
      "VISUAL_NOT_COMPARABLE",
    ]),
    baseline: visualBaselineOutputSchema.nullable(),
    approved: visualRunSnapshotOutputSchema.nullable(),
    latest: visualRunSnapshotOutputSchema,
    policy: visualComparisonPolicyOutputSchema,
    diff: z
      .object({
        algorithm: z.literal("pixel-rgba-regions-v1"),
        code: z.enum([
          "VISUAL_MATCH",
          "VISUAL_CHANGED",
          "VISUAL_BASELINE_MISSING",
          "VISUAL_EXPECTED_VARIATION",
          "VISUAL_NOT_COMPARABLE",
        ]),
        approvedFrameCount: z.number().int().nonnegative(),
        latestFrameCount: z.number().int().nonnegative(),
        matchedFrames: z.number().int().nonnegative(),
        changedFrames: z.number().int().nonnegative(),
        addedFrames: z.number().int().nonnegative(),
        removedFrames: z.number().int().nonnegative(),
        frames: z.array(visualFrameDiffOutputSchema),
        policyRevision: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
const visualReviewDecisionOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    comparisonId: z.string().min(1),
    recipeId: z.string().min(1),
    projectKey: z.string().min(1),
    targetKey: z.string().min(1),
    latestRunId: z.string().min(1),
    baselineId: z.string().optional(),
    action: z.enum([
      "approve-new-baseline",
      "keep-baseline",
      "fix-connection",
      "retry",
      "mark-expected-variation",
    ]),
    resultCode: z.enum([
      "VISUAL_BASELINE_APPROVED",
      "VISUAL_BASELINE_KEPT",
      "VISUAL_FIX_REQUESTED",
      "VISUAL_RETRY_REQUESTED",
      "VISUAL_EXPECTED_VARIATION_RECORDED",
    ]),
    actor: visualReviewActorOutputSchema,
    decidedAt: z.number(),
    note: z.string().optional(),
    approvedBaselineId: z.string().optional(),
  })
  .strict();

const runReviewOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["pending", "approved", "rejected"]),
    capability: z.string().min(1),
    reason: z.string(),
    requestedAt: z.number(),
    requestedBy: z
      .object({ id: z.string().min(1), kind: z.enum(["human", "agent", "system"]) })
      .strict()
      .optional(),
    decidedAt: z.number().optional(),
    decidedBy: z
      .object({ id: z.string().min(1), kind: z.enum(["human", "agent", "system"]) })
      .strict()
      .optional(),
    note: z.string().optional(),
  })
  .strict();

const offlineReplaySelectorTargetOutputSchema = z
  .object({
    identifier: z.string().optional(),
    ref: z.string().optional(),
    label: z.string().optional(),
    role: z.string().optional(),
    text: z.string().optional(),
    relation: z
      .object({
        kind: z.literal("following-row"),
        anchor: z
          .object({
            identifier: z.string().optional(),
            ref: z.string().optional(),
            label: z.string().optional(),
            role: z.string().optional(),
            text: z.string().optional(),
          })
          .strict(),
      })
      .strict()
      .optional(),
    hasPointFallback: z.boolean().optional(),
  })
  .strict();
const offlineReplaySelectorAttemptOutputSchema = z
  .object({
    status: z.enum(["resolved", "failed"]),
    strategy: z.string().optional(),
    target: offlineReplaySelectorTargetOutputSchema.optional(),
    error: z.string().optional(),
    artifact: z.string().min(1),
    capturedAt: z.number(),
  })
  .strict();
const offlineReplayCurrentMatcherOutputSchema = z
  .object({
    status: z.enum(["resolved", "blocked", "unavailable"]),
    comparison: z.enum(["matches-recorded", "changed", "not-recorded", "not-comparable"]),
    inputDigest: z.string().min(1),
    evidence: z.array(z.string()),
    selectors: z.array(
      z
        .object({
          recipeId: z.string().min(1),
          recipeStepId: z.string().optional(),
          stepKind: z.enum(["tap", "reveal", "expect", "wait-for"]),
          target: offlineReplaySelectorTargetOutputSchema,
          status: z.enum(["resolved", "blocked", "unavailable"]),
          method: z.enum(["identifier", "label", "text", "relation", "point"]).optional(),
          detail: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
const offlineReplayCheckOutputSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    recordedStatus: z.enum(["passed", "failed", "blocked"]),
    replayStatus: z.enum(["proved", "root-failure", "invalid-cascade", "independent-failure"]),
    warmSourceScreenId: z.string().optional(),
    lastProvenScreenId: z.string().optional(),
    expectedDestinationScreenId: z.string().optional(),
    error: z.string().optional(),
    reason: z.string(),
    selectorAttempts: z.array(offlineReplaySelectorAttemptOutputSchema),
    currentMatcher: offlineReplayCurrentMatcherOutputSchema.optional(),
    evidence: z.array(z.string()),
  })
  .strict();
const offlineReplayReportOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("offline-evidence-replay"),
    runId: z.string().min(1),
    sourceRunStatus: z.string().min(1),
    planDigest: z.string().min(1),
    appMapId: z.string().optional(),
    appMapRevision: z.number().optional(),
    testId: z.string().optional(),
    summary: z
      .object({
        checks: z.number(),
        proved: z.number(),
        rootFailures: z.number(),
        invalidCascades: z.number(),
        independentFailures: z.number(),
      })
      .strict(),
    firstRootFailure: z
      .object({
        checkId: z.string().min(1),
        title: z.string(),
        kind: z.enum(["action-no-op", "transition-unproved", "unproved-pass", "recorded-failure"]),
        error: z.string().optional(),
        evidence: z.array(z.string()),
      })
      .strict()
      .optional(),
    cursorTimeline: z.array(
      z
        .object({
          status: z.enum(["proven", "unknown"]),
          screenId: z.string().optional(),
          reason: z.string().optional(),
          source: z.string().optional(),
          artifact: z.string().min(1),
          capturedAt: z.number(),
        })
        .strict(),
    ),
    checks: z.array(offlineReplayCheckOutputSchema),
    repairProposals: z.array(
      z
        .object({
          id: z.string().min(1),
          checkId: z.string().optional(),
          kind: z.enum(["review-current-matcher", "replay-root-check", "recapture-frozen-plan"]),
          reason: z.string(),
          mutation: z.literal("none"),
          requiresReview: z.literal(true),
          evidence: z.array(z.string()),
        })
        .strict(),
    ),
    blockers: z.array(
      z
        .object({
          kind: z.enum(["root-failure", "unproven-origin", "missing-frozen-plan"]),
          checkIds: z.array(z.string()),
          message: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const executionOperationOutputSchemas = {
  "run.review": z.object({ run: persistedRunOutputSchema, review: runReviewOutputSchema }).strict(),
  "run.replay.offline": z.object({ report: offlineReplayReportOutputSchema }).strict(),

  "run.visual.compare": z.object({ comparison: visualComparisonOutputSchema }).strict(),
  "run.visual.review": z
    .object({
      decision: visualReviewDecisionOutputSchema,
      baseline: visualBaselineOutputSchema.nullable(),
    })
    .strict(),
  "run.visual-baseline.update": z
    .object({
      comparison: visualComparisonOutputSchema,
      decision: visualReviewDecisionOutputSchema,
      baseline: visualBaselineOutputSchema,
    })
    .strict(),
  "run.visual-policy.get": z.object({ policy: visualComparisonPolicyOutputSchema }).strict(),
  "run.visual-policy.update": z
    .object({
      policy: visualComparisonPolicyOutputSchema,
      comparison: visualComparisonOutputSchema,
    })
    .strict(),

  "run.share.list": z.object({ shares: z.array(runShareSummaryOutputSchema) }).strict(),
  "run.share.create": z
    .object({
      share: runShareSummaryOutputSchema,
      token: z.string().min(1),
      path: z.string().min(1),
      url: z.string().optional(),
    })
    .strict(),
  "run.share.revoke": z.object({ share: runShareSummaryOutputSchema }).strict(),

  "run.list": z
    .object({
      runs: z.array(runSummarySchema),
      totalCount: z.number().int().nonnegative().optional(),
      nextCursor: z.string().optional(),
      root: z.string().optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.totalCount !== undefined && value.totalCount < value.runs.length) {
        context.addIssue({
          code: "custom",
          message: "totalCount must be at least as large as runs",
          path: ["totalCount"],
        });
      }
    }),
  "job.combine.start": z
    .object({
      batch: combineBatchSchema,
      matrix: preparedCasePlanSchema,
      cells: z.array(appMapCellStateSchema),
      jobs: z.array(jobSummarySchema),
      selectedCellIds: z.array(z.string()),
      plan: z
        .object({
          schemaVersion: z.literal(1),
          appMapId: z.string(),
          appMapRevision: z.number(),
          rootRecipeId: z.string(),
        })
        .passthrough(),
      admission: admissionSchema.optional(),
      campaign: combineCampaignSchema.optional(),
    })
    .strict(),
  "job.combine.export": z
    .object({
      rootDir: z.string(),
      manifest: combineEvidencePackManifestSchema,
      jobIds: z.array(z.string()),
    })
    .strict(),
  "job.combine.analysis": combineEvidenceAnalysisReportSchema,
  "job.combine.capture.review": z
    .object({
      queue: planCaptureReviewQueueSchema,
    })
    .strict(),
  "job.combine.capture.review.apply": z
    .object({
      queue: planCaptureReviewQueueSchema,
      results: z.array(
        z
          .object({
            runId: z.string(),
            captureId: z.string(),
            status: z.enum(["applied", "missing", "not-found", "conflict", "actor-required"]),
            error: z.string().optional(),
          })
          .strict(),
      ),
    })
    .strict(),
  "job.combine.campaign.get": z.object({ campaign: combineCampaignSchema }).strict(),
  "job.combine.campaign.repeat.active": z
    .object({ campaign: combineCampaignSchema.nullable() })
    .strict(),
  "job.combine.campaign.repeat.clusters": repeatFailureClusterReportSchema,
  "job.combine.campaign.resume": z
    .object({
      campaign: combineCampaignSchema,
      jobs: z.array(jobSummarySchema),
      cells: z.array(appMapCellStateSchema),
      admission: admissionSchema.optional(),
    })
    .strict(),
  "job.combine.campaign.cancel": z.object({ campaign: combineCampaignSchema }).strict(),
  "job.combine.campaign.triage": z.object({ campaign: combineCampaignSchema }).strict(),
  "job.retry": z.object({ job: executionJobSchema }).strict(),
  "run.replay": z.object({ job: executionJobSchema }).strict(),
  "job.active.cancel": z.object({ job: executionJobSchema }).strict(),
  "job.matrix.start": z
    .object({ matrix: preparedCasePlanSchema, jobs: z.array(executionJobSchema) })
    .strict(),
  "job.compatibility-matrix.start": z
    .object({
      matrix: matrixExpansionSchema,
      jobs: z.array(executionJobSchema),
      batchId: z.string(),
      repetitions: z.number(),
    })
    .strict(),
  "job.soak.start": z
    .object({
      matrix: matrixExpansionSchema,
      jobs: z.array(executionJobSchema),
      batchId: z.string(),
      repetitions: z.number(),
    })
    .strict(),
  "run.catalog.rebuild": z.object({ indexed: z.number(), incomplete: z.number() }).strict(),
  "run.retention.apply": z
    .object({
      disabled: z.boolean(),
      candidates: z.array(runSummarySchema),
      deleted: z.array(z.string()),
    })
    .strict(),
  "run.pin.update": z.object({ ok: z.literal(true), pinned: z.boolean() }).strict(),
} as const satisfies Readonly<Record<string, z.ZodType>>;

export { executionTargetSchema } from "./execution-target-schemas.js";
export { combineCampaignSchema } from "../combine/combine-output-schemas.js";
