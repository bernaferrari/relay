import * as z from "zod/v4";
import { browserCaseProfileSchema } from "../browser/browser-case-profile.js";
import type { ActionSpec, Connection, Screen, ScreenVariant } from "./app-map.js";
import {
  recipeStepSchema,
  screenIdentityObservationSchema,
  stepTargetSchema,
} from "../recipe/recipe-step-schema.js";
import { appMapVariableSchema } from "./app-map-variable-schema.js";
import { testSemanticEdits } from "./app-map-test-operation-schemas.js";
import { activityEventSchema } from "../activity/activity-event-schema.js";
import {
  appMapTestSchema,
  flowSchema,
  routineSchema,
  runReferenceSchema,
  targetResultReferenceSchema,
} from "./app-map-test-family-schema.js";
import {
  logicalScrollSurfaceSchema,
  screenVariantRawAccessibilityTreeSchema,
  scrollSurfaceCapturePolicySchema,
} from "./scroll-surface-schemas.js";
export { logicalScrollSurfaceSchema } from "./scroll-surface-schemas.js";
import { authoringCaptureProvenanceSchema } from "../authoring/authoring-session-schema.js";

const id = z.string().min(1);
const at = z.number();

const appMapEntityShape = {
  id,
  organizationId: id,
  projectId: id,
  appMapId: id,
  createdAt: at,
  updatedAt: at,
} as const;

const pointSchema = z.object({ x: z.number(), y: z.number() }).strict();

export const appMapNoteSchema = z
  .object({ ...appMapEntityShape, text: z.string(), position: pointSchema })
  .strict();

export const mapGroupSchema = z
  .object({ ...appMapEntityShape, name: z.string(), screenIds: z.array(id) })
  .strict();

export const logicalProductStateSchema = z
  .object({ ...appMapEntityShape, name: z.string(), description: z.string().optional() })
  .strict();

export const productActionIntentSchema = z
  .object({ ...appMapEntityShape, name: z.string(), description: z.string().optional() })
  .strict();

const reviewedLogicalStateBindingSchema = z
  .object({
    logicalStateId: id,
    revision: z.number(),
    reviewedAt: at,
    reviewedBy: z.string(),
  })
  .strict();

const reviewedActionIntentBindingSchema = z
  .object({
    intentId: id,
    revision: z.number(),
    reviewedAt: at,
    reviewedBy: z.string(),
  })
  .strict();

const screenIdentityIgnoreRegionSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    name: z.string().optional(),
  })
  .strict();

export const screenIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    fingerprint: z.string(),
    aliases: z.array(z.string()).optional(),
    ignoreRegions: z.array(screenIdentityIgnoreRegionSchema).optional(),
  })
  .strict();

const destinationEvidenceSurfaceSchema = z.enum([
  "ordinary",
  "modal",
  "preview",
  "confirmation",
  "dead-end",
]);

export const screenConsolidationPreviewSchema = z
  .object({
    targetScreenId: id,
    sourceScreenIds: z.array(id),
    movedVariantIds: z.array(id),
    mergedVariantIds: z.array(z.object({ sourceVariantId: id, targetVariantId: id }).strict()),
    rewiredConnectionIds: z.array(id),
    removedSelfLoopConnectionIds: z.array(id),
    connectionCollisions: z.array(z.object({ connectionIds: z.array(id) }).strict()),
    rewiredFlowIds: z.array(id),
    rewiredTestIds: z.array(id),
    rewiredVariableIds: z.array(id),
    rewiredGroupIds: z.array(id),
    semanticRevealConnectionIds: z.array(id),
    testPathEdits: z.array(
      z
        .object({
          testId: id,
          stepId: id,
          beforeConnectionIds: z.array(id),
          afterConnectionIds: z.array(id),
        })
        .strict(),
    ),
    removedTestStepIds: z.array(id),
    renamedTestSteps: z.array(
      z
        .object({
          testId: id,
          stepId: id,
          beforeIntent: z.string(),
          afterIntent: z.string(),
        })
        .strict(),
    ),
    resultingCounts: z
      .object({
        screens: z.number(),
        variants: z.number(),
        connections: z.number(),
        surfaceBindings: z.number(),
        testSteps: z.number(),
      })
      .strict(),
    blockers: z.array(
      z.object({ code: z.string(), message: z.string(), entityIds: z.array(id) }).strict(),
    ),
  })
  .strict();

