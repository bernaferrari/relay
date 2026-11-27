import * as z from "zod/v4";
import { workflowRecordOperationOutputSchemas } from "./workflow/workflow-record-operation-schemas.js";
import { workspaceChangeContextSchema } from "./workspace/workspace-change-context.js";
import {
  scrollSurveyOutputSchema,
  targetHealthOutputSchema,
  targetInputReceiptOutputSchema,
  targetInputReconcileOutputSchema,
  targetObservationOutputSchema,
  targetRecoveryOutputSchema,
  targetRuntimeReadinessOutputSchema,
  targetScreenshotOutputSchema,
  targetSnapshotOutputSchema,
  iosSessionOperationLifecycleOutputSchema,
} from "./target/target-output-schemas.js";
import { authoringEvidenceSchema } from "./authoring/authoring-session-schema.js";

export const executionJobOutputSchema = z
  .object({
    id: z.string().min(1),
    action: z.string().min(1),
    status: z.string().min(1),
    queuedAt: z.number(),
    startedAt: z.number().optional(),
    finishedAt: z.number().optional(),
    error: z.string().optional(),
    runId: z.string().optional(),
    batchId: z.string().optional(),
  })
  .passthrough();

const persistedRun = executionJobOutputSchema.extend({
  writtenAt: z.number().optional(),
  artifacts: z.array(z.unknown()).optional(),
  evidence: z.unknown().optional(),
});

const iosVisualVerificationFailureSchema = z
  .object({
    stage: z.enum(["before-capture", "action", "after-capture", "fingerprint"]),
    message: z.string(),
    at: z.number(),
  })
  .strict();
const iosVisualVerificationCaptureSchema = z
  .object({
    capturedAt: z.number(),
    fingerprint: z.string().optional(),
    evidence: authoringEvidenceSchema.optional(),
  })
  .strict();
const iosVisualVerificationTimingSchema = z
  .object({
    startedAt: z.number(),
    finishedAt: z.number(),
    settleMs: z.number(),
    beforeCapturedAt: z.number().optional(),
    actionStartedAt: z.number().optional(),
    actionFinishedAt: z.number().optional(),
    afterCapturedAt: z.number().optional(),
  })
  .strict();
const iosVisualVerificationSchema = z
  .object({
    serial: z.string(),
    timing: iosVisualVerificationTimingSchema,
    outcome: z.enum(["changed", "unchanged", "incomplete"]),
    failure: iosVisualVerificationFailureSchema.optional(),
    failures: z.array(iosVisualVerificationFailureSchema).optional(),
    before: iosVisualVerificationCaptureSchema.optional(),
    after: iosVisualVerificationCaptureSchema.optional(),
    repair: z
      .object({
        schemaVersion: z.literal(1),
        kind: z.literal("ios-visual-transition"),
        serial: z.string(),
        interaction: z
          .object({
            id: z.string(),
            label: z.string(),
            input: z.record(z.string(), z.unknown()),
          })
          .strict(),
        timing: iosVisualVerificationTimingSchema,
        outcome: z.enum(["changed", "unchanged", "incomplete"]),
        failure: iosVisualVerificationFailureSchema.optional(),
        failures: z.array(iosVisualVerificationFailureSchema).optional(),
        before: iosVisualVerificationCaptureSchema.optional(),
        after: iosVisualVerificationCaptureSchema.optional(),
        manifest: authoringEvidenceSchema,
      })
      .strict()
      .optional(),
    repairError: z.string().optional(),
    cleanupErrors: z.array(z.string()).optional(),
  })
  .strict();

const deviceLeaseOutputSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1).optional(),
    projectId: z.string().min(1),
    poolId: z.string().min(1),
    deviceSerial: z.string().min(1),
    ownerId: z.string().min(1),
    controlScope: z.enum(["actor", "local-project"]).optional(),
    status: z.enum(["leased", "released", "expired"]),
    leasedAt: z.number(),
    expiresAt: z.number(),
    releasedAt: z.number().optional(),
    handoffFromLeaseId: z.string().optional(),
    handoffReason: z.string().optional(),
  })
  .strict();

const actionSummaryOutputSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    category: z.string().min(1),
    requiresProdMatch: z.boolean().optional(),
    isAlpha: z.boolean().optional(),
    glyphs: z.array(z.string()).optional(),
    planned: z
      .array(z.object({ title: z.string(), glyphs: z.array(z.string()) }).strict())
      .optional(),
  })
  .strict();

const activityNonNegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .refine((value) => Number.isSafeInteger(value));
const activityRecordOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    organizationId: z.string().min(1),
    projectId: z.string().min(1),
    activityId: z.string().min(1),
    actorId: z.string().min(1),
    actorKind: z.enum(["human", "agent", "system"]),
    operationId: z.string().min(1),
    requestId: z.string().min(1),
    timestamp: activityNonNegativeIntegerSchema,
    eventType: z.string().min(1),
    resourceKind: z.string().min(1),
    resourceId: z.string().min(1),
    summary: z.string().min(1),
    correlationId: z.string().min(1).optional(),
    causationId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    leaseId: z.string().min(1).optional(),
    beforeRevision: activityNonNegativeIntegerSchema.optional(),
    afterRevision: activityNonNegativeIntegerSchema.optional(),
    evidenceIds: z.array(z.string().min(1)).optional(),
    outcome: z.enum(["succeeded", "failed", "cancelled"]).optional(),
    durationMs: activityNonNegativeIntegerSchema.optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    errorCode: z.string().min(1).optional(),
  })
  .strict();
