import * as z from "zod/v4";
import { stepTargetSchema, recipeStepSchema } from "../recipe/recipe-step-schema.js";
import type { AuthoringSession } from "./authoring.js";
import {
  browserDeviceInputResolutionSchema,
  browserDeviceInputResolutionShape,
} from "../browser/browser-device.js";
import {
  recordedEntranceProfileSchema,
  recordedEntranceRequestSchema,
} from "../recorded-entrance.js";

const stringRecord = z.record(z.string(), z.unknown());

export const authoringTargetSchema = z.union([
  z
    .object({
      kind: z.literal("device"),
      platform: z.enum(["android", "ios"]),
      targetId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("browser"),
      platform: z.literal("browser"),
      targetId: z.string().min(1),
      authenticationFixtureId: z.string().optional(),
      liveSessionId: z.string().optional(),
    })
    .strict(),
]);

export const authoringEvidenceSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["screenshot", "snapshot", "video"]),
    capturedAt: z.number(),
    uri: z.string().min(1),
    mime: z.string().optional(),
    bytes: z.number().optional(),
    sha256: z.string().optional(),
    startMs: z.number().optional(),
    endMs: z.number().optional(),
  })
  .strict();

export const authoringCaptureProvenanceSchema = z.union([
  z
    .object({
      schemaVersion: z.literal(1),
      mode: z.literal("control-and-record"),
      origin: z.literal("relay-control"),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      mode: z.literal("watch-and-infer"),
      origin: z.literal("observed-transition"),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      mode: z.literal("instrumented"),
      origin: z.literal("app-instrumentation"),
    })
    .strict(),
]);

export const authoringDebugOriginSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.object({ runId: z.string(), attempt: z.number(), stepId: z.string() }).strict(),
    evidenceRefs: z.array(z.string()),
    configRefs: z.array(z.string()),
  })
  .strict();

