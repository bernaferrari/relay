import * as z from "zod/v4";
import { testSurfacePredicate } from "./app-map-test-operation-schemas.js";
import { validationRecipeStep } from "../test/test-binding-schemas.js";
import { resolvedRouteBinding } from "../test/test-binding-schemas.js";
import type { AppMapScenarioTestStep } from "../test/test-intent.js";
import {
  recipeParameterSchema,
  recipeStepSchema,
  stepTargetSchema,
} from "../recipe/recipe-step-schema.js";
import {
  actionSpecSchema,
  assertionSpecSchema,
  targetProfileSchema,
} from "./app-map-document-schema.js";

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
export const startingStateFactSchema = z.enum([
  "known-account",
  "home-visible",
  "menu-closed",
  "composer-empty",
  "owned-conversation-available",
  "language-theme-established",
]);

export const leftoverSurfaceSchema = z.enum([
  "settings",
  "sidebar",
  "private-chat",
  "signed-out",
  "prefs-mutated",
  "conversation-deleted",
  "interrupted",
]);

export const sharingPolicySchema = z.enum([
  "safe-shared-read",
  "fail-closed",
  "isolated-lane",
  "isolated-account",
]);

export const accountIsolationSchema = z.enum(["browser-lane-only", "server-account"]);

export const routineEffectsOutputSchema = z
  .object({
    establishes: z.array(startingStateFactSchema).readonly().optional(),
    requires: z.array(startingStateFactSchema).readonly().optional(),
    leftover: z.array(leftoverSurfaceSchema).readonly().optional(),
    sharing: sharingPolicySchema.optional(),
    accountIsolation: accountIsolationSchema.optional(),
    accountIsolationNote: z.string().optional(),
  })
  .strict();

export const appMapTestStartingStateOutputSchema = z
  .object({
    requires: z.array(startingStateFactSchema).readonly().optional(),
    sourceScreenId: z.string().optional(),
    leftover: z.array(leftoverSurfaceSchema).readonly().optional(),
    sharing: sharingPolicySchema.optional(),
    accountIsolation: accountIsolationSchema.optional(),
    accountIsolationNote: z.string().optional(),
  })
  .strict();

export const routineSchema = z
  .object({
    ...appMapEntityShape,
    name: z.string(),
    description: z.string().optional(),
    parameters: z.array(recipeParameterSchema),
    actions: z.array(z.lazy(() => actionSpecSchema)),
    requirementAction: z.enum(["capture-view", "test-action"]).optional(),
    effects: routineEffectsOutputSchema.optional(),
  })
  .strict();