const activityExportOutputSchema = z
  .object({
    export: z
      .object({
        manifest: z
          .object({
            schemaVersion: z.literal(1),
            generatedAt: activityNonNegativeIntegerSchema,
            organizationId: z.string().min(1),
            projectId: z.string().min(1),
            recordCount: activityNonNegativeIntegerSchema,
            firstTimestamp: activityNonNegativeIntegerSchema.optional(),
            lastTimestamp: activityNonNegativeIntegerSchema.optional(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .strict(),
        records: z.array(activityRecordOutputSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const exported = value.export;
    if (exported.manifest.recordCount !== exported.records.length) {
      context.addIssue({
        code: "custom",
        message: "recordCount must match records",
        path: ["export", "manifest", "recordCount"],
      });
    }
    for (const [index, record] of exported.records.entries()) {
      if (
        record.organizationId !== exported.manifest.organizationId ||
        record.projectId !== exported.manifest.projectId
      ) {
        context.addIssue({
          code: "custom",
          message: "record scope must match export manifest",
          path: ["export", "records", index],
        });
      }
    }
  });

const generationUsageOutputSchema = z
  .object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
    costUsd: z.number().optional(),
  })
  .strict();
const generationResultOutputSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    values: z.array(z.string()),
    generatedAt: z.number(),
    usage: generationUsageOutputSchema.optional(),
    provenance: z
      .object({
        requestId: z.string().min(1),
        purpose: z.enum(["variable", "test-plan"]),
        promptDigest: z.string().min(1),
        startedAt: z.number(),
        completedAt: z.number(),
        durationMs: z.number(),
        seed: z.number().optional(),
        usage: generationUsageOutputSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const deviceSummaryOutputSchema = z
  .object({
    id: z.string().min(1),
    serial: z.string().min(1),
    name: z.string().min(1),
    kind: z.string().nullable(),
    booted: z.boolean().nullable(),
    platform: z.enum(["android", "ios", "browser"]),
    targetKind: z.enum(["device", "browser"]).optional(),
    connectionState: z.string().optional(),
    osVersion: z.string().optional(),
    viewport: z
      .object({ width: z.number().int().positive(), height: z.number().int().positive() })
      .strict()
      .optional(),
    avdName: z.string().optional(),
    developerMode: z.enum(["enabled", "disabled"]).optional(),
    developerServicesAvailable: z.boolean().optional(),
    readiness: targetRuntimeReadinessOutputSchema.optional(),
  })
  .strict();

const runtimePreflightCheckOutputSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["pass", "warning", "fail"]),
    message: z.string(),
  })
  .strict();
const devicePoolPreflightOutputSchema = z
  .object({
    poolId: z.string().min(1),
    ok: z.boolean(),
    checkedAt: z.number(),
    capacity: z
      .object({
        configured: z.number(),
        connected: z.number(),
        available: z.number(),
        leased: z.number(),
      })
      .strict(),
    targets: z.array(
      z
        .object({
          serial: z.string().min(1),
          connected: z.boolean(),
          platform: z.enum(["android", "ios"]).optional(),
          name: z.string().optional(),
          lease: z.enum(["available", "leased"]),
          leaseOwnerId: z.string().optional(),
          leaseExpiresAt: z.number().optional(),
        })
        .strict(),
    ),
    checks: z.array(runtimePreflightCheckOutputSchema),
  })
  .strict();
const registeredBuildPreflightOutputSchema = z
  .object({
    buildId: z.string().min(1),
    ok: z.boolean(),
    checkedAt: z.number(),
    artifact: z
      .object({
        path: z.string().min(1),
        kind: z.enum(["apk", "app"]),
        bytes: z.number().optional(),
      })
      .strict()
      .optional(),
    applicationId: z.string().optional(),
    capabilities: z.object({ install: z.boolean(), launch: z.boolean() }).strict(),
    checks: z.array(runtimePreflightCheckOutputSchema),
  })
  .strict();

const installedBuildOutputSchema = z
  .object({
    installed: z.literal(true),
    applicationId: z.string().optional(),
    artifactPath: z.string().min(1),
  })
  .strict();
const launchedBuildOutputSchema = z
  .object({ launched: z.literal(true), applicationId: z.string().min(1) })
  .strict();

const webBuildProviderReceiptOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    issuer: z.literal("relay-web-deployment-provider"),
    provider: z.string().min(1),
    deploymentId: z.string().min(1),
    sourceUrl: z.string().min(1),
    sourceSha: z.string().min(1),
    deploymentDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    configuration: z.string().min(1),
    environmentRevision: z.string().min(1),
    issuedAt: z.number(),
    signature: z.string().min(1),
  })
  .strict();

const buildOutputSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string().min(1),
    platform: z.enum(["android", "ios", "web"]),
    sourceUrl: z.string().optional(),
    sourceSha256: z.string().optional(),
    sourceSha: z.string().optional(),
    configuration: z.string().optional(),
    environmentRevision: z.string().optional(),
    applicationId: z.string().optional(),
    deploymentDigest: z.string().optional(),
    webDeploymentMode: z.enum(["provider-verified", "self-managed"]).optional(),
    webProviderReceipt: webBuildProviderReceiptOutputSchema.optional(),
    status: z.enum(["uploaded", "ready", "failed", "archived"]),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();

const redactionPolicyOutputSchema = z
  .object({
    enabled: z.boolean(),
    source: z.enum(["default", "workspace", "environment"]),
    locked: z.boolean(),
    updatedAt: z.number().optional(),
  })
  .strict();
const sensitiveGrantOutputSchema = z
  .object({ grantedAt: z.number(), grantedBy: z.string().min(1), reason: z.string() })
  .strict();
const evidencePolicyOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(["lightweight", "full"]).optional(),
    sensitive: z
      .object({
        audio: sensitiveGrantOutputSchema.optional(),
        crash: sensitiveGrantOutputSchema.optional(),
        "network-body": sensitiveGrantOutputSchema.optional(),
        "network-raw": sensitiveGrantOutputSchema.optional(),
        "browser-trace": sensitiveGrantOutputSchema.optional(),
      })
      .strict(),
    redaction: redactionPolicyOutputSchema.optional(),
    updatedAt: z.number().optional(),
  })
  .strict();

const targetAppLaunchOutputSchema = z
  .object({
    launched: z
      .object({
        serial: z.string().min(1),
        app: z.string().min(1),
        platform: z.enum(["android", "ios", "browser"]),
        launchedAt: z.number(),
      })
      .strict(),
    observed: z
      .object({
        app: z.string().optional(),
        matched: z.boolean(),
        coveredBy: z.string().optional(),
      })
      .strict(),
  })
  .strict();

const appLocalesOutputSchema = z
  .object({
    packageName: z.string().min(1),
    locales: z.array(z.string()),
    currentLocale: z.string().optional(),
    source: z.enum(["android-locale-manager", "android-device-locale"]).optional(),
  })
  .strict();

const appLocaleSetOutputSchema = z
  .object({
    packageName: z.string().min(1),
    locale: z.string().min(1),
    observedLocale: z.string().optional(),
  })
  .strict();