const baselineProvenanceSchema = z
  .object({
    approvedAt: at,
    approvedBy: z.string(),
    source: z.union([
      z
        .object({
          kind: z.literal("run"),
          targetResultId: id,
          evidenceId: z.string().optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("recording"),
          takeId: id,
          takeRevision: z.number(),
          evidenceIds: z.array(z.string()),
        })
        .strict(),
      z.object({ kind: z.literal("manual"), evidenceIds: z.array(z.string()) }).strict(),
    ]),
  })
  .strict();

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

export const targetProfileSchema = z
  .object({
    id,
    targetId: id,
    source: z.enum(["device", "browser"]),
    platform: z.enum(["android", "ios", "browser"]),
    name: z.string(),
    model: z.string().optional(),
    androidAvdName: z.string().optional(),
    observedAndroidAvdName: z.string().optional(),
    osVersion: z.string().optional(),
    viewport: z.object({ width: z.number(), height: z.number() }).strict().optional(),
    browserCaseProfile: browserCaseProfileSchema.optional(),
    capabilities: z.array(targetCapabilitySchema),
    observedAt: at,
  })
  .strict();

export const screenVariantSchema = z
  .object({
    ...appMapEntityShape,
    screenId: id,
    targetProfile: targetProfileSchema,
    observation: screenIdentityObservationSchema.optional(),
    evidenceIds: z.array(z.string()),
    evidenceUris: z.array(z.string()).optional(),
    rawAccessibilityTree: screenVariantRawAccessibilityTreeSchema.optional(),
    screenshotUri: z.string().optional(),
    scrollSurfaces: z.array(logicalScrollSurfaceSchema).optional(),
    scrollCapturePolicy: scrollSurfaceCapturePolicySchema.optional(),
    baseline: baselineProvenanceSchema.optional(),
    refreshCapture: z.object({ captureId: id, capturedAt: at }).strict().optional(),
    captureProvenance: z
      .object({
        kind: z.literal("run"),
        runId: id,
        capturedAt: at,
        locale: z.string().optional(),
        screenshotEvidenceId: z.string(),
        accessibilityEvidenceId: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const screenSchema: z.ZodType<Screen> = z
  .object({
    ...appMapEntityShape,
    title: z.string(),
    description: z.string().optional(),
    logicalStateBinding: reviewedLogicalStateBindingSchema.optional(),
    handoff: z
      .object({
        ownerApp: z.string(),
        returnAction: z.enum(["back", "relaunch-source"]),
      })
      .strict()
      .optional(),
    identity: screenIdentitySchema.optional(),
    evidenceSurface: destinationEvidenceSurfaceSchema.optional(),
    position: pointSchema.optional(),
    variantIds: z.array(id),
    consolidations: z
      .array(
        z
          .object({
            eventId: id,
            actorId: z.string(),
            at,
            sourceScreens: z.array(z.lazy((): z.ZodType<Screen> => screenSchema)),
            sourceVariants: z.array(z.lazy((): z.ZodType<ScreenVariant> => screenVariantSchema)),
            internalConnections: z.array(z.lazy((): z.ZodType<Connection> => connectionSchema)),
            preview: screenConsolidationPreviewSchema,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const captureCoverageSchema = z.enum(["inspect", "transition"]);

const actionMetadataShape = {
  id,
  label: z.string().optional(),
  coverage: captureCoverageSchema.optional(),
  optional: z.boolean().optional(),
  when: z
    .object({
      target: stepTargetSchema,
      condition: z.enum(["present", "absent"]),
      region: z
        .object({
          minX: z.number().optional(),
          maxX: z.number().optional(),
          minY: z.number().optional(),
          maxY: z.number().optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .optional(),
} as const;

export const assertionSpecSchema = z.union([
  z.object({ kind: z.literal("screen"), screenId: id }).strict(),
  z
    .object({
      kind: z.literal("target"),
      target: stepTargetSchema,
      condition: z.enum(["visible", "gone"]),
      timeoutMs: z.number().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("layout"),
      relation: z.literal("non-overlap"),
      first: stepTargetSchema,
      second: stepTargetSchema,
      timeoutMs: z.number().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("content"),
      input: z.string(),
      expected: z.string(),
      match: z.enum(["exact", "equals", "contains", "not-contains", "number-equals", "field"]),
      field: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("visual"),
      criteria: z.array(z.string()),
      region: z
        .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
        .strict()
        .optional(),
      requireAgreement: z.boolean().optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
      secondProvider: z.string().optional(),
      secondModel: z.string().optional(),
    })
    .passthrough(),
]);

export const actionSpecSchema: z.ZodType<ActionSpec> = z.union([
  z
    .object({
      ...actionMetadataShape,
      kind: z.literal("recorded"),
      entranceCaptureVersion: z.literal(1).optional(),
      takeId: id,
      takeRevision: z.number(),
      steps: z.array(recipeStepSchema),
      evidenceIds: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      ...actionMetadataShape,
      kind: z.literal("steps"),
      steps: z.array(recipeStepSchema),
    })
    .strict(),
  z
    .object({
      ...actionMetadataShape,
      kind: z.literal("tap"),
      target: stepTargetSchema,
      fallbackTargets: z.array(stepTargetSchema).optional(),
      expectedApp: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...actionMetadataShape,
      kind: z.literal("text"),
      text: z.string(),
      target: stepTargetSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...actionMetadataShape,
      kind: z.literal("gesture"),
      gesture: z.union([
        z
          .object({
            kind: z.literal("swipe"),
            from: z.object({ x: z.number(), y: z.number() }).strict(),
            to: z.object({ x: z.number(), y: z.number() }).strict(),
            durationMs: z.number().optional(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("scroll"),
            direction: z.enum(["up", "down"]),
            amount: z.number().optional(),
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      ...actionMetadataShape,
      kind: z.literal("reveal"),
      target: stepTargetSchema,
      direction: z.enum(["up", "down", "auto"]).optional(),
      maxAttempts: z.number().optional(),
    })
    .strict(),
  z.object({ ...actionMetadataShape, kind: z.literal("back") }).strict(),
  z.object({ ...actionMetadataShape, kind: z.literal("home") }).strict(),
  z
    .object({
      ...actionMetadataShape,
      kind: z.literal("app"),
      action: z.literal("open"),
      app: z.string().optional(),
      url: z.string().optional(),
      relaunch: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      ...actionMetadataShape,
      kind: z.literal("app"),
      action: z.literal("close"),
      app: z.string(),
    })
    .strict(),
  z.object({ ...actionMetadataShape, kind: z.literal("wait"), ms: z.number() }).strict(),
  z
    .object({
      ...actionMetadataShape,
      kind: z.literal("assertion"),
      assertion: assertionSpecSchema,
    })
    .strict(),
  z
    .object({
      ...actionMetadataShape,
      kind: z.literal("routine"),
      routineId: id,
      bindings: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
  z
    .object({
      ...actionMetadataShape,
      kind: z.literal("passive"),
      reason: z.enum(["automatic", "observe-only", "external"]),
    })
    .strict(),
]);

export const connectionDestinationSchema = z.union([
  z.object({ kind: z.literal("screen"), screenId: id }).strict(),
  z.object({ kind: z.literal("end") }).strict(),
]);

const connectionNavigationTargetSchema = z.union([
  z.object({ kind: z.literal("identifier"), identifier: z.string() }).strict(),
  z
    .object({
      kind: z.literal("accessibility"),
      label: z.string(),
      role: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("element-relative"),
      anchor: z
        .object({
          identifier: z.string().optional(),
          label: z.string().optional(),
          role: z.string().optional(),
        })
        .strict(),
      xRatio: z.number(),
      yRatio: z.number(),
      reviewedAt: at,
      reviewedBy: z.string(),
      evidenceIds: z.array(z.string()),
    })
    .strict(),
]);

const connectionScreenProofSchema = z
  .object({
    screenId: id,
    identity: screenIdentitySchema,
    evidenceIds: z.array(z.string()),
  })
  .strict();

const connectionNavigationContractSchema = z
  .object({
    targetAlternatives: z.array(connectionNavigationTargetSchema),
    expectedDestination: connectionScreenProofSchema,
  })
  .strict();

const connectionReturnContractSchema = z
  .object({
    kind: z.literal("back"),
    expectedDestination: connectionScreenProofSchema,
    expectedApp: z.string().optional(),
  })
  .strict();

const connectionSourceAnchorSchema = z
  .object({
    point: pointSchema,
    rect: pointSchema.extend({ width: z.number(), height: z.number() }).strict().optional(),
  })
  .strict();

const connectionPort = z.enum(["auto", "left", "right", "top", "bottom"]);

const connectionPresentationSchema = z
  .object({
    route: z.enum(["elbow", "curve", "straight"]).optional(),
    strokeWidth: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    arrow: z.enum(["none", "start", "end", "both"]).optional(),
    sourcePort: connectionPort.optional(),
    targetPort: connectionPort.optional(),
    sourceOffset: z.number().optional(),
    targetOffset: z.number().optional(),
    controlOffset: pointSchema.optional(),
  })
  .passthrough();

const authoringRecordingSourceSchema = z
  .object({
    schemaVersion: z.literal(1),
    takeId: id,
    takeRevision: z.number().int().positive(),
    capture: z
      .object({
        schemaVersion: z.literal(1),
        provenance: authoringCaptureProvenanceSchema,
        proof: z.enum([
          "relay-controlled",
          "inferred-unproved",
          "instrumented-unproved",
          "replay-proved",
        ]),
      })
      .strict(),
    evidenceIds: z.array(id).max(256),
    frames: z
      .array(
        z
          .object({
            evidenceId: id,
            uri: z.string().min(1),
            role: z.enum(["before", "after"]),
          })
          .strict(),
      )
      .max(2)
      .optional(),
  })
  .strict();

export const connectionSchema = z
  .object({
    ...appMapEntityShape,
    fromScreenId: id,
    destination: connectionDestinationSchema,
    label: z.string().optional(),
    coverage: captureCoverageSchema.optional(),
    actionIntentBinding: reviewedActionIntentBindingSchema.optional(),
    caseStackId: id.optional(),
    state: z.enum(["draft", "ready"]),
    actions: z.array(actionSpecSchema),
    navigation: connectionNavigationContractSchema.optional(),
    return: connectionReturnContractSchema.optional(),
    sourceAnchor: connectionSourceAnchorSchema.optional(),
    recordingSource: authoringRecordingSourceSchema.optional(),
    presentation: connectionPresentationSchema.optional(),
  })
  .strict();

export const caseStackSchema = z
  .object({
    ...appMapEntityShape,
    name: z.string(),
    description: z.string().optional(),
    dataIds: z.array(id),
    strategy: z.enum(["zip", "cartesian", "pairwise"]),
    maxCases: z.number(),
  })
  .strict();

const capturePolicySchema = z.union([
  z.object({ mode: z.literal("every-screen") }).strict(),
  z.object({ mode: z.literal("checkpoints"), screenIds: z.array(id) }).strict(),
  z.object({ mode: z.literal("final-screen") }).strict(),
  z.object({ mode: z.literal("failures-only") }).strict(),
  z.object({ mode: z.literal("none") }).strict(),
]);

export const appMapCombineSchema = z
  .object({
    ...appMapEntityShape,
    name: z.string(),
    variableIds: z.array(id),
    testIds: z.array(id),
    selected: z.record(z.string(), z.array(z.string())).optional(),
    captures: z.record(z.string(), capturePolicySchema).optional(),
    referenceReviewMode: z.enum(["human", "approved-reference"]).optional(),
    strategy: z.enum(["zip", "cartesian", "pairwise"]).optional(),
    repeatPolicy: z.record(z.string(), z.unknown()).optional(),
    cellRuntimeProfiles: z
      .array(
        z
          .object({
            testId: id,
            values: z.record(z.string(), z.string()),
            targetProfileId: id,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const addScreenInputSchema = z
  .object({
    screen: screenSchema,
    variants: z.array(screenVariantSchema).optional(),
  })
  .strict();

const screenPatchSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    logicalStateBinding: reviewedLogicalStateBindingSchema.nullable().optional(),
    handoff: z
      .object({
        ownerApp: z.string(),
        returnAction: z.enum(["back", "relaunch-source"]),
      })
      .strict()
      .nullable()
      .optional(),
    identity: screenIdentitySchema.nullable().optional(),
    evidenceSurface: destinationEvidenceSurfaceSchema.nullable().optional(),
    position: pointSchema.nullable().optional(),
  })
  .strict();

export const updateScreenInputSchema = z
  .object({
    patch: screenPatchSchema,
    upsertVariants: z.array(screenVariantSchema).optional(),
    removeVariantIds: z.array(id).optional(),
  })
  .strict();

export const connectionPatchSchema = z
  .object({
    fromScreenId: id.optional(),
    destination: connectionDestinationSchema.optional(),
    label: z.string().nullable().optional(),
    coverage: captureCoverageSchema.nullable().optional(),
    actionIntentBinding: reviewedActionIntentBindingSchema.nullable().optional(),
    caseStackId: id.nullable().optional(),
    state: z.enum(["draft", "ready"]).optional(),
    actions: z.array(actionSpecSchema).optional(),
    navigation: connectionNavigationContractSchema.nullable().optional(),
    return: connectionReturnContractSchema.nullable().optional(),
    sourceAnchor: connectionSourceAnchorSchema.nullable().optional(),
    presentation: connectionPresentationSchema.nullable().optional(),
  })
  .strict();

const testProposalReviewSchema = z
  .object({
    before: z
      .object({
        name: z.string(),
        stepCount: z.number(),
        resolvedStepCount: z.number(),
        unresolvedStepCount: z.number(),
      })
      .strict(),
    after: z
      .object({
        name: z.string(),
        stepCount: z.number(),
        resolvedStepCount: z.number(),
        unresolvedStepCount: z.number(),
      })
      .strict(),
    edits: z.array(
      z
        .object({
          kind: z.enum([
            "test.patch",
            "step.add",
            "step.patch",
            "step.remove",
            "step.reorder",
            "step.bind",
            "step.unbind",
          ]),
          summary: z.string(),
          stepId: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();

const proposalChangeSchema = z.union([
  z.object({ kind: z.literal("screen.add"), input: addScreenInputSchema }).strict(),
  z
    .object({ kind: z.literal("screen.update"), screenId: id, input: updateScreenInputSchema })
    .strict(),
  z.object({ kind: z.literal("screen.remove"), screenId: id }).strict(),
  z.object({ kind: z.literal("connection.connect"), connection: connectionSchema }).strict(),
  z
    .object({
      kind: z.literal("connection.update"),
      connectionId: id,
      patch: connectionPatchSchema,
    })
    .strict(),
  z.object({ kind: z.literal("connection.remove"), connectionId: id }).strict(),
  z.object({ kind: z.literal("group.save"), group: mapGroupSchema }).strict(),
  z.object({ kind: z.literal("group.remove"), groupId: id }).strict(),
  z
    .object({
      kind: z.literal("test.edit"),
      testId: id,
      edits: testSemanticEdits,
      review: testProposalReviewSchema.optional(),
    })
    .strict(),
]);

const proposalDecisionSchema = z
  .object({
    actorId: z.string(),
    at,
    reason: z.string().optional(),
  })
  .strict();

export const proposalSchema = z
  .object({
    ...appMapEntityShape,
    title: z.string(),
    description: z.string().optional(),
    status: z.enum(["pending", "approved", "rejected"]),
    sourceRevision: z.number().optional(),
    baseRevision: z.number(),
    changes: z.array(proposalChangeSchema),
    decision: proposalDecisionSchema.optional(),
    repair: z
      .object({
        kind: z.enum(["retarget", "accept-current", "disable"]),
        testId: id,
        repairTargetIds: z.array(id),
        sourceRunIds: z.array(id),
        sourceCheckIds: z.array(id),
        evidenceFramePaths: z.array(z.string()),
        equivalentDiffKey: z.string(),
        inverseChanges: z.array(proposalChangeSchema),
        approvedRevision: z.number().optional(),
        reverted: proposalDecisionSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const appMapDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    organizationId: id,
    projectId: id,
    name: z.string(),
    description: z.string().optional(),
    revision: z.number(),
    notes: z.record(z.string(), appMapNoteSchema),
    groups: z.record(z.string(), mapGroupSchema),
    logicalStates: z.record(z.string(), logicalProductStateSchema).optional(),
    actionIntents: z.record(z.string(), productActionIntentSchema).optional(),
    screens: z.record(z.string(), screenSchema),
    screenVariants: z.record(z.string(), screenVariantSchema),
    connections: z.record(z.string(), connectionSchema),
    caseStacks: z.record(z.string(), caseStackSchema),
    variables: z.record(z.string(), appMapVariableSchema),
    tests: z.record(z.string(), appMapTestSchema),
    combines: z.record(z.string(), appMapCombineSchema),
    routines: z.record(z.string(), routineSchema),
    flows: z.record(z.string(), flowSchema),
    runs: z.record(z.string(), runReferenceSchema),
    targetResults: z.record(z.string(), targetResultReferenceSchema),
    proposals: z.record(z.string(), proposalSchema),
    activity: z.record(z.string(), activityEventSchema),
    createdAt: at,
    updatedAt: at,
  })
  .strict() satisfies z.ZodType<import("./app-map.js").AppMap>;

export { activityEventSchema } from "../activity/activity-event-schema.js";
export { appMapVariableSchema } from "./app-map-variable-schema.js";
export { routineSchema } from "./app-map-test-family-schema.js";
export { flowSchema } from "./app-map-test-family-schema.js";
export { runReferenceSchema } from "./app-map-test-family-schema.js";
export { targetResultReferenceSchema } from "./app-map-test-family-schema.js";
export { appMapScenarioTestStepSchema } from "./app-map-test-family-schema.js";
export { appMapTestSchema } from "./app-map-test-family-schema.js";