const authoringObservationProofSchema = z
  .object({
    schemaVersion: z.literal(1),
    captureOrder: z.enum(["pixels-first", "pixels-ax-pixels", "semantics-first", "concurrent"]),
    pixels: z
      .object({
        status: z.enum(["captured", "unavailable"]),
        capturedAt: z.number().optional(),
        fingerprint: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        bracket: z
          .object({
            status: z.enum(["coherent", "changed", "unavailable"]),
            afterCapturedAt: z.number().optional(),
            afterFingerprint: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    semantics: z
      .object({
        status: z.enum(["current", "stale", "unavailable"]),
        capturedAt: z.number().optional(),
        fingerprint: z.string().optional(),
      })
      .strict(),
  })
  .strict();

const authoringCaptureContextSchema = z
  .object({
    snapshotSource: z.enum(["sdk", "android-system", "pixels-only"]).optional(),
    inspectable: z.boolean().optional(),
    inspectionState: z.enum(["active", "keyguard", "asleep", "unavailable", "unknown"]).optional(),
    bindingState: z.enum(["matched", "rebound", "unavailable"]).optional(),
    treeApp: z.string().optional(),
    visualFingerprint: z.string().optional(),
    selectorEntrance: z
      .object({
        schemaVersion: z.literal(1),
        request: recordedEntranceRequestSchema,
        profile: recordedEntranceProfileSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const authoringScreenObservationSchema = z
  .object({
    id: z.string(),
    fingerprint: z.string(),
    capturedAt: z.number(),
    source: z.enum(["recording", "discovery", "run", "manual"]),
    deviceId: z.string().optional(),
  })
  .strict();

const authoringObservationSchema = z
  .object({
    id: z.string(),
    capturedAt: z.number(),
    screen: authoringScreenObservationSchema,
    evidenceIds: z.array(z.string()),
    proof: authoringObservationProofSchema.optional(),
    capture: authoringCaptureContextSchema.optional(),
    bounds: z.object({ width: z.number(), height: z.number() }).strict().optional(),
    foregroundApp: z.string().optional(),
    nodes: z.array(stringRecord).optional(),
  })
  .strict();

const applied = z.boolean().optional();

export const authoringInteractionSchema = z.union([
  z
    .object({
      kind: z.literal("tap"),
      target: stepTargetSchema,
      expectedApp: z.string().optional(),
      applied,
      browserResolution: browserDeviceInputResolutionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("type"),
      text: z.string(),
      target: stepTargetSchema.optional(),
      mode: z.enum(["append", "replace"]).optional(),
      applied,
    })
    .strict(),
  z
    .object({
      kind: z.literal("clipboard"),
      action: z.enum(["write", "read", "paste", "copy"]),
      text: z.string().optional(),
      target: stepTargetSchema.optional(),
      expect: z.string().optional(),
      match: z.enum(["exact", "contains"]).optional(),
      applied,
    })
    .strict(),
  z
    .object({
      kind: z.literal("app"),
      action: z.enum([
        "open",
        "close",
        "switcher",
        "inspect",
        "assert-installed",
        "assert-not-installed",
        "install",
        "update",
        "uninstall",
      ]),
      app: z.string().optional(),
      url: z.string().optional(),
      relaunch: z.boolean().optional(),
      artifact: z.string().optional(),
      as: z.string().optional(),
      version: z.string().optional(),
      versionMatch: z.enum(["exact", "contains"]).optional(),
      applied,
    })
    .strict(),
  z
    .object({
      kind: z.literal("device"),
      action: z.enum(["lock", "unlock", "keyboard-dismiss", "keyboard-enter"]),
      applied,
    })
    .strict(),
  z
    .object({
      kind: z.literal("rotate"),
      orientation: z.enum([
        "portrait",
        "portrait-upside-down",
        "landscape-left",
        "landscape-right",
      ]),
      applied,
    })
    .strict(),
  z
    .object({
      kind: z.literal("swipe"),
      from: z.object({ x: z.number(), y: z.number() }).strict(),
      to: z.object({ x: z.number(), y: z.number() }).strict(),
      durationMs: z.number().optional(),
      applied,
    })
    .strict(),
  z
    .object({
      kind: z.literal("key"),
      key: z.enum(["back", "home", "recents"]),
      applied,
    })
    .strict(),
  z.object({ kind: z.literal("wait"), ms: z.number() }).strict(),
  z.object({ kind: z.literal("observe"), label: z.string().optional() }).strict(),
  z
    .object({
      kind: z.literal("screenshot"),
      label: z.string().optional(),
      fullPage: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reusable"),
      recipeId: z.string(),
      bindings: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("steps"),
      steps: z.array(recipeStepSchema),
      label: z.string().optional(),
      applied,
    })
    .strict(),
]);

const authoringFullPageCaptureSchema = z
  .object({
    status: z.enum(["completed", "stopped"]),
    reason: z.string(),
    message: z.string(),
    frames: z.array(
      z.object({ index: z.number(), offsetY: z.number(), evidenceId: z.string() }).strict(),
    ),
    diagnosticFrames: z.array(
      z.object({ index: z.number(), offsetY: z.number(), evidenceId: z.string() }).strict(),
    ),
    stitchedEvidenceId: z.string().optional(),
    mergedNodes: z.array(stringRecord),
  })
  .strict();

const authoringActionSchema = z
  .object({
    id: z.string(),
    source: z.enum(["captured", "manual", "reusable"]),
    recordedAt: z.number(),
    startedAt: z.number(),
    finishedAt: z.number(),
    steps: z.array(recipeStepSchema),
    evidenceIds: z.array(z.string()),
    entranceObservationId: z.string().optional(),
    entranceCaptureVersion: z.literal(1).optional(),
    entranceCaptureRevision: z.number().optional(),
    entranceStepDigest: z.string().optional(),
    exitObservationId: z.string().optional(),
    proofStatus: z.enum(["verified", "pixels-only", "unresolved"]).optional(),
    label: z.string().optional(),
    browserResolution: browserDeviceInputResolutionSchema.optional(),
    fullPage: authoringFullPageCaptureSchema.optional(),
  })
  .strict();

const authoringTakeRevisionSchema = z
  .object({
    entranceCaptureVersion: z.literal(1).optional(),
    id: z.string(),
    takeId: z.string(),
    revision: z.number(),
    createdAt: z.number(),
    createdBy: z.string(),
    reason: z.enum(["recording", "trim", "reorder", "replace", "edit", "manual"]),
    actions: z.array(authoringActionSchema),
    evidence: z.array(authoringEvidenceSchema),
    observations: z.array(authoringObservationSchema).optional(),
    before: authoringObservationSchema.optional(),
    after: authoringObservationSchema.optional(),
    videoClip: z.object({ startMs: z.number(), endMs: z.number() }).strict().optional(),
  })
  .strict();

const authoringReplayActionProofSchema = z
  .object({
    actionId: z.string(),
    outcome: z.enum(["passed", "failed", "unobserved", "not-run"]),
    proofStatus: z.enum(["verified", "pixels-only", "unresolved"]),
    transition: z.enum(["changed", "unchanged", "unproven"]),
    entranceObservationId: z.string().optional(),
    exitObservationId: z.string().optional(),
    evidenceIds: z.array(z.string()),
    error: z.string().optional(),
  })
  .strict();

const authoringReplayAttemptSchema = z
  .object({
    source: z.enum(["recording", "replay"]).optional(),
    id: z.string(),
    takeId: z.string(),
    takeRevision: z.number(),
    startedAt: z.number(),
    finishedAt: z.number(),
    outcome: z.enum(["passed", "failed", "cancelled"]),
    evidence: z.array(authoringEvidenceSchema),
    captureMode: z.enum(["per-action", "final-only"]).optional(),
    observations: z.array(authoringObservationSchema).optional(),
    actionProofs: z.record(z.string(), authoringReplayActionProofSchema).optional(),
    before: authoringObservationSchema.optional(),
    after: authoringObservationSchema.optional(),
    error: z.string().optional(),
  })
  .strict();

const authoringRawTargetMetadataSchema = z
  .object({
    strategies: z.array(z.enum(["identifier", "ref", "label", "text", "relation", "point"])),
    point: z
      .object({
        x: z.number(),
        y: z.number(),
        referenceBounds: z.object({ width: z.number(), height: z.number() }).strict().optional(),
        anchored: z.boolean().optional(),
        relative: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const authoringRawRedactedValueSchema = z
  .object({
    redacted: z.literal(true),
    length: z.number(),
    lineCount: z.number(),
    hasNonAscii: z.boolean(),
  })
  .strict();

const rawBrowserResolutionSchema = z.object(browserDeviceInputResolutionShape).strict();

const authoringRawInteractionSchema = z.union([
  z
    .object({
      kind: z.literal("tap"),
      target: authoringRawTargetMetadataSchema.optional(),
      hasExpectedApp: z.boolean().optional(),
      applied,
      browserResolution: rawBrowserResolutionSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("type"),
      target: authoringRawTargetMetadataSchema.optional(),
      mode: z.enum(["append", "replace"]).optional(),
      value: authoringRawRedactedValueSchema,
      applied,
    })
    .strict(),
  z
    .object({
      kind: z.literal("clipboard"),
      action: z.enum(["write", "read", "paste", "copy"]),
      target: authoringRawTargetMetadataSchema.optional(),
      value: authoringRawRedactedValueSchema.optional(),
      expectation: authoringRawRedactedValueSchema.optional(),
      match: z.enum(["exact", "contains"]).optional(),
      applied,
    })
    .strict(),
  z
    .object({
      kind: z.literal("app"),
      action: z.enum([
        "open",
        "close",
        "switcher",
        "inspect",
        "assert-installed",
        "assert-not-installed",
        "install",
        "update",
        "uninstall",
      ]),
      hasApp: z.boolean().optional(),
      hasUrl: z.boolean().optional(),
      hasArtifact: z.boolean().optional(),
      hasVersion: z.boolean().optional(),
      relaunch: z.boolean().optional(),
      applied,
    })
    .strict(),
  z
    .object({
      kind: z.literal("device"),
      action: z.enum(["lock", "unlock", "keyboard-dismiss", "keyboard-enter"]),
      applied,
    })
    .strict(),
  z
    .object({
      kind: z.literal("rotate"),
      orientation: z.enum([
        "portrait",
        "portrait-upside-down",
        "landscape-left",
        "landscape-right",
      ]),
      applied,
    })
    .strict(),
  z
    .object({
      kind: z.literal("swipe"),
      from: z.object({ x: z.number(), y: z.number() }).strict(),
      to: z.object({ x: z.number(), y: z.number() }).strict(),
      durationMs: z.number().optional(),
      applied,
    })
    .strict(),
  z.object({ kind: z.literal("key"), key: z.enum(["back", "home", "recents"]), applied }).strict(),
  z.object({ kind: z.literal("wait"), ms: z.number() }).strict(),
  z.object({ kind: z.literal("observe"), hasLabel: z.boolean().optional() }).strict(),
  z
    .object({
      kind: z.literal("screenshot"),
      hasLabel: z.boolean().optional(),
      fullPage: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reusable"),
      hasRecipe: z.boolean().optional(),
      bindingCount: z.number(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("steps"),
      stepCount: z.number(),
      hasLabel: z.boolean().optional(),
      applied,
    })
    .strict(),
]);

const authoringRawObservationLinkSchema = z
  .object({
    observationId: z.string(),
    capturedAt: z.number(),
    evidenceIds: z.array(z.string()),
    viewport: z.object({ width: z.number(), height: z.number() }).strict().optional(),
    focus: z
      .object({
        status: z.enum(["captured", "unavailable"]),
        target: authoringRawTargetMetadataSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const authoringRawEventBaseShape = {
  id: z.string(),
  sequence: z.number(),
  recordedAt: z.number(),
  source: z
    .object({
      kind: z.literal("authoring-runtime"),
      target: authoringTargetSchema,
      captureProvenance: authoringCaptureProvenanceSchema.optional(),
    })
    .strict(),
} as const;

const authoringRawEventSchema = z.union([
  z
    .object({
      ...authoringRawEventBaseShape,
      kind: z.literal("take-start"),
      trigger: z.enum(["recording", "capture"]),
      observation: authoringRawObservationLinkSchema,
    })
    .strict(),
  z
    .object({
      ...authoringRawEventBaseShape,
      kind: z.literal("observation"),
      observation: authoringRawObservationLinkSchema,
    })
    .strict(),
  z
    .object({
      ...authoringRawEventBaseShape,
      kind: z.literal("interaction"),
      startedAt: z.number(),
      finishedAt: z.number(),
      interaction: authoringRawInteractionSchema,
      links: z
        .object({
          actionId: z.string(),
          entranceObservationId: z.string().optional(),
          exitObservationId: z.string().optional(),
          evidenceIds: z.array(z.string()),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...authoringRawEventBaseShape,
      kind: z.literal("interaction-intent"),
      startedAt: z.number(),
      interaction: authoringRawInteractionSchema,
      links: z
        .object({
          entranceObservationId: z.string().optional(),
          evidenceIds: z.array(z.string()),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...authoringRawEventBaseShape,
      kind: z.literal("interaction-outcome"),
      intentEventId: z.string(),
      outcome: z.enum(["succeeded", "failed", "unknown"]),
      finishedAt: z.number(),
      links: z
        .object({
          actionId: z.string().optional(),
          exitObservationId: z.string().optional(),
          evidenceIds: z.array(z.string()),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...authoringRawEventBaseShape,
      kind: z.literal("take-stop"),
      observation: authoringRawObservationLinkSchema,
      evidenceIds: z.array(z.string()),
    })
    .strict(),
]);

const authoringTakeSchema = z
  .object({
    id: z.string(),
    state: z.enum(["recording", "reviewing", "committed", "discarded"]),
    createdAt: z.number(),
    updatedAt: z.number(),
    currentRevision: z.number(),
    revisions: z.array(authoringTakeRevisionSchema),
    replayAttempts: z.array(authoringReplayAttemptSchema),
    rawCaptureVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    rawEvents: z.array(authoringRawEventSchema).optional(),
  })
  .strict();

const authoringCommitDestinationSchema = z.union([
  z.object({ kind: z.literal("new-screen"), title: z.string().optional() }).strict(),
  z.object({ kind: z.literal("screen"), screenId: z.string() }).strict(),
  z.object({ kind: z.literal("end") }).strict(),
]);

export const authoringSessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    actorId: z.string(),
    actorKind: z.enum(["human", "agent", "system"]),
    appMapId: z.string(),
    workflowRequestId: z.string().optional(),
    workflowMutation: z
      .object({
        mutationId: z.string().optional(),
        workflowId: z.string(),
        transitionVersion: z.number(),
        action: z.string(),
        completedAt: z.number(),
      })
      .strict()
      .optional(),
    testName: z.string().optional(),
    state: z.enum([
      "preparing",
      "ready",
      "recording",
      "reviewing",
      "committing",
      "committed",
      "failed",
      "cancelled",
    ]),
    target: authoringTargetSchema,
    originApplication: z.string().optional(),
    captureProvenance: authoringCaptureProvenanceSchema.optional(),
    debugOrigin: authoringDebugOriginSchema.optional(),
    leaseId: z.string(),
    expectedAppMapRevision: z.number(),
    sourceScreenId: z.string().optional(),
    pendingConnectionId: z.string().optional(),
    destination: authoringCommitDestinationSchema.optional(),
    group: z.string().optional(),
    take: authoringTakeSchema.optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    recoveredAt: z.number().optional(),
    recoverable: z.boolean().optional(),
    error: z.string().optional(),
    commitTransactionId: z.string().optional(),
    commitTestId: z.string().optional(),
    committedConnectionId: z.string().optional(),
    committedTestId: z.string().optional(),
    archive: z
      .object({
        reason: z.enum(["committed", "discarded", "superseded"]),
        archivedAt: z.number(),
        supersededBySessionId: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

authoringSessionSchema satisfies z.ZodType<AuthoringSession>;

export const authoringSessionResponseSchema = z
  .object({ session: authoringSessionSchema })
  .strict();

export const authoringSessionListResponseSchema = z
  .object({ sessions: z.array(authoringSessionSchema) })
  .strict();

export const authoringRawOptimizationProposalResponseSchema = z
  .object({
    proposal: z
      .object({
        schemaVersion: z.literal(1),
        kind: z.literal("authoring-raw-optimization"),
        reviewOnly: z.literal(true),
        takeId: z.string(),
        captureVersion: z.union([z.literal(1), z.literal(2)]),
        baseRevision: z.number(),
        sourceEventIds: z.array(z.string()),
        suggestions: z.array(
          z
            .object({
              kind: z.enum(["review-observe-only", "review-wait"]),
              rawEventId: z.string(),
              actionId: z.string(),
              reason: z.string(),
            })
            .strict(),
        ),
      })
      .strict()
      .nullable(),
  })
  .strict();
