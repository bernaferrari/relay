import * as z from "zod/v4";
import { combineCampaignAdmissionSchema } from "./campaign-capacity-operation-output-schemas.js";

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
    osVersion: z.string().optional(),
    viewport: z.object({ width: z.number(), height: z.number() }).strict().optional(),
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
    id: z.string(),
    action: z.string(),
    title: z.string().optional(),
    status: z.string(),
    queuedAt: z.number(),
    startedAt: z.number().optional(),
    finishedAt: z.number().optional(),
    durationMs: z.number().optional(),
    platform: z.string().optional(),
    serial: z.string().optional(),
    outcome: z.string().optional(),
    review: runReviewSchema.optional(),
    batchId: z.string().optional(),
    caseIndex: z.number().optional(),
    caseCount: z.number().optional(),
    matrixCase: z
      .object({
        kind: z.literal("combine"),
        appMapId: z.string().optional(),
        combineId: z.string().optional(),
        world: z.string(),
        values: z.record(z.string(), z.string()),
        expectedScreenshots: z.number().optional(),
      })
      .strict()
      .optional(),
    frameCount: z.number(),
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

const combineEvidenceFindingSchema = z
  .object({
    id: z.string(),
    code: z.enum([
      "SCREEN_MISSING",
      "POSSIBLE_LOCALE_NOT_APPLIED",
      "CONTROL_MISSING",
      "POSSIBLE_UNTRANSLATED_TEXT",
      "POSSIBLE_TEXT_CLIPPED",
    ]),
    severity: z.enum(["critical", "warning"]),
    confidence: z.enum(["high", "medium"]),
    canonicalKey: z.string(),
    screenLabel: z.string(),
    locale: z.string(),
    baselineLocale: z.string(),
    stableKey: z.string().optional(),
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
const localePackFrameSchema = z
  .object({
    path: z.string(),
    canonicalKey: z.string(),
    caption: z.string().optional(),
    inspected: z.boolean(),
  })
  .strict();
const localePackManifestSchema = z
  .object({
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
          captures: z.array(localePackFrameSchema).optional(),
        })
        .strict(),
    ),
    byCanonicalKey: z.record(z.string(), z.record(z.string(), z.string())),
    analysis: combineEvidenceAnalysisSchema,
    analysisCoverage: z.object({ frames: z.number(), inspectedFrames: z.number() }).strict(),
  })
  .strict();
const localeAnalysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: z.string(),
    locales: z.array(z.string()),
    analysis: combineEvidenceAnalysisSchema,
    coverage: z.object({ frames: z.number(), inspectedFrames: z.number() }).strict(),
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

const variableNavStepSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tap"),
      target: z
        .object({
          identifier: z.string().optional(),
          label: z.string().optional(),
          text: z.string().optional(),
        })
        .strict(),
      fallbackTargets: z
        .array(
          z
            .object({
              identifier: z.string().optional(),
              label: z.string().optional(),
              text: z.string().optional(),
            })
            .strict(),
        )
        .optional(),
    })
    .strict(),
  z.object({ kind: z.literal("back") }).strict(),
  z.object({ kind: z.literal("wait"), ms: z.number() }).strict(),
  z
    .object({
      kind: z.literal("scroll"),
      direction: z.enum(["up", "down"]),
      amount: z.number().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("relaunch") }).strict(),
  z
    .object({ kind: z.literal("openApp"), app: z.string(), relaunch: z.boolean().optional() })
    .strict(),
]);
const optionTargetSchema = z
  .object({
    label: z.string().optional(),
    identifier: z.string().optional(),
    text: z.string().optional(),
  })
  .strict();
const localeScopeSchema = z
  .object({
    locales: z.array(z.string()),
    app: z.string().optional(),
    appLocale: z.string().optional(),
    relaunch: z.boolean().optional(),
    entryPath: z.array(variableNavStepSchema).optional(),
    languagePath: z.array(variableNavStepSchema).optional(),
    exitPath: z.array(variableNavStepSchema).optional(),
    languageOptions: z.record(z.string(), z.union([z.string(), optionTargetSchema])).optional(),
    restoreLocale: z.string().optional(),
    restoreAfterEach: z.boolean().optional(),
    restoreAtEnd: z.boolean().optional(),
    screenshotEachLocale: z.boolean().optional(),
  })
  .strict();
