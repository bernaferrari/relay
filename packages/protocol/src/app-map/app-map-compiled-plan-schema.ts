import * as z from "zod/v4";
import type { AppMapCompiledTest, OfflineTestPreflightReport } from "../test/test-intent.js";
import type { OfflineTestPreflightEvidenceSource } from "../test/test-offline-preflight.js";
import type {
  AppMapCompiledConnectionRun as ConnectionRun,
  AppMapCompiledFlow,
} from "./app-map.js";
import { executionRiskSchema } from "../approval-policy.js";
import { browserCaseProfileSchema } from "../browser/browser-case-profile.js";
import { captureReviewPlannedSlotSchema } from "../capture/capture-review-schema.js";
import {
  executionQueueDurationQuoteSchema,
  executionQueueSchema,
  iosReadinessDurationQuoteSchema,
} from "../execution/execution-queue.js";
import { normalizedSemanticNodeSchema, recipeStepSchema } from "../recipe/recipe-step-schema.js";
import { routeVariantConfigurationQuoteSchema } from "../route-variant-configuration.js";
import { caseStackSchema, connectionDestinationSchema } from "./app-map-document-schema.js";
import { executionTargetSchema } from "../execution/execution-operation-output-schemas.js";
import type { AppMapCombinePreflight } from "./app-map-combine-types.js";
import { scrollSurfaceTestBindingSchema } from "./app-map-test-family-schema.js";

const at = z.number();
const id = z.string();

const targetCapabilityListSchema = z.array(
  z.enum([
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
  ]),
);

const viewportSchema = z.object({ width: z.number(), height: z.number() }).strict();

const compiledRawAccessibilityVariantSchema = z
  .object({
    id,
    captureProvenanceKind: z.literal("run").optional(),
    locale: z.string().optional(),
    targetProfileId: id,
    targetId: id,
    platform: z.enum(["android", "ios", "browser"]),
    model: z.string().optional(),
    androidAvdName: z.string().optional(),
    osVersion: z.string().optional(),
    viewport: viewportSchema.optional(),
    browserCaseProfile: browserCaseProfileSchema.optional(),
    capabilities: targetCapabilityListSchema.optional(),
  })
  .strict();

const compiledRawAccessibilityTargetProfileSchema = z
  .object({
    id,
    targetId: id,
    platform: z.enum(["android", "ios", "browser"]),
    androidAvdName: z.string().optional(),
    viewport: viewportSchema.optional(),
    browserCaseProfile: browserCaseProfileSchema.optional(),
    model: z.string().optional(),
    osVersion: z.string().optional(),
    capabilities: targetCapabilityListSchema.optional(),
  })
  .strict();

const rawAccessibilityTreeEvidenceSchema = z
  .object({
    id,
    uri: z.string(),
    sha256: z.string(),
    mime: z.literal("application/json"),
    bytes: z.number(),
    observationId: z.string().optional(),
    capturedAt: at.optional(),
  })
  .strict();

const compiledRawAccessibilitySourceSchema = z
  .object({
    screenId: id,
    variant: compiledRawAccessibilityVariantSchema,
    origin: z.union([
      z
        .object({
          kind: z.literal("screen-variant"),
          observationId: z.string().optional(),
          capturedAt: at.optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("scroll-surface-viewport"),
          surfaceId: id,
          captureId: id,
          viewportIndex: z.number(),
          capturedAt: at,
        })
        .strict(),
    ]),
    tree: rawAccessibilityTreeEvidenceSchema,
  })
  .strict();

const reviewedLogicalStateBindingLiteSchema = z
  .object({
    screenId: id,
    logicalStateId: id,
    revision: z.number(),
    reviewedAt: at,
    reviewedBy: z.string(),
  })
  .strict();

const reviewedActionIntentBindingLiteSchema = z
  .object({
    connectionId: id,
    intentId: id,
    revision: z.number(),
    reviewedAt: at,
    reviewedBy: z.string(),
  })
  .strict();