export const flowSchema = z
  .object({
    ...appMapEntityShape,
    name: z.string(),
    startScreenId: id,
    setup: z
      .object({
        routineId: id,
        bindings: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .optional(),
    connectionIds: z.array(id),
  })
  .strict();

export const runReferenceSchema = z
  .object({
    ...appMapEntityShape,
    flowId: id.optional(),
    appMapRevision: z.number(),
    targetResultIds: z.array(id),
    startedAt: at,
    finishedAt: at.optional(),
  })
  .strict();

export const connectionExecutionObservationSchema = z
  .object({
    connectionId: id,
    outcome: z.enum(["passed", "failed"]),
    durationMs: z.number(),
    observedAt: at,
  })
  .strict();

export const targetResultReferenceSchema = z
  .object({
    ...appMapEntityShape,
    runId: id,
    targetProfile: z.lazy(() => targetProfileSchema),
    outcome: z.enum(["passed", "product-failure", "harness-failure", "uncertain", "cancelled"]),
    connectionId: id.optional(),
    connectionObservations: z.array(connectionExecutionObservationSchema).optional(),
    evidenceIds: z.array(z.string()),
    finishedAt: at.optional(),
  })
  .strict();

export const testStepBaseShape = {
  id,
  intent: z.string(),
  note: z.string().optional(),
  capture: z.boolean().optional(),
  execution: z
    .object({
      status: z.literal("disabled"),
      reason: z.string(),
      repairTargetId: z.string(),
      decidedBy: z.string(),
      decidedAt: at,
    })
    .strict()
    .optional(),
} as const;

export const unresolvedBindingSchema = z
  .object({
    status: z.literal("unresolved"),
    reason: z.string(),
    candidates: z
      .array(
        z
          .object({
            kind: z.enum(["connection", "screen", "routine"]),
            id,
            label: z.string(),
          })
          .strict(),
      )
      .optional(),
    fromText: z.literal(true).optional(),
    cache: z
      .union([
        z
          .object({
            steps: z.array(recipeStepSchema),
            runId: id,
            savedAt: at,
          })
          .strict(),
        z
          .object({
            schemaVersion: z.literal(2),
            steps: z.array(recipeStepSchema),
            runId: id,
            savedAt: at,
            targetKind: z.enum(["browser", "device"]),
            platform: z.enum(["android", "ios"]).optional(),
            viewport: z.object({ width: z.number(), height: z.number() }).strict().optional(),
            resolution: z.array(
              z
                .object({
                  strategy: z.enum(["identifier", "ref", "label", "text"]),
                  key: z.string(),
                })
                .strict(),
            ),
            verification: z
              .object({
                runOutcome: z.literal("passed"),
                checkStepIds: z.array(id).optional(),
              })
              .strict(),
            healedFrom: z
              .object({ runId: id, savedAt: at, reason: z.string() })
              .strict()
              .optional(),
            hits: z.number().optional(),
            lastHitAt: at.optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();

export const resolved = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ status: z.literal("resolved"), ...shape }).strict();

export const testStepCleanupSchema = z
  .object({
    kind: z.literal("routine"),
    routineId: id,
    bindings: z.record(z.string(), z.string()).optional(),
    terminalScreenId: id,
    onCancel: z.enum(["run-if-controllable", "skip"]),
  })
  .strict();

export const appMapScenarioTestStepUnion = z.lazy(() =>
  z.union([
    z
      .object({
        ...testStepBaseShape,
        kind: z.literal("instruction"),
        binding: z.union([
          unresolvedBindingSchema,
          resolved({ kind: z.literal("connections"), connectionIds: z.array(id) }),
        ]),
        cleanup: testStepCleanupSchema.optional(),
      })
      .strict(),
    z
      .object({
        ...testStepBaseShape,
        kind: z.literal("validation"),
        binding: z.union([
          unresolvedBindingSchema,
          z.union([
            resolved({
              kind: z.literal("assertion"),
              assertion: z.lazy(() => assertionSpecSchema),
            }),
            resolved({ kind: z.literal("recipe-step"), step: validationRecipeStep }),
          ]),
        ]),
      })
      .strict(),
    z
      .object({
        ...testStepBaseShape,
        kind: z.literal("extraction"),
        binding: z.union([
          unresolvedBindingSchema,
          resolved({
            kind: z.literal("extract"),
            as: z.string(),
            target: stepTargetSchema,
            role: z.enum(["user", "assistant", "system"]).optional(),
          }),
        ]),
      })
      .strict(),
    z
      .object({
        ...testStepBaseShape,
        kind: z.literal("manual"),
        binding: z.union([
          unresolvedBindingSchema,
          resolved({
            kind: z.literal("pause"),
            message: z.string(),
            reason: z
              .enum([
                "authentication",
                "consent",
                "verification",
                "captcha",
                "permission",
                "review",
                "other",
              ])
              .optional(),
            resumeLabel: z.string().optional(),
            timeoutMs: z.number().optional(),
            verifyAfter: z
              .object({
                target: stepTargetSchema,
                condition: z.enum(["visible", "gone"]).optional(),
                timeoutMs: z.number().optional(),
              })
              .strict()
              .optional(),
          }),
        ]),
      })
      .strict(),
    z
      .object({
        ...testStepBaseShape,
        kind: z.literal("module"),
        binding: z.union([
          unresolvedBindingSchema,
          resolved({
            kind: z.literal("routine"),
            routineId: id,
            bindings: z.record(z.string(), z.string()).optional(),
          }),
        ]),
      })
      .strict(),
    z
      .object({
        ...testStepBaseShape,
        kind: z.literal("decision"),
        binding: z.union([
          unresolvedBindingSchema,
          resolved({
            kind: z.literal("condition"),
            input: z.string(),
            operator: z.enum(["exists", "equals", "not-equals", "contains"]),
            expected: z.string().optional(),
          }),
        ]),
        thenSteps: z.array(appMapScenarioTestStepSchema),
        elseSteps: z.array(appMapScenarioTestStepSchema).optional(),
      })
      .strict(),
    z
      .object({
        ...testStepBaseShape,
        kind: z.literal("loop"),
        binding: z.union([
          unresolvedBindingSchema,
          resolved({ kind: z.literal("repeat"), count: z.number() }),
        ]),
        steps: z.array(appMapScenarioTestStepSchema),
      })
      .strict(),
    z
      .object({
        ...testStepBaseShape,
        kind: z.literal("script"),
        binding: z.union([
          unresolvedBindingSchema,
          resolved({ kind: z.literal("script"), source: z.string() }),
        ]),
      })
      .strict(),
  ]),
);

/** Canonical recursive Test-step contract; structurally strict above. */
export const appMapScenarioTestStepSchema: z.ZodType<AppMapScenarioTestStep> =
  appMapScenarioTestStepUnion;

export const appMapTestRouteVariantSchema = z
  .object({
    id,
    revision: z.number(),
    predicate: testSurfacePredicate,
    bindings: z.record(id, resolvedRouteBinding),
    reviewedAt: at,
    reviewedBy: z.string(),
  })
  .strict();

export const scrollSurfaceTestBindingSchema = z
  .object({
    screenId: id,
    variantId: id,
    captureMode: z.enum(["viewport", "full-surface"]),
    reason: z.string(),
    surfaceId: id.optional(),
    baselineCaptureId: id.optional(),
    compare: z.literal("visual-and-semantic"),
    repair: z.literal("propose-recapture"),
  })
  .strict();

export const appMapTestSchema = z
  .object({
    ...appMapEntityShape,
    name: z.string(),
    kind: z.literal("scenario"),
    intentSchemaVersion: z.literal(1),
    steps: z.array(appMapScenarioTestStepSchema),
    originApplication: z.string().optional(),
    startUrl: z.string().optional(),
    family: z
      .object({
        logicalIntentRevision: z.number(),
        bindingRevision: z.number(),
        routeVariants: z.array(appMapTestRouteVariantSchema),
      })
      .strict()
      .optional(),
    nativeRouteCompanions: z
      .array(
        z
          .object({
            platform: z.enum(["android", "ios"]),
            appMapId: id,
            testId: id,
          })
          .strict(),
      )
      .optional(),
    capture: z
      .union([
        z.object({ mode: z.literal("every-screen") }).strict(),
        z.object({ mode: z.literal("checkpoints"), screenIds: z.array(id) }).strict(),
        z.object({ mode: z.literal("final-screen") }).strict(),
        z.object({ mode: z.literal("failures-only") }).strict(),
        z.object({ mode: z.literal("none") }).strict(),
      ])
      .optional(),
    startingState: appMapTestStartingStateOutputSchema.optional(),
    executionQueue: z.enum(["fast-ui", "live-output", "stateful-survival"]).optional(),
    requirementAction: z.enum(["capture-view", "test-action"]).optional(),
    surfaceBindings: z.array(scrollSurfaceTestBindingSchema).optional(),
    validation: z
      .object({
        status: z.enum(["passed", "needs-validation"]),
        appMapRevision: z.number(),
        testUpdatedAt: at,
        validatedAt: at.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
