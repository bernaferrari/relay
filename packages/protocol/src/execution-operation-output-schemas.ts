import * as z from "zod/v4";
import {
  captureReviewPlannedSlotSchema,
  planCaptureReviewQueueSchema,
} from "./capture-review-schema.js";
import { browserCaseProfileSchema } from "./browser-case-profile.js";
import { combineCampaignAdmissionSchema } from "./campaign-capacity-operation-output-schemas.js";
import {
  repeatWorkflowMutationSchema,
  sourceRevisionSchema,
} from "./app-map-test-operation-schemas.js";
import { repeatPilotSpecSchema, repeatSpecSchema } from "./repeat-spec.js";
import { repeatFailureClusterReportSchema } from "./repeat-failure.js";

const targetCapabilitySchema = z.enum([
  "snapshot",
  "screenshot",
  "stream",
  "recording",
  "tap",
  "type",
  "scroll",
  "clipboard",
  "network",
  "logs",
  "permissions",
  "location",
  "rotation",
  "lock-screen",
  "app-switcher",
  "install",
  "launch",
]);
const targetProfileSchema = z
  .object({
    id: z.string(),
    targetId: z.string(),
    source: z.enum(["device", "browser"]),
    platform: z.enum(["android", "ios", "browser"]),
    name: z.string(),
    model: z.string().optional(),
    androidAvdName: z.string().optional(),
    osVersion: z.string().optional(),
    viewport: z.object({ width: z.number(), height: z.number() }).strict().optional(),
    browserCaseProfile: browserCaseProfileSchema.optional(),
    capabilities: z.array(targetCapabilitySchema),
    observedAt: z.number(),
  })
  .strict();

const executionTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal("local-device"),
      provider: z
        .object({ key: z.literal("relay.local.agent-device"), scope: z.literal("local") })
        .strict(),
      targetId: z.string(),
      platform: z.enum(["android", "ios"]),
      identity: z.object({ kind: z.literal("device-serial"), value: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal("local-browser"),
      provider: z
        .object({ key: z.literal("relay.local.browser"), scope: z.literal("local") })
        .strict(),
      targetId: z.string(),
      platform: z.literal("browser"),
      identity: z.object({ kind: z.literal("browser-target"), value: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal("provider-session"),
      provider: z.object({ key: z.string(), scope: z.literal("remote") }).strict(),
      targetId: z.string(),
      platform: z.enum(["android", "ios"]),
      identity: z.object({ kind: z.literal("provider-session"), value: z.string() }).strict(),
    })
    .strict(),
]);

/** Full jobs intentionally evolve with evidence collectors and runner payloads. */
const executionJobSchema = z
  .object({
    id: z.string(),
    workflowId: z.string().optional(),
    action: z.string(),
    status: z.string(),
    queuedAt: z.number(),
    startedAt: z.number().optional(),
    finishedAt: z.number().optional(),
    error: z.string().optional(),
    batchId: z.string().optional(),
  })
  .passthrough();

const actorSchema = z
  .object({ id: z.string(), kind: z.enum(["human", "agent", "system"]) })
  .strict();
const runReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["pending", "approved", "rejected"]),
    capability: z.string(),
    reason: z.string(),
    requestedAt: z.number(),
    requestedBy: actorSchema.optional(),
    decidedAt: z.number().optional(),
    decidedBy: actorSchema.optional(),
    note: z.string().optional(),
  })
  .strict();
const campaignCheckSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.enum(["passed", "failed", "blocked"]),
    startedAt: z.number(),
    finishedAt: z.number(),
    durationMs: z.number(),
    error: z.string().optional(),
    dependencyReason: z.string().optional(),
  })
  .strict();
const jobSummarySchema = z
  .object({
    sourceTest: z.object({ appMapId: z.string(), testId: z.string() }).strict().optional(),
    id: z.string(),
    workflowId: z.string().optional(),
    action: z.string(),
    title: z.string().optional(),
    status: z.string(),
    queuedAt: z.number(),
    startedAt: z.number().optional(),
    finishedAt: z.number().optional(),
    durationMs: z.number().optional(),
    platform: z.string().optional(),
    serial: z.string().optional(),
    targetProfileId: z.string().optional(),
    outcome: z.string().optional(),
    review: runReviewSchema.optional(),
    batchId: z.string().optional(),
    caseIndex: z.number().optional(),
    caseCount: z.number().optional(),
    matrixCase: z
      .object({
        kind: z.literal("combine"),
        appMapId: z.string().optional(),
        testId: z.string().optional(),
        combineId: z.string().optional(),
        world: z.string(),
        values: z.record(z.string(), z.string()),
        expectedScreenshots: z.number().optional(),
      })
      .strict()
      .optional(),
    frameCount: z.number(),
    destIdentity: z
      .array(z.object({ path: z.string(), caption: z.string().optional() }).strict())
      .optional(),
    evidenceComplete: z.boolean().optional(),
    checks: z.array(campaignCheckSchema).optional(),
    lastLogs: z.array(z.string()).optional(),
  })
  .strict();