const executionScheduleReasonSchema = z.enum([
  "reviewed-return-equivalence",
  "authored-order",
  "cleanup-boundary",
  "external-handoff",
  "cold-reset-branch",
  "unknown-cursor",
  "prerequisite-boundary",
  "unknown-document-position",
  "conflicting-document-order",
  "missing-reviewed-return",
]);

const executionScheduleCheckSchema = z
  .object({
    checkId: id,
    recipeId: id,
    authoredIndex: z.number(),
    proposedIndex: z.number(),
    sourceScreenId: id.optional(),
    semanticDocumentOrder: z.number().optional(),
    documentY: z.number().optional(),
    disposition: z.enum(["scheduled", "fixed", "deferred"]),
    reason: executionScheduleReasonSchema,
    returnToSource: z
      .object({
        sourceScreenId: id,
        terminalScreenId: id,
        kind: z.enum(["back", "connection"]),
        connectionIds: z.array(id),
      })
      .strict()
      .optional(),
  })
  .strict();

const recipeParameterSchema = z
  .object({
    name: z.string(),
    label: z.string().optional(),
    description: z.string().optional(),
    default: z.string().optional(),
    required: z.boolean().optional(),
  })
  .strict();

const testStepProvenanceSchema = z
  .object({
    recipeId: id,
    stepIndex: z.number(),
    recipeStepId: id,
    testId: id,
    testStepId: id,
    bindingKind: z.enum([
      "connections",
      "assertion",
      "recipe-step",
      "extract",
      "pause",
      "routine",
      "condition",
      "repeat",
      "script",
    ]),
    referencedEntityIds: z.array(id),
  })
  .strict();