const installedAppOutputSchema = z
  .object({ package: z.string().min(1), name: z.string() })
  .strict();

const jobListEntryOutputSchema = z
  .object({
    id: z.string().min(1),
    action: z.string().min(1),
    status: z.string().min(1),
    queuedAt: z.number(),
    frameCount: z.number(),
  })
  .passthrough();

const testDataOutputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    scope: z.enum(["shared", "private"]),
    source: z.enum(["static", "list", "generated"]),
    fallback: z.string().optional(),
    prompt: z.string().optional(),
    values: z.array(z.string()).optional(),
    sensitive: z.boolean().optional(),
  })
  .strict();

const revisionedTestDataOutputSchema = z
  .object({
    revision: z.number(),
    value: z.array(testDataOutputSchema),
    updatedAt: z.number(),
    updatedBy: z.string().optional(),
  })
  .strict();

const projectOutputSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    name: z.string().min(1),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();

const devicePoolOutputSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    name: z.string().min(1),
    platform: z.enum(["android", "ios", "mixed"]),
    deviceSerials: z.array(z.string()),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();

const targetWorkerOutputSchema = z
  .object({
    workerId: z.string().min(1),
    capacity: z.number(),
    active: z.number(),
    queued: z.number(),
    activeTargets: z.array(z.string()),
    queuedTargets: z.array(z.string()),
    host: z
      .object({
        workerId: z.string().min(1),
        capacity: z.number(),
        active: z.number(),
        queued: z.number(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Output contracts for exact core operations that do not own a custom parser. */
const stepRunOutputSchema = z
  .object({
    ok: z.boolean(),
    durationMs: z.number(),
    logs: z.array(z.string()),
    error: z.string().min(1).optional(),
    terminal: z.literal("review-needed").optional(),
    code: z.literal("IOS_MUTATION_OUTCOME_UNKNOWN").optional(),
    iosMutation: z
      .object({
        sequence: z.number(),
        operation: z.string().min(1),
        nativeAttempts: z.literal(1),
        outcome: z.literal("outcome-unknown"),
        retry: z
          .object({
            attempts: z.literal(0),
            decision: z.literal("blocked"),
            reason: z.literal("native-command-outcome-unknown"),
          })
          .strict(),
        intervention: z
          .object({
            required: z.literal(true),
            action: z.literal("capture-current-screen-before-any-retry"),
          })
          .strict(),
        cancellation: z
          .object({ observedAfterAttemptStarted: z.literal(true) })
          .strict()
          .optional(),
        at: z.number(),
      })
      .strict()
      .optional(),
    iosSessionLifecycle: iosSessionOperationLifecycleOutputSchema.optional(),
    iosVisualVerification: iosVisualVerificationSchema.optional(),
    stepReview: z
      .object({
        captureCurrent: z
          .object({
            operationId: z.literal("target.screenshot.capture"),
            input: z.object({ serial: z.string().min(1) }).strict(),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((result, context) => {
    const fail = (message: string, ...path: string[]) =>
      context.addIssue({ code: "custom", message, path });
    if (result.ok === true) {
      for (const key of ["error", "terminal", "code", "iosMutation", "stepReview"] as const) {
        if (result[key] !== undefined) {
          fail(`${key} is only valid on failure`, key);
        }
      }
      return;
    }
    if (result.error === undefined) {
      fail("error is required on failure", "error");
    }
    if (result.code === undefined) {
      for (const key of ["terminal", "iosMutation", "stepReview"] as const) {
        if (result[key] !== undefined) {
          fail(`${key} is only valid for an unknown iOS mutation outcome`, key);
        }
      }
      return;
    }
    if (result.terminal !== "review-needed") {
      fail("terminal must be review-needed for an unknown iOS outcome", "terminal");
    }
    if (result.iosMutation === undefined) {
      fail("iosMutation is required for an unknown iOS outcome", "iosMutation");
    }
    if (result.stepReview === undefined) {
      fail("stepReview is required for an unknown iOS outcome", "stepReview");
    }
  });

export const coreOperationOutputSchemas = {
  "project.list": z.object({ projects: z.array(projectOutputSchema) }).strict(),
  "project.save": z.object({ project: projectOutputSchema }).strict(),
  "device-pool.list": z.object({ pools: z.array(devicePoolOutputSchema) }).strict(),
  "device-pool.save": z.object({ pool: devicePoolOutputSchema }).strict(),
  "target-worker.list": z.object({ workers: z.array(targetWorkerOutputSchema) }).strict(),
  "system.health.get": z
    .object({
      ok: z.boolean(),
      product: z.string().min(1),
      version: z.string().min(1),
      mode: z.string().min(1),
      at: z.number(),
      uptimeMs: z.number(),
      pid: z.number(),
      startedAt: z.number(),
      activeJob: z
        .object({
          id: z.string().min(1),
          action: z.string().min(1),
          status: z.string().min(1),
          serial: z.string().nullable(),
          deviceName: z.string().nullable(),
          startedAt: z.number().nullable(),
        })
        .strict()
        .nullable(),
      activeJobs: z.array(
        z
          .object({
            id: z.string(),
            status: z.string(),
            targetId: z.string().optional(),
            workerId: z.string().optional(),
          })
          .strict(),
      ),
      targetWorkers: z.array(
        z
          .object({
            workerId: z.string(),
            capacity: z.number(),
            active: z.number(),
            queued: z.number(),
            activeTargets: z.array(z.string()),
            queuedTargets: z.array(z.string()),
            host: z
              .object({
                workerId: z.string(),
                capacity: z.number(),
                active: z.number(),
                queued: z.number(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      ),
      jobs: z.number(),
      deviceCount: z.number().nullable(),
      sseClients: z.number(),
      runsDir: z.string(),
      access: z
        .object({
          role: z.enum(["viewer", "author", "runner", "admin"]),
          organizationId: z.string().min(1),
          projectId: z.string().min(1),
        })
        .strict()
        .optional(),
    })
    .strict(),
  "build.list": z.object({ builds: z.array(buildOutputSchema) }).strict(),
  "build.save": z.object({ build: buildOutputSchema }).strict(),
  "build.preflight": z.object({ preflight: registeredBuildPreflightOutputSchema }).strict(),
  "device-pool.preflight": z.object({ preflight: devicePoolPreflightOutputSchema }).strict(),
  "build.install": z
    .object({
      installed: installedBuildOutputSchema,
      launched: launchedBuildOutputSchema.optional(),
    })
    .strict(),
  "build.launch": z.object({ launched: launchedBuildOutputSchema }).strict(),
  "workspace.privacy.get": z.object({ policy: redactionPolicyOutputSchema }).strict(),
  "workspace.privacy.update": z.object({ policy: redactionPolicyOutputSchema }).strict(),
  "workspace.evidence.get": z.object({ policy: evidencePolicyOutputSchema }).strict(),
  "workspace.evidence.update": z.object({ policy: evidencePolicyOutputSchema }).strict(),
  "activity.export": activityExportOutputSchema,
  "generation.create": generationResultOutputSchema,
  "target.actions.list": z.object({ actions: z.array(actionSummaryOutputSchema) }).strict(),
  "target.devices.list": z.object({ devices: z.array(deviceSummaryOutputSchema) }).strict(),
  "target.health.get": targetHealthOutputSchema,
  "target.observation.capture": targetObservationOutputSchema,
  "target.screenshot.capture": targetScreenshotOutputSchema,
  "target.snapshot.capture": targetSnapshotOutputSchema,
  "target.scroll-survey.capture": scrollSurveyOutputSchema,
  "target.recover": targetRecoveryOutputSchema,
  "step.run": stepRunOutputSchema,
  "target.input.reconcile": targetInputReconcileOutputSchema,
  "target.input.receipt.get": targetInputReceiptOutputSchema,
  "target.app.list": z.object({ apps: z.array(installedAppOutputSchema) }).strict(),
  "target.app.launch": targetAppLaunchOutputSchema,
  "target.app.locales": appLocalesOutputSchema,
  "target.app.locale.set": appLocaleSetOutputSchema,
  "job.list": z
    .object({
      jobs: z.array(jobListEntryOutputSchema),
      active: jobListEntryOutputSchema.nullable().optional(),
      activeJobs: z.array(jobListEntryOutputSchema),
    })
    .strict(),
  "lease.list": z.object({ leases: z.array(deviceLeaseOutputSchema) }).strict(),
  "lease.create": z.object({ lease: deviceLeaseOutputSchema }).strict(),
  "lease.takeover": z.object({ lease: deviceLeaseOutputSchema }).strict(),
  "lease.release": z.object({ lease: deviceLeaseOutputSchema }).strict(),
  "workspace.variables.get": revisionedTestDataOutputSchema,
  "workspace.variables.update": revisionedTestDataOutputSchema,
  ...workflowRecordOperationOutputSchemas,
  "workspace.change.inspect": z.object({ change: workspaceChangeContextSchema }).strict(),
  "event.stream": z
    .object({
      schemaVersion: z.literal(1),
      eventId: z.string().min(1),
      cursor: z.number().int().nonnegative(),
      eventType: z.string().min(1),
      timestamp: z.number(),
      payload: z.unknown(),
    })
    .passthrough(),
  "job.get": z.object({ job: executionJobOutputSchema }).strict(),
  "job.start": z.object({ job: executionJobOutputSchema }).strict(),
  "job.cancel": z.object({ job: executionJobOutputSchema }).strict(),
  "job.pause": z.object({ job: executionJobOutputSchema }).strict(),
  "job.resume": z.object({ job: executionJobOutputSchema }).strict(),
  "run.get": z.object({ run: persistedRun }).strict(),
  "run.evidence.get": z
    .object({
      evidence: z
        .object({
          runId: z.string().optional(),
          events: z.array(z.unknown()).optional(),
          channels: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough(),
    })
    .strict(),
  "run.story.get": z
    .object({
      story: z
        .object({
          runId: z.string().optional(),
          title: z.string().optional(),
          steps: z.array(z.unknown()).optional(),
          frames: z.array(z.unknown()).optional(),
        })
        .passthrough(),
    })
    .strict(),
  "target.ui.describe": z
    .object({
      summary: z.string(),
      platform: z.string().optional(),
      serial: z.string().optional(),
      foregroundApp: z.string().optional(),
      titles: z.array(z.string()),
      sheetLikely: z.boolean(),
      keyboardLikely: z.boolean(),
      topLabels: z.array(z.string()),
      coordinateSpace: z.literal("logical-points"),
      bounds: z.object({ width: z.number(), height: z.number() }).strict().optional(),
      nodeCount: z.number(),
      treePreview: z.string(),
    })
    .strict(),
  "target.ui.back": z
    .object({ method: z.enum(["back", "parent", "close", "key", "edge-swipe"]) })
    .strict(),
  "target.ui.scrollCollect": z
    .object({
      controls: z.array(
        z
          .object({
            label: z.string(),
            role: z.string().optional(),
            target: z
              .object({
                identifier: z.string().optional(),
                ref: z.string().optional(),
                label: z.string().optional(),
                text: z.string().optional(),
              })
              .strict(),
          })
          .strict(),
      ),
      count: z.number(),
    })
    .strict(),
} as const satisfies Readonly<Record<string, z.ZodType>>;

/**
 * One review-only screen-matching suggestion from destination repair.
 * Mirrors core's RepairProposal writer; nothing here mutates an App Map.
 */
export const destinationRepairProposalSchema = z.object({
  candidateScreenId: z.string().min(1),
  /** 0..1 explainable match confidence; proposals arrive sorted descending. */
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  method: z.enum(["fingerprint", "semantic", "vision"]),
});

/**
 * Data payload of the `destination-repair-proposals` run artifact written
 * after a failed step. An unavailable grounder degrades to an explicit
 * zero-proposal result instead of pretending to ground pixels.
 */
export const destinationRepairProposalsArtifactDataSchema = z.discriminatedUnion("available", [
  z.object({
    available: z.literal(true),
    proposals: z.array(destinationRepairProposalSchema),
  }),
  z.object({
    available: z.literal(false),
    proposals: z.tuple([]),
    reason: z.literal("grounding-unavailable"),
  }),
]);

export type DestinationRepairProposalsArtifactData = z.output<
  typeof destinationRepairProposalsArtifactDataSchema
>;

export {
  iosSessionOperationLifecycleOutputSchema,
  screenIdentityObservationOutputSchema,
  semanticNodeOutputSchema,
} from "./target/target-output-schemas.js";