const runCaseProvenanceSchema = z
  .object({
    variableId: z.string(),
    variableName: z.string(),
    source: z.enum(["static", "list", "generated"]),
    provider: z.string().optional(),
    model: z.string().optional(),
    generatedAt: z.number().optional(),
    seed: z.number().optional(),
  })
  .strict();
const preparedCasePlanSchema = z
  .object({
    id: z.string(),
    createdAt: z.number(),
    seed: z.number(),
    strategy: z.enum(["repeat", "zip", "cartesian", "pairwise"]),
    cases: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          index: z.number(),
          values: z.record(z.string(), z.string()),
          provenance: z.array(runCaseProvenanceSchema),
        })
        .strict(),
    ),
  })
  .strict();

const frozenRecipeInputReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectDataRevision: z.number().int().nonnegative(),
    seed: z.number().int(),
    values: z.record(z.string(), z.string()),
    sensitiveInputNames: z.array(z.string()),
    valuesDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    case: preparedCasePlanSchema.shape.cases.element.optional(),
  })
  .strict();

const combineEvidenceFindingSchema = z
  .object({
    id: z.string(),
    code: z.enum([
      "SCREEN_MISSING",
      "POSSIBLE_LOCALE_NOT_APPLIED",
      "CONTROL_MISSING",
      "POSSIBLE_UNTRANSLATED_TEXT",
      "POSSIBLE_TEXT_CLIPPED",
      "ACCOUNT_NEEDS_RELOGIN",
      "PRODUCT_ASSERTION",
      "HARNESS_FAILURE",
      "USER_CANCELLED",
      "BLOCKED",
      "VISUAL_CHANGED",
      "JUDGE_UNCERTAIN",
      "MANUAL_CHECKPOINT",
    ]),
    severity: z.enum(["critical", "warning"]),
    confidence: z.enum(["high", "medium"]),
    canonicalKey: z.string(),
    screenLabel: z.string(),
    locale: z.string(),
    baselineLocale: z.string(),
    stableKey: z.string().optional(),
    testId: z.string().min(1).optional(),
    expected: z.string().optional(),
    observed: z.string().optional(),
    detail: z.string(),
  })
  .strict();
const combineEvidenceAnalysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: z.string(),
    generatedAt: z.number(),
    baselineLocale: z.string(),
    findings: z.array(combineEvidenceFindingSchema),
    critical: z.number(),
    warnings: z.number(),
    affectedScreens: z.number(),
  })
  .strict();
const combineEvidencePackFrameSchema = z
  .object({
    path: z.string(),
    canonicalKey: z.string(),
    caption: z.string().optional(),
    inspected: z.boolean(),
  })
  .strict();