const compiledTestSchema = z
  .object({
    schemaVersion: z.literal(1),
    appMapId: id,
    appMapRevision: z.number(),
    test: z
      .object({
        id,
        name: z.string(),
        kind: z.literal("scenario"),
        intentSchemaVersion: z.literal(1),
      })
      .strict(),
    runtimeTargetProfile: compiledRawAccessibilityTargetProfileSchema.optional(),
    testFamily: z
      .object({
        schemaVersion: z.literal(1),
        mode: z.enum(["legacy-single-surface", "reviewed-route-variant"]),
        testRevision: z.number(),
        logicalIntentRevision: z.number(),
        bindingRevision: z.number(),
        selectedRouteVariant: z
          .object({ id, revision: z.number(), reviewedAt: at, reviewedBy: z.string() })
          .strict()
          .optional(),
        targetSurface: z
          .object({
            targetProfileId: id,
            targetId: id,
            platform: z.enum(["android", "ios", "browser"]),
            viewport: viewportSchema.optional(),
            viewportClass: z.enum(["compact", "medium", "expanded"]).optional(),
            browserEngine: z.enum(["chromium", "firefox", "webkit"]).optional(),
            capabilities: targetCapabilityListSchema,
          })
          .strict()
          .optional(),
        logicalStateBindings: z.array(reviewedLogicalStateBindingLiteSchema),
        actionIntentBindings: z.array(reviewedActionIntentBindingLiteSchema),
      })
      .strict()
      .optional(),
    surfaceBindings: z.array(scrollSurfaceTestBindingSchema).optional(),
    rawAccessibilitySourcesByScreenId: z
      .record(z.string(), z.array(compiledRawAccessibilitySourceSchema))
      .optional(),
    rawAccessibilityVariantsByScreenId: z
      .record(z.string(), z.array(compiledRawAccessibilityVariantSchema))
      .optional(),
    rawAccessibilityTargetProfiles: z.array(compiledRawAccessibilityTargetProfileSchema).optional(),
    rawAccessibilityTreesByScreenId: z
      .record(z.string(), z.array(rawAccessibilityTreeEvidenceSchema))
      .optional(),
    executionSchedule: z
      .object({
        schemaVersion: z.literal(2),
        mode: z.enum(["authored", "review-required"]),
        checks: z.array(executionScheduleCheckSchema),
        deferredBranches: z.array(
          z.object({ checkId: id, recipeId: id, reason: z.literal("cold-reset-branch") }).strict(),
        ),
      })
      .strict()
      .optional(),
    rootRecipeId: id,
    recipes: z.record(
      z.string(),
      z
        .object({
          id,
          title: z.string(),
          description: z.string().optional(),
          parameters: z.array(recipeParameterSchema),
          steps: z.array(recipeStepSchema),
        })
        .strict(),
    ),
    stepProvenance: z.array(testStepProvenanceSchema),
    destEndRecipeIds: z.array(id).optional(),
    destEndObservationsByRecipeId: z
      .record(
        z.string(),
        z.array(z.object({ nodes: z.array(normalizedSemanticNodeSchema) }).strict()),
      )
      .optional(),
    performance: z
      .object({
        executableOperations: z.number(),
        moduleCalls: z.number(),
        operationCounts: z.record(z.string(), z.number()),
        screenshotCount: z.number(),
        destinationProofCount: z.number(),
      })
      .strict(),
    plannedSlots: z.array(captureReviewPlannedSlotSchema).optional(),
    executionQueue: executionQueueSchema.optional(),
    queueQuotes: z.array(executionQueueDurationQuoteSchema).optional(),
    routeVariantConfigurations: z.array(routeVariantConfigurationQuoteSchema).optional(),
    iosReadiness: iosReadinessDurationQuoteSchema.optional(),
    startup: z.union([
      z.object({ mode: z.literal("warm") }).strict(),
      z.object({ mode: z.literal("cold") }).strict(),
      z.object({ mode: z.literal("verified-checkpoint"), screenId: id }).strict(),
    ]),
    originApplication: z.string().optional(),
    omittedSteps: z
      .array(
        z
          .object({
            stepId: id,
            intent: z.string(),
            reason: z.string(),
            repairTargetId: id,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

/** Canonical compiled-Test contract. Runtime validation is strict above; the
 * annotation keeps API inference exact across the deeply nested plan shape. */
export const appMapCompiledTestSchema = compiledTestSchema satisfies z.ZodType<AppMapCompiledTest>;

const preflightEvidenceSourceSchema: z.ZodType<OfflineTestPreflightEvidenceSource> = z.lazy(() =>
  z
    .object({
      reference: z.string(),
      recordedEntrance: z
        .object({
          actionId: id,
          observationId: id,
          scope: z.literal("requested-selector-catalog"),
        })
        .strict()
        .optional(),
      evidenceId: z.string().optional(),
      sha256: z.string().optional(),
      variant: compiledRawAccessibilityVariantSchema.optional(),
      origin: z
        .union([
          z
            .object({
              kind: z.literal("screen-variant"),
              observationId: z.string().optional(),
              capturedAt: at.optional(),
            })
            .strict(),
          z
            .object({
              kind: z.literal("scroll-surface-viewport"),
              surfaceId: id,
              captureId: id,
              viewportIndex: z.number(),
              capturedAt: at,
            })
            .strict(),
        ])
        .optional(),
    })
    .strict(),
);

const boundsSchema = z
  .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
  .strict();

const semanticCandidateSchema = z
  .object({
    role: z.string(),
    identifier: z.string().optional(),
    label: z.string().optional(),
    value: z.string().optional(),
  })
  .strict();

const offlinePreflightReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("offline-test-preflight"),
    appMapId: id,
    appMapRevision: z.number(),
    testId: id,
    planDigest: z.string(),
    executionRisk: executionRiskSchema,
    summary: z
      .object({
        recipes: z.number(),
        checkedSelectors: z.number(),
        resolvedSelectors: z.number(),
        excludedDynamicSelectors: z.number().optional(),
        unknownCursorTransitions: z.number(),
        reviewRequiredReturns: z.number(),
        blockers: z.number(),
        warnings: z.number(),
      })
      .strict(),
    selectors: z.array(
      z
        .object({
          recipeId: id,
          recipeStepId: id.optional(),
          screenId: id.optional(),
          stepKind: z.enum(["tap", "reveal", "expect", "wait-for"]),
          target: z
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
            .strict(),
          status: z.enum([
            "resolved",
            "absent",
            "ambiguous",
            "needs-raw-tree",
            "raw-evidence-unavailable",
            "variant-selection-required",
            "variant-incompatible",
            "excluded-dynamic-content",
            "point-only",
            "source-observation-missing",
          ]),
          evidence: z
            .object({
              kind: z.enum([
                "raw-accessibility-tree",
                "screen-observation",
                "reveal-plan",
                "dynamic-content-policy",
                "none",
              ]),
              references: z.array(z.string()),
              sources: z.array(preflightEvidenceSourceSchema).optional(),
            })
            .strict(),
          rawVariantScope: z
            .object({
              selectedTargetProfileId: id.optional(),
              selectedTargetProfile: compiledRawAccessibilityTargetProfileSchema.optional(),
              targetProfileCandidates: z
                .array(compiledRawAccessibilityTargetProfileSchema)
                .optional(),
              selectedVariant: compiledRawAccessibilityVariantSchema.optional(),
              candidates: z.array(
                z
                  .object({
                    variant: compiledRawAccessibilityVariantSchema,
                    sourceCount: z.number(),
                    compatibility: z.enum([
                      "selected-variant",
                      "stable-identifier-equivalent",
                      "stable-relation-equivalent",
                      "incompatible",
                    ]),
                    reason: z.enum([
                      "selected-runtime-variant",
                      "same-target-platform-and-viewport",
                      "locale-sensitive-selector",
                      "target-platform-or-viewport-mismatch",
                      "stable-selector-not-present",
                      "stable-selector-not-activatable",
                      "selected-variant-needs-own-proof",
                      "no-raw-source",
                    ]),
                  })
                  .strict(),
              ),
            })
            .strict()
            .optional(),
          candidates: z.array(semanticCandidateSchema).optional(),
          rawCandidates: z
            .array(
              z
                .object({
                  source: preflightEvidenceSourceSchema,
                  relation: z.enum([
                    "match",
                    "relation-anchor",
                    "following-row",
                    "activation-owner",
                  ]),
                  node: z
                    .object({
                      treeOrder: z.number(),
                      role: z.string().optional(),
                      identifier: z.string().optional(),
                      label: z.string().optional(),
                      value: z.string().optional(),
                      index: z.number().optional(),
                      parentIndex: z.number().optional(),
                      bounds: boundsSchema.optional(),
                      hittable: z.boolean().optional(),
                      enabled: z.boolean().optional(),
                      visibleToUser: z.boolean().optional(),
                    })
                    .strict(),
                  owner: z
                    .object({
                      treeOrder: z.number(),
                      index: z.number().optional(),
                      parentIndex: z.number().optional(),
                      bounds: boundsSchema,
                      hittable: z.boolean().optional(),
                    })
                    .strict()
                    .optional(),
                })
                .strict(),
            )
            .optional(),
          rawCandidateCount: z.number().optional(),
          resolution: z
            .object({
              method: z.enum(["identifier", "label", "text", "relation", "point"]),
              activation: z.literal("snapshot-point").optional(),
              snapshotBounds: boundsSchema,
              provenance: preflightEvidenceSourceSchema.optional(),
            })
            .strict()
            .optional(),
          revealPositions: z
            .array(
              z
                .object({
                  surfaceId: id,
                  captureId: id,
                  targetOrder: z.number(),
                  targetDocumentY: z.number(),
                  direction: z.enum(["up", "down", "auto"]),
                })
                .strict(),
            )
            .optional(),
          detail: z.string().optional(),
        })
        .strict(),
    ),
    cursorTimeline: z.array(
      z
        .object({
          recipeId: id,
          recipeStepId: id.optional(),
          stepIndex: z.number(),
          state: z.enum(["expected", "unknown", "return-required"]),
          screenId: id.optional(),
          screenTitle: z.string().optional(),
          reason: z.string(),
        })
        .strict(),
    ),
    returns: z.array(
      z
        .object({
          recipeId: id,
          recipeStepId: id.optional(),
          connectionId: id,
          sourceScreenId: id,
          destinationScreenId: id,
          status: z.literal("review-required"),
        })
        .strict(),
    ),
    findings: z.array(
      z
        .object({
          severity: z.enum(["blocker", "warning"]),
          code: z.enum([
            "unresolved-return",
            "selector-absent",
            "selector-ambiguous",
            "selector-needs-raw-tree",
            "raw-evidence-recapture-required",
            "raw-evidence-variant-selection-required",
            "raw-evidence-variant-recapture-required",
            "point-only-selector",
            "source-observation-missing",
            "surface-recapture-required",
          ]),
          recipeId: id,
          recipeStepId: id.optional(),
          screenId: id.optional(),
          message: z.string(),
          evidence: z.array(preflightEvidenceSourceSchema).optional(),
          candidates: z.array(semanticCandidateSchema).optional(),
        })
        .strict(),
    ),
    savedPathCoverage: z
      .object({
        totalSteps: z.number(),
        coveredSteps: z.number(),
        needsModelSteps: z.number(),
        steps: z.array(
          z
            .object({
              recipeId: id,
              recipeStepId: id.optional(),
              testStepId: id.optional(),
              kind: z.enum(["action", "check"]),
              intent: z.string(),
              status: z.enum(["covered", "needs-model"]),
              savedPathSteps: z.number().optional(),
              detail: z.string(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict();

export const offlineTestPreflightReportSchema =
  offlinePreflightReportSchema satisfies z.ZodType<OfflineTestPreflightReport>;

/** Job summaries intentionally remain open: runners may attach
 * implementation-scoped facts beyond the shared summary vocabulary. */
export const appMapJobSummarySchema = z
  .object({
    id: z.string(),
    action: z.string(),
    status: z.string(),
    queuedAt: z.number(),
    frameCount: z.number().optional(),
    review: z.unknown().optional(),
  })
  .passthrough();

const compiledStepProvenanceSchema = z
  .object({
    recipeId: id,
    stepIndex: z.number(),
    stepId: id,
    origin: z.enum(["setup", "source", "action", "destination"]),
    ownerKind: z.enum(["flow", "connection", "routine"]),
    ownerId: id,
    actionId: id.optional(),
  })
  .strict();

const compiledRecipeSchema = z
  .object({
    id,
    title: z.string(),
    description: z.string().optional(),
    parameters: z.array(recipeParameterSchema),
    steps: z.array(recipeStepSchema),
    stepProvenance: z.array(compiledStepProvenanceSchema),
  })
  .strict();

const compiledConnectionSchema = z
  .object({
    connectionIndex: z.number(),
    connectionId: id,
    fromScreenId: id,
    destination: connectionDestinationSchema,
    caseStackId: id.optional(),
    compiledStepRange: z.tuple([z.number(), z.number()]),
  })
  .strict();

const compiledFlowSchema = z
  .object({
    schemaVersion: z.literal(1),
    appMapId: id,
    appMapRevision: z.number(),
    flow: z
      .object({
        id,
        name: z.string(),
        startScreenId: id,
        setup: z
          .object({ routineId: id, bindings: z.record(z.string(), z.string()).optional() })
          .strict()
          .optional(),
      })
      .strict(),
    rootRecipeId: id,
    recipes: z.record(z.string(), compiledRecipeSchema),
    connections: z.array(compiledConnectionSchema),
    caseStacks: z.array(caseStackSchema),
    terminal: z.union([
      connectionDestinationSchema,
      z.object({ kind: z.literal("screen"), screenId: id }).strict(),
    ]),
  })
  .strict();

export const appMapCompiledFlowSchema = compiledFlowSchema satisfies z.ZodType<AppMapCompiledFlow>;

const compiledConnectionRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    appMapId: id,
    appMapRevision: z.number(),
    connection: z
      .object({
        id,
        fromScreenId: id,
        destination: connectionDestinationSchema,
        label: z.string().optional(),
        caseStackId: id.optional(),
      })
      .strict(),
    rootRecipeId: id,
    recipes: z.record(z.string(), compiledRecipeSchema),
    caseStacks: z.array(caseStackSchema),
    terminal: connectionDestinationSchema,
  })
  .strict();

export const appMapCompiledConnectionRunSchema =
  compiledConnectionRunSchema satisfies z.ZodType<ConnectionRun>;

const matrixSchema = z
  .object({
    id,
    createdAt: at,
    seed: z.number(),
    strategy: z.enum(["repeat", "zip", "cartesian", "pairwise"]),
    cases: z.array(
      z
        .object({
          id,
          name: z.string(),
          index: z.number(),
          values: z.record(z.string(), z.string()),
          provenance: z.array(z.unknown()),
        })
        .strict(),
    ),
  })
  .strict();

export const appMapRunMatrixSchema = matrixSchema;

export const appMapNativeCompanionCompileSchema = z
  .object({
    testId: id,
    platform: z.enum(["android", "ios"]),
  })
  .passthrough();

const combinePreflightIssueSchema = z
  .object({
    code: z.enum([
      "missing-variable",
      "missing-test",
      "empty-selection",
      "invalid-variable",
      "invalid-test",
      "compile-failed",
      "large-run",
      "unknown-screenshot-count",
      "unused-input-data-set",
      "target-missing",
      "target-not-ready",
      "missing-binding",
      "duplicate-binding",
      "foreign-binding",
      "extra-binding",
      "mismatched-binding",
      "zero-bindings",
      "missing-target-binding",
      "duplicate-target-binding",
      "foreign-target-binding",
      "extra-target-binding",
      "mismatched-target-binding",
      "unsupported-target-binding",
      "zero-target-bindings",
      "unsafe-starting-state",
      "unsafe-execution-queue",
    ]),
    message: z.string(),
    cellId: id.optional(),
    testId: id.optional(),
    values: z.record(z.string(), z.string()).optional(),
    targetProfileId: id.optional(),
    variableId: id.optional(),
    inputId: id.optional(),
    inputName: z.string().optional(),
  })
  .strict();

const combinePreflightSchema = z
  .object({
    ok: z.boolean(),
    appMapId: id,
    combineId: id,
    name: z.string(),
    formula: z.string(),
    strategy: z.enum(["zip", "cartesian", "pairwise"]),
    variables: z.array(
      z
        .object({
          id,
          name: z.string(),
          selectedCount: z.number(),
          availableCount: z.number(),
        })
        .strict(),
    ),
    tests: z.array(
      z
        .object({
          id,
          name: z.string(),
          kind: z.literal("scenario"),
          expectedScreenshots: z.number().optional(),
        })
        .strict(),
    ),
    worlds: z.number(),
    checks: z.number(),
    deviceRuns: z.number(),
    expectedScreenshots: z.number().optional(),
    estimatedDurationMs: z.number().optional(),
    observedDuration: z
      .object({
        durationMs: z.number(),
        provenance: z.enum(["observed-p50", "observed-p95", "observed-sample"]),
        sampleCount: z.number(),
        workItemCount: z.number(),
        campaignIds: z.array(id),
      })
      .strict()
      .optional(),
    queueQuotes: z.array(executionQueueDurationQuoteSchema).optional(),
    routeVariantConfigurations: z.array(routeVariantConfigurationQuoteSchema).optional(),
    blockers: z.array(combinePreflightIssueSchema),
    warnings: z.array(combinePreflightIssueSchema),
    cells: z.array(
      z
        .object({
          cellId: id,
          testId: id,
          testName: z.string(),
          values: z.record(z.string(), z.string()),
          worldLabel: z.string(),
          targetProfileId: id.optional(),
          target: executionTargetSchema.optional(),
          binding: z.enum(["bound", "missing", "foreign", "duplicate", "extra", "mismatched"]),
          preflight: z.enum(["ready", "blocked"]).optional(),
          message: z.string().optional(),
        })
        .strict(),
    ),
    target: z
      .object({
        serial: z.string(),
        state: z.enum(["connected", "not-ready", "missing"]),
      })
      .strict()
      .optional(),
  })
  .strict();

export const appMapCombinePreflightSchema =
  combinePreflightSchema satisfies z.ZodType<AppMapCombinePreflight>;