const inferredLocaleSchema = z
  .object({
    options: z.array(
      z
        .object({
          locale: z.string(),
          identifier: z.string().optional(),
          label: z.string().optional(),
          text: z.string().optional(),
        })
        .strict(),
    ),
    languageOptions: z.record(z.string(), optionTargetSchema),
    locales: z.array(z.string()),
  })
  .strict();

const localeMaterializationScopeSchema = z
  .object({
    locales: z.array(z.string()),
    app: z.string().optional(),
    appLocale: z.string().optional(),
    relaunch: z.boolean().optional(),
    entryPath: z.array(z.unknown()).optional(),
    languagePath: z.array(z.unknown()).optional(),
    exitPath: z.array(z.unknown()).optional(),
    languageOptions: z.record(z.string(), z.union([z.string(), optionTargetSchema])).optional(),
    restoreLocale: z.string().optional(),
    restoreAfterEach: z.boolean().optional(),
    restoreAtEnd: z.boolean().optional(),
    screenshotEachLocale: z.boolean().optional(),
  })
  .strict();
const localeMaterializationSchema = z
  .object({
    schemaVersion: z.literal(1),
    materializedAt: z.number(),
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("recipe"), recipeId: z.string() }).strict(),
      z
        .object({
          kind: z.literal("app-map-flow"),
          appMapId: z.string(),
          flowId: z.string(),
          appMapRevision: z.number(),
          recipeId: z.string(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("app-map-test"),
          appMapId: z.string(),
          testId: z.string(),
          variableId: z.string(),
          appMapRevision: z.number(),
          recipeId: z.string(),
        })
        .strict(),
    ]),
    scope: localeMaterializationScopeSchema,
    cases: z.array(z.object({ caseIndex: z.number(), locale: z.string() }).strict()),
    durationCohort: z.object({ testId: z.string(), action: z.string() }).strict(),
    targetPlatform: z.enum(["ios", "android"]).optional(),
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
          testId: z.string(),
          world: z.string(),
          values: z.record(z.string(), z.string()),
          targetProfileId: z.string(),
          target: executionTargetSchema.optional(),
          childIntentDigest: z.string(),
          outerIntentDigest: z.string(),
          wrapperGraphDigest: z.string(),
          staticInputDigest: z.string(),
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
          error: z.string().optional(),
        })
        .strict(),
    ),
    lineage: z.array(
      z
        .object({
          kind: z.enum(["created", "resumed", "cancelled"]),
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
        selected: z.record(z.string(), z.array(z.string())).optional(),
        selectedCellIds: z.array(z.string()),
        strategy: z.enum(["zip", "cartesian", "pairwise"]).optional(),
        seed: z.number(),
        title: z.string().optional(),
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
const localeBatchSchema = z
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
    storageBytes: z.number(),
    pinned: z.boolean(),
    retentionClass: z.enum(["standard", "protected"]),
  })
  .strict();

const variableSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum([
      "language",
      "location",
      "account",
      "theme",
      "workspace",
      "build",
      "toggle",
      "custom",
    ]),
    apply: z
      .object({
        kind: z.enum(["list", "toggle"]),
        inConnectionId: z.string().optional(),
        outConnectionId: z.string().optional(),
        listScreenId: z.string().optional(),
        entryPath: z.array(variableNavStepSchema).optional(),
        pickerPath: z.array(variableNavStepSchema).optional(),
      })
      .strict(),
    options: z.array(
      z
        .object({
          id: z.string(),
          identifier: z.string().optional(),
          label: z.string().optional(),
          text: z.string().optional(),
        })
        .strict(),
    ),
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
      manifest: localePackManifestSchema,
      jobIds: z.array(z.string()),
    })
    .strict(),
  "job.combine.analysis": localeAnalysisSchema,
  "job.combine.campaign.get": z.object({ campaign: combineCampaignSchema }).strict(),
  "job.combine.campaign.resume": z
    .object({
      campaign: combineCampaignSchema,
      jobs: z.array(jobSummarySchema),
      cells: z.array(appMapCellStateSchema),
      admission: admissionSchema.optional(),
    })
    .strict(),
  "job.combine.campaign.cancel": z.object({ campaign: combineCampaignSchema }).strict(),
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