const combineEvidencePackManifestSchema = z
  .object({
    content: z
      .object({
        method: z.literal("ordered-nfc-text-v1"),
        inspectedPages: z.number().int().nonnegative(),
        uniquePages: z.number().int().nonnegative(),
        duplicateGroups: z.array(z.array(z.string())),
        pages: z.array(
          z
            .object({
              path: z.string(),
              jobId: z.string(),
              locale: z.string(),
              canonicalKey: z.string(),
              screenshotSha256: z.string().optional(),
              textSha256: z.string().optional(),
              text: z.string().optional(),
              textPath: z.string().optional(),
              accessibilityPath: z.string().optional(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
    schemaVersion: z.literal(2),
    batchId: z.string(),
    recipeId: z.string(),
    title: z.string(),
    generatedAt: z.number(),
    locales: z.array(z.string()),
    cases: z.array(
      z
        .object({
          locale: z.string(),
          jobId: z.string(),
          status: z.string(),
          name: z.string(),
          frames: z.array(z.string()),
          expectedFrames: z.number().optional(),
          captures: z.array(combineEvidencePackFrameSchema).optional(),
          note: z.string().optional(),
        })
        .strict(),
    ),
    byCanonicalKey: z.record(z.string(), z.record(z.string(), z.string())),
    analysis: combineEvidenceAnalysisSchema,
    analysisCoverage: z.object({ frames: z.number(), inspectedFrames: z.number() }).strict(),
  })
  .strict();
const modelDecisionAnswerSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("noul"),
      noul: z.number(),
    })
    .strict(),
  z
    .object({
      type: z.literal("choice"),
      choice: z.string(),
      probabilities: z.record(z.string(), z.number()),
      confidence: z.number(),
    })
    .strict(),
  z
    .object({
      type: z.literal("score"),
      score: z.number(),
      legend: z.record(z.string(), z.string()),
      probabilities: z.record(z.string(), z.number()),
      confidence: z.number(),
    })
    .strict(),
]);

const combineEvidenceAnalysisReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: z.string(),
    locales: z.array(z.string()),
    analysis: combineEvidenceAnalysisSchema,
    coverage: z.object({ frames: z.number(), inspectedFrames: z.number() }).strict(),
    jevTriage: z
      .object({
        schemaVersion: z.literal(1),
        status: z.enum(["suggested", "invalid", "unavailable"]),
        provider: z.literal("openrouter"),
        batchId: z.string(),
        findingIds: z.array(z.string()),
        rationale: z.string(),
        decision: z
          .object({
            schemaVersion: z.literal(1),
            status: z.enum(["ok", "invalid", "unavailable"]),
            provider: z.literal("openrouter"),
            model: z.string(),
            requestId: z.string(),
            observationDigest: z.string().optional(),
            questionDigest: z.string().optional(),
            answers: z.record(z.string(), modelDecisionAnswerSchema).optional(),
            usage: z
              .object({ inputTokens: z.number(), outputTokens: z.number() })
              .strict()
              .optional(),
            startedAt: z.number(),
            completedAt: z.number(),
            durationMs: z.number(),
            evidenceRefs: z.array(z.string()),
            error: z
              .object({
                code: z.enum(["provider-unavailable", "request-rejected", "invalid-response"]),
                message: z.string(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      })
      .strict()
      .optional(),
    cases: z.array(
      z
        .object({
          jobId: z.string(),
          locale: z.string(),
          status: z.string(),
          frames: z.array(
            z
              .object({
                framePath: z.string(),
                canonicalKey: z.string(),
                caption: z.string().optional(),
                inspected: z.boolean(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

const appMapCellStateSchema = z
  .object({
    cellId: z.string(),
    testId: z.string(),
    testName: z.string(),
    values: z.record(z.string(), z.string()),
    worldLabel: z.string(),
    targetProfileId: z.string().optional(),
    target: executionTargetSchema.optional(),
    binding: z.enum(["bound", "missing", "foreign", "duplicate", "extra", "mismatched"]),
    preflight: z.enum(["ready", "blocked"]).optional(),
    message: z.string().optional(),
  })
  .strict();

export const combineCampaignSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    projectId: z.string(),
    ownerId: z.string().optional(),
    appMapId: z.string(),
    combineId: z.string(),
    sourceRevision: z.number(),
    latestRevision: z.number(),
    target: z
      .object({
        kind: z.enum(["device", "browser"]),
        id: z.string(),
        platform: z.enum(["android", "ios", "browser"]),
      })
      .strict()
      .optional(),
    status: z.enum([
      "pilot-running",
      "ready-to-resume",
      "needs-review",
      "running",
      "completed",
      "completed-with-problems",
      "cancelled",
    ]),
    createdAt: z.number(),
    updatedAt: z.number(),
    cases: z.array(
      z
        .object({
          index: z.number(),
          cellId: z.string(),
          executionCaseId: z.string().optional(),
          testId: z.string(),
          world: z.string(),
          values: z.record(z.string(), z.string()),
          targetProfileId: z.string(),
          engine: z.enum(["chromium", "firefox", "webkit"]).optional(),
          account: z
            .discriminatedUnion("kind", [
              z
                .object({
                  kind: z.literal("fixture"),
                  accountId: z.string().trim().min(1),
                  accountRevision: z.string().trim().min(1),
                  reference: z.string().trim().min(1).optional(),
                })
                .strict(),
              z
                .object({
                  kind: z.literal("signed-out"),
                  attested: z.literal(true),
                })
                .strict(),
            ])
            .optional(),
          target: executionTargetSchema.optional(),
          plannedCaptures: z.array(captureReviewPlannedSlotSchema).optional(),
          childIntentDigest: z.string(),
          outerIntentDigest: z.string(),
          wrapperGraphDigest: z.string(),
          staticInputDigest: z.string(),
          frozenInputs: frozenRecipeInputReceiptSchema.optional(),
          phase: z.enum(["pilot", "coverage"]),
          status: z.enum([
            "pending",
            "queued",
            "running",
            "passed",
            "failed",
            "blocked",
            "cancelled",
          ]),
          jobId: z.string().optional(),
          runId: z.string().optional(),
          priorRunIds: z.array(z.string()).optional(),
          error: z.string().optional(),
          findingCode: z
            .enum([
              "SCREEN_MISSING",
              "POSSIBLE_LOCALE_NOT_APPLIED",
              "CONTROL_MISSING",
              "POSSIBLE_UNTRANSLATED_TEXT",
              "POSSIBLE_TEXT_CLIPPED",
              "ACCOUNT_NEEDS_RELOGIN",
              "PRODUCT_ASSERTION",
              "HARNESS_FAILURE",
              "USER_CANCELLED",
              "BLOCKED",
              "VISUAL_CHANGED",
              "JUDGE_UNCERTAIN",
              "MANUAL_CHECKPOINT",
            ])
            .optional(),
          failureCategory: z.string().optional(),
          outcome: z.string().optional(),
          assignee: z.string().optional(),
          triageStatus: z.enum(["unreviewed", "investigating", "resolved", "wont-fix"]).optional(),
        })
        .strict(),
    ),
    lineage: z.array(
      z
        .object({
          kind: z.enum(["created", "resumed", "cancelled", "triaged"]),
          at: z.number(),
          appMapRevision: z.number(),
          actorId: z.string().optional(),
          causalRepairProposalIds: z.array(z.string()).optional(),
          affectedCheckIds: z.array(z.string()).optional(),
          affectedCellIds: z.array(z.string()).optional(),
        })
        .strict(),
    ),
    execution: z
      .object({
        referenceReviewMode: z.enum(["human", "approved-reference"]).optional(),
        selected: z.record(z.string(), z.array(z.string())).optional(),
        selectedCellIds: z.array(z.string()),
        selectedExecutionCaseIds: z.array(z.string()).optional(),
        strategy: z.enum(["zip", "cartesian", "pairwise"]).optional(),
        seed: z.number(),
        title: z.string().optional(),
        laneId: z.string().trim().min(1).optional(),
        unsignedLaneId: z.string().trim().min(1).optional(),
        repeat: z
          .object({
            schemaVersion: z.literal(1),
            requestedAppMapRevision: z.number().int().nonnegative(),
            executionAppMapRevision: z.number().int().nonnegative(),
            testId: z.string(),
            testPlanDigest: z.string(),
            rootRecipeId: z.string(),
            target: z.discriminatedUnion("kind", [
              z
                .object({
                  kind: z.literal("device"),
                  platform: z.enum(["android", "ios"]),
                  targetId: z.string(),
                })
                .strict(),
              z
                .object({
                  kind: z.literal("browser"),
                  platform: z.literal("browser"),
                  targetId: z.string(),
                })
                .strict(),
            ]),
            spec: repeatSpecSchema,
            resolved: z
              .object({
                dimensions: z.array(
                  z.object({ id: z.string(), valueIds: z.array(z.string()).min(1) }).strict(),
                ),
                strategy: z.enum(["cartesian", "zip", "pairwise"]),
                pilot: repeatPilotSpecSchema,
                resume: z.enum(["untouched", "failed", "all"]),
              })
              .strict(),
            evidence: z.enum(["visual", "smoke"]),
            sourceRevision: sourceRevisionSchema.optional(),
            capture: z
              .object({ fullSurfaceScreenIds: z.array(z.string()) })
              .strict()
              .optional(),
            pilotJobId: z.string(),
            selectedCaseIds: z.array(z.string()),
            workflowMutation: repeatWorkflowMutationSchema.optional(),
          })
          .strict()
          .optional(),
        localAdmission: combineCampaignAdmissionSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const campaignDeadlineSchema = z
  .object({ achievableWithCurrentCapacity: z.boolean() })
  .passthrough();
const campaignPlanSchema = z
  .object({
    platforms: z.array(
      z
        .object({
          platform: z.enum(["android", "ios"]),
          scheduledSlots: z.number(),
          budget: z
            .object({ requiredIndependentTargetSlots: z.number().nullable() })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const campaignPreflightSchema = z
  .object({
    checkedAt: z.number(),
    deadline: campaignDeadlineSchema,
    plan: campaignPlanSchema,
  })
  .passthrough();
const targetPreflightSchema = z
  .object({ checkedAt: z.number(), deadline: campaignDeadlineSchema })
  .passthrough();

const admissionSchema = z
  .object({
    preflight: campaignPreflightSchema,
    targetPreflights: z.array(targetPreflightSchema),
  })
  .strict();
const _localeBatchSchema = z
  .object({
    id: z.string(),
    recipeId: z.string(),
    composedRecipeId: z.string(),
    title: z.string(),
    locales: z.array(z.string()),
    createdAt: z.number(),
  })
  .strict();
const combineBatchSchema = z
  .object({
    id: z.string(),
    recipeId: z.string(),
    composedRecipeId: z.string(),
    title: z.string(),
    worlds: z.array(z.string()),
    createdAt: z.number(),
  })
  .strict();

const matrixExpansionSchema = z
  .object({
    matrixId: z.string(),
    matrixName: z.string(),
    resolvedAt: z.number(),
    profiles: z.array(targetProfileSchema),
    excluded: z.array(z.object({ profile: targetProfileSchema, reason: z.string() }).strict()),
  })
  .strict();

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
  })
  .strict();

/** Runtime response contracts for case plans, Combines, jobs, and Run maintenance. */
export const executionOperationOutputSchemas = {
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
