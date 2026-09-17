import * as z from "zod/v4";
import {
  authoringTarget,
  identifier,
  natural,
  text,
  stepTarget,
} from "./operation-schema-primitives.js";
import { nativeRouteCompanions } from "./app-map-native-route-companion-schema.js";
import { appMapTestStartingStateSchema } from "./routine-effects.js";
import { executionQueueSchema } from "./execution-queue.js";
import { repeatPilotSpecSchema, repeatSpecSchema } from "./repeat-spec.js";

const requirementActionKind = z
  .enum(["capture-view", "test-action"])
  .describe(
    "capture-view may leftover-skip dest chrome (GQA-004 attach, GQA-040 settings). test-action must execute the named opener. Omitted dest-end stays test-action.",
  );

const forceRecaptureScreenIds = z
  .array(identifier("Full-surface screen identifier to recapture"))
  .min(1)
  .max(50)
  .superRefine((screenIds, context) => {
    if (new Set(screenIds).size === screenIds.length) return;
    context.addIssue({
      code: "custom",
      message: "forceRecaptureScreenIds must not repeat a screen identifier",
    });
  });

export const repeatWorkflowMutationSchema = z
  .object({
    schemaVersion: z.literal(1),
    workflowId: identifier("Durable Repeat workflow identifier"),
    transitionVersion: z.number().int().positive(),
    action: z.enum(["repeat-pilot", "repeat-resume", "repeat-cancel"]),
    completedAt: z.number().int().nonnegative(),
  })
  .strict();

const shaPattern = /^[0-9a-f]{7,40}$/;
export const sourceRevisionSchema = z
  .object({
    vcs: z.literal("git"),
    sha: z.string().regex(shaPattern, "must be 7-40 lowercase hex characters"),
    prNumber: z.number().int().positive().optional(),
    branch: text("Branch name").optional(),
    artifactDigest: text("Built artifact digest").optional(),
    buildId: identifier("Registered build or deployment identity").optional(),
  })
  .strict()
  .describe("Immutable commit/build identity frozen with the run as audit-grade evidence");

/** The offline preview and the queued run share one evidence-scope vocabulary.
 * Keeping it here makes every transport as strict as the protocol contract,
 * rather than silently dropping a selected profile at a presentation boundary. */
const testRunLaneOverlayKeys = [
  "expectedRevision",
  "target",
  "targetProfileId",
  "engine",
  "account",
] as const;

export const appMapTestRunInputSchema = z
  .object({
    appMapId: identifier("App Map identifier"),
    testId: identifier("Graph-native Test identifier"),
    laneId: identifier("Saved Lane whose overlay the server applies").optional(),
    expectedRevision: natural("Exact saved App Map revision to run").optional(),
    target: authoringTarget.describe("Explicit device or managed browser target").optional(),
    targetProfileId: identifier(
      "Saved runtime evidence profile, or ios/android to run a linked native companion Test",
    ).optional(),
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
        z.object({ kind: z.literal("signed-out"), attested: z.literal(true) }).strict(),
      ])
      .optional(),
    surfaceCapture: z
      .object({ forceRecaptureScreenIds })
      .strict()
      .optional()
      .describe("Run-only full-surface recapture policy"),
    startup: z
      .discriminatedUnion("mode", [
        z.object({ mode: z.literal("cold") }).strict(),
        z
          .object({
            mode: z.literal("verified-checkpoint"),
            screenId: identifier("Mapped screen identifier to prove before the suffix runs"),
          })
          .strict(),
      ])
      .optional()
      .describe(
        "Explicit startup policy. A checkpoint mismatch stops for review; it never falls back to a cold relaunch.",
      ),
    in: z
      .record(
        identifier("Variable identifier"),
        z.array(identifier("Variable value identifier")).min(1),
      )
      .optional()
      .describe(
        "Variable id → selected value ids. Upserts a Combine for this Test × those worlds and starts a campaign.",
      ),
    strategy: z.enum(["zip", "cartesian", "pairwise"]).optional(),
    pilotCase: z
      .record(identifier("Repeat dimension identifier"), identifier("Repeat value identifier"))
      .optional(),
    lens: z
      .enum(["visual", "smoke", "every-screen", "failures-only", "final-screen", "none"])
      .optional()
      .describe("Capture lens. visual is every-screen; smoke is failures-only."),
    executionMode: z.enum(["pilot", "all"]).optional(),
    cell: identifier("World or Combine cell selector").optional(),
    sourceRevision: sourceRevisionSchema.optional(),
    workflowRequestId: identifier("Durable outcome-workflow request identifier").optional(),
    repeatRecovery: z
      .object({
        schemaVersion: z.literal(1),
        testPlanDigest: text("Frozen Test plan digest"),
        spec: repeatSpecSchema,
        resolved: z
          .object({
            dimensions: z
              .array(
                z
                  .object({
                    id: identifier("Repeat dimension identifier"),
                    valueIds: z.array(identifier("Repeat value identifier")).min(1),
                  })
                  .strict(),
              )
              .min(1),
            strategy: z.enum(["cartesian", "zip", "pairwise"]),
            pilot: repeatPilotSpecSchema,
            resume: z.enum(["untouched", "failed", "all"]),
          })
          .strict(),
        workflowMutation: repeatWorkflowMutationSchema.optional(),
      })
      .strict()
      .optional()
      .describe("Internal adoption identity for an outcome-level Repeat workflow"),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.laneId) {
      for (const key of testRunLaneOverlayKeys) {
        if (input[key] !== undefined) {
          context.addIssue({
            code: "custom",
            message: `${key} is filled from Lane ${input.laneId}; omit it`,
            path: [key],
          });
        }
      }
    } else {
      if (input.expectedRevision === undefined) {
        context.addIssue({
          code: "custom",
          message: "expectedRevision is required unless laneId is set",
          path: ["expectedRevision"],
        });
      }
      if (input.target === undefined) {
        context.addIssue({
          code: "custom",
          message: "target is required unless laneId is set",
          path: ["target"],
        });
      }
    }
    if (input.in === undefined) return;
    if (input.repeatRecovery) {
      const requestedIds = input.repeatRecovery.resolved.dimensions.map((item) => item.id);
      if (
        requestedIds.length !== Object.keys(input.in).length ||
        requestedIds.some((id, index) => id !== Object.keys(input.in!)[index] || !input.in![id])
      ) {
        context.addIssue({
          code: "custom",
          message: "repeatRecovery dimensions must match the ordered resolved selection",
          path: ["repeatRecovery", "resolved", "dimensions"],
        });
      }
      if (input.strategy !== input.repeatRecovery.resolved.strategy) {
        context.addIssue({
          code: "custom",
          message: "strategy must match the frozen Repeat strategy",
          path: ["strategy"],
        });
      }
      for (const [index, dimension] of input.repeatRecovery.resolved.dimensions.entries()) {
        if (new Set(dimension.valueIds).size !== dimension.valueIds.length) {
          context.addIssue({
            code: "custom",
            message: "resolved Repeat values must be unique",
            path: ["repeatRecovery", "resolved", "dimensions", index, "valueIds"],
          });
        }
        const selected = input.in[dimension.id] ?? [];
        if (
          selected.length !== dimension.valueIds.length ||
          selected.some((id, valueIndex) => id !== dimension.valueIds[valueIndex])
        ) {
          context.addIssue({
            code: "custom",
            message: "in must match the ordered frozen Repeat values",
            path: ["in", dimension.id],
          });
        }
      }
      const pilot = input.repeatRecovery.resolved.pilot;
      if (pilot.mode === "specified") {
        if (
          !input.pilotCase ||
          Object.keys(input.pilotCase).length !== requestedIds.length ||
          requestedIds.some((id) => input.pilotCase?.[id] !== pilot.case[id])
        ) {
          context.addIssue({
            code: "custom",
            message: "pilotCase must match the frozen specified Repeat pilot",
            path: ["pilotCase"],
          });
        }
      } else if (input.pilotCase !== undefined) {
        context.addIssue({
          code: "custom",
          message: "pilotCase requires a specified Repeat pilot",
          path: ["pilotCase"],
        });
      }
    }
    if (input.startup !== undefined) {
      context.addIssue({
        code: "custom",
        message: "startup cannot be combined with in; run the Test once or omit startup",
        path: ["startup"],
      });
    }
    const entries = Object.entries(input.in);
    if (!entries.length) {
      context.addIssue({
        code: "custom",
        message: "in must name at least one Variable",
        path: ["in"],
      });
      return;
    }
    for (const [variableId, valueIds] of entries) {
      if (new Set(valueIds).size !== valueIds.length) {
        context.addIssue({
          code: "custom",
          message: `in.${variableId} must not repeat a value identifier`,
          path: ["in", variableId],
        });
      }
    }
  });

export const appMapTestCompileInputSchema = z
  .object({
    appMapId: identifier("App Map identifier"),
    testId: identifier("Graph-native Test identifier"),
    entryCheckpointScreenId: identifier(
      "Optional mapped screen identifier to compile as a verified live checkpoint",
    ).optional(),
    startupMode: z.enum(["warm", "cold"]).optional(),
    targetProfileId: identifier(
      "Saved runtime evidence profile, or ios/android to compile a linked native companion Test",
    ).optional(),
    forceRecaptureScreenIds: forceRecaptureScreenIds.optional(),
  })
  .strict();

const testStepPlacement = z.union([
  z
    .object({
      branch: z.literal("root").optional(),
    })
    .strict(),
  z
    .object({
      parentStepId: identifier("Stable parent Test step identifier"),
      branch: z.enum(["then", "else", "steps"]),
    })
    .strict(),
]);

export const testCapturePolicy = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("every-screen") }).strict(),
  z
    .object({
      mode: z.literal("checkpoints"),
      screenIds: z.array(identifier("Checkpoint screen identifier")).min(1),
    })
    .strict(),
  z.object({ mode: z.literal("final-screen") }).strict(),
  z.object({ mode: z.literal("failures-only") }).strict(),
  z.object({ mode: z.literal("none") }).strict(),
]);

const testBindingCandidate = z
  .object({
    kind: z.enum(["connection", "screen", "routine"]),
    id: identifier("Candidate entity identifier"),
    label: text("Candidate label"),
  })
  .strict();

const unresolvedTestBinding = z
  .object({
    status: z.literal("unresolved"),
    reason: text("Why this Test step is not bound"),
    candidates: z.array(testBindingCandidate).max(12).optional(),
  })
  .strict()
  .superRefine((binding, context) => {
    if (!binding.candidates) return;
    const ids = binding.candidates.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Binding candidates must use unique entity IDs",
        path: ["candidates"],
      });
    }
  });

const assertionSpec = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("screen"), screenId: identifier("Expected screen identifier") })
    .strict(),
  z
    .object({
      kind: z.literal("target"),
      target: stepTarget,
      condition: z.enum(["visible", "gone"]),
      timeoutMs: natural("Optional assertion timeout in milliseconds").optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("layout"),
      relation: z.literal("non-overlap"),
      first: stepTarget,
      second: stepTarget,
      timeoutMs: natural("Optional assertion timeout in milliseconds").optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("content"),
      input: text("Observed or extracted value"),
      expected: z.string(),
      match: z.enum(["exact", "equals", "contains", "not-contains", "number-equals", "field"]),
      field: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("visual"),
      criteria: z.array(text("Visual criterion")).min(1).max(20),
      requireAgreement: z.boolean().optional(),
      provider: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      secondProvider: z.string().min(1).optional(),
      secondModel: z.string().min(1).optional(),
      region: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("semantic"),
      input: text("Extracted or observed reply to judge"),
      criteria: z.array(text("Semantic criterion")).min(1).max(20),
      requireAgreement: z.boolean().optional(),
      provider: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      secondProvider: z.string().min(1).optional(),
      secondModel: z.string().min(1).optional(),
    })
    .strict(),
]);

const validationRecipeStep = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("expect"),
      target: stepTarget,
      condition: z.enum(["visible", "gone"]),
      timeoutMs: natural("Optional assertion timeout in milliseconds").optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("expect-set"),
      identifierPrefix: z.string().min(1).optional(),
      scope: stepTarget.optional(),
      labels: z.array(z.string()).min(1),
      timeoutMs: natural("Optional assertion timeout in milliseconds").optional(),
      extras: z.enum(["forbid", "allow"]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("assert-content"),
      input: text("Observed or extracted value"),
      expected: z.string(),
      match: z.enum(["exact", "equals", "contains", "not-contains", "number-equals", "field"]),
      field: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("assert-layout"),
      relation: z.literal("non-overlap"),
      first: stepTarget,
      second: stepTarget,
      timeoutMs: natural("Optional assertion timeout in milliseconds").optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("wait-response"),
      target: stepTarget,
      busyTarget: stepTarget.optional(),
      idleTarget: stepTarget.optional(),
      timeoutMs: natural("Optional response timeout in milliseconds")
        .min(1_000)
        .max(900_000)
        .optional(),
      stableForMs: natural("Optional response stability window in milliseconds")
        .min(500)
        .max(30_000)
        .optional(),
      maxMs: natural("Optional maximum acceptable response duration in milliseconds")
        .min(1)
        .max(900_000)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("extract"),
      as: text("Variable name for the remembered reply"),
      target: stepTarget,
      role: z.enum(["user", "assistant", "system"]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("evaluate-semantic"),
      input: text("Observed or extracted value"),
      criteria: z.array(text("Semantic criterion")).min(1).max(20),
      threshold: z.number().min(0).max(1).optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
      requireAgreement: z.boolean().optional(),
      secondProvider: z.string().optional(),
      secondModel: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("evaluate-visual"),
      criteria: z.array(text("Visual criterion")).min(1).max(20),
      threshold: z.number().min(0).max(1).optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
      requireAgreement: z.boolean().optional(),
      secondProvider: z.string().optional(),
      secondModel: z.string().optional(),
      region: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("identity-ignore"),
      region: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .strict(),
      name: text("Human name for the ignored region").optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("screenshot"),
      caption: z.string().optional(),
      review: z
        .object({
          mode: z.literal("later"),
          lookFor: z.string().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);

const instructionBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("connections"),
      connectionIds: z.array(identifier("Connection identifier")).min(1),
    })
    .strict(),
]);
const validationBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("assertion"),
      assertion: assertionSpec,
    })
    .strict(),
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("recipe-step"),
      step: validationRecipeStep,
    })
    .strict(),
]);
const extractionBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("extract"),
      as: identifier("Extraction variable name"),
      target: stepTarget,
      role: z.enum(["user", "assistant", "system"]).optional(),
    })
    .strict(),
]);
const manualBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("pause"),
      message: text("Human checkpoint message"),
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
      timeoutMs: natural("Optional checkpoint timeout in milliseconds").optional(),
      verifyAfter: z
        .object({
          target: stepTarget,
          condition: z.enum(["visible", "gone"]).optional(),
          timeoutMs: natural("Optional verification timeout in milliseconds").optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);
const moduleBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("routine"),
      routineId: identifier("Routine identifier"),
      bindings: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
]);
const decisionBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("condition"),
      input: text("Value used by the condition"),
      operator: z.enum(["exists", "equals", "not-equals", "contains"]),
      expected: z.string().optional(),
    })
    .strict(),
]);
const loopBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("repeat"),
      count: z.number().int().min(1).max(20),
    })
    .strict(),
]);
const scriptBinding = z.union([
  unresolvedTestBinding,
  z
    .object({
      status: z.literal("resolved"),
      kind: z.literal("script"),
      source: text("Canonical Relay script source").max(20_000),
    })
    .strict(),
]);

const anyTestBinding = z.union([
  instructionBinding,
  validationBinding,
  extractionBinding,
  manualBinding,
  moduleBinding,
  decisionBinding,
  loopBinding,
  scriptBinding,
]);

const resolvedRouteBinding = anyTestBinding.refine(
  (binding) => binding.status === "resolved",
  "Route variants require resolved bindings",
);

const testSurfacePredicate = z
  .object({
    platforms: z
      .array(z.enum(["android", "ios", "browser"]))
      .min(1)
      .optional(),
    browserEngines: z
      .array(z.enum(["chromium", "firefox", "webkit"]))
      .min(1)
      .optional(),
    viewportClasses: z
      .array(z.enum(["compact", "medium", "expanded"]))
      .min(1)
      .optional(),
    requiredCapabilities: z
      .array(
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
      )
      .min(1)
      .optional(),
  })
  .strict();

const testFamily = z
  .object({
    logicalIntentRevision: z.number().int().positive(),
    bindingRevision: z.number().int().positive(),
    routeVariants: z
      .array(
        z
          .object({
            id: identifier("Route variant identifier"),
            revision: z.number().int().positive(),
            predicate: testSurfacePredicate,
            bindings: z.record(identifier("Stable Test step identifier"), resolvedRouteBinding),
            reviewedAt: z.number().int().nonnegative(),
            reviewedBy: text("Route variant reviewer"),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const testStepBase = {
  id: identifier("Stable Test step identifier"),
  intent: text("Human-readable Test step intent").max(2_000),
  note: z.string().max(4_000).optional(),
  capture: z.boolean().optional().describe("Capture one evidence frame after this step completes"),
};

const graphTestStep: z.ZodType = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .object({ ...testStepBase, kind: z.literal("instruction"), binding: instructionBinding })
      .strict(),
    z
      .object({ ...testStepBase, kind: z.literal("validation"), binding: validationBinding })
      .strict(),
    z
      .object({ ...testStepBase, kind: z.literal("extraction"), binding: extractionBinding })
      .strict(),
    z.object({ ...testStepBase, kind: z.literal("manual"), binding: manualBinding }).strict(),
    z.object({ ...testStepBase, kind: z.literal("module"), binding: moduleBinding }).strict(),
    z
      .object({
        ...testStepBase,
        kind: z.literal("decision"),
        binding: decisionBinding,
        thenSteps: z.array(graphTestStep),
        elseSteps: z.array(graphTestStep).optional(),
      })
      .strict(),
    z
      .object({
        ...testStepBase,
        kind: z.literal("loop"),
        binding: loopBinding,
        steps: z.array(graphTestStep),
      })
      .strict(),
    z.object({ ...testStepBase, kind: z.literal("script"), binding: scriptBinding }).strict(),
  ]),
);

export const graphTest = z
  .object({
    name: text("Test name"),
    kind: z.literal("scenario"),
    intentSchemaVersion: z.literal(1),
    originApplication: z.string().trim().min(1).optional(),
    startingState: appMapTestStartingStateSchema.optional(),
    executionQueue: executionQueueSchema.optional(),
    requirementAction: requirementActionKind.optional(),
    steps: z.array(graphTestStep).max(200),
    family: testFamily.optional(),
    nativeRouteCompanions: nativeRouteCompanions.optional(),
    capture: testCapturePolicy.optional(),
    validation: z
      .object({
        status: z.enum(["passed", "needs-validation"]),
        appMapRevision: z.number().int().nonnegative(),
        testUpdatedAt: z.number().int().nonnegative(),
        validatedAt: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((test, context) => {
    let stepCount = 0;
    const stepIds = new Set<string>();
    const visit = (steps: unknown[], depth: number, path: (string | number)[]) => {
      if (depth > 3) {
        context.addIssue({
          code: "custom",
          message: "Graph Test nesting cannot exceed depth 3",
          path,
        });
        return;
      }
      steps.forEach((value, index) => {
        stepCount += 1;
        const step = value as Record<string, unknown>;
        if (typeof step.id === "string") {
          if (stepIds.has(step.id)) {
            context.addIssue({
              code: "custom",
              message: `Graph Test contains duplicate step ID ${step.id}`,
              path: [...path, index, "id"],
            });
          }
          stepIds.add(step.id);
        }
        if (step.kind === "decision") {
          const thenSteps = Array.isArray(step.thenSteps) ? step.thenSteps : [];
          const elseSteps = Array.isArray(step.elseSteps) ? step.elseSteps : [];
          if (thenSteps.length + elseSteps.length > 8) {
            context.addIssue({
              code: "custom",
              message: "A decision cannot contain more than 8 direct branch steps",
              path: [...path, index],
            });
          }
          visit(thenSteps, depth + 1, [...path, index, "thenSteps"]);
          visit(elseSteps, depth + 1, [...path, index, "elseSteps"]);
        } else if (step.kind === "loop") {
          visit(Array.isArray(step.steps) ? step.steps : [], depth + 1, [...path, index, "steps"]);
        }
      });
    };
    visit(test.steps, 0, ["steps"]);
    if (stepCount > 200) {
      context.addIssue({
        code: "custom",
        message: "A graph Test cannot contain more than 200 total steps",
        path: ["steps"],
      });
    }
  });

const testSemanticEdit = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("test.patch"),
      patch: z
        .object({
          name: text("New Test name").optional(),
          capture: testCapturePolicy.nullable().optional(),
          family: testFamily.nullable().optional(),
          nativeRouteCompanions: nativeRouteCompanions.nullable().optional(),
          startingState: appMapTestStartingStateSchema.nullable().optional(),
          executionQueue: executionQueueSchema.nullable().optional(),
          requirementAction: requirementActionKind.nullable().optional(),
        })
        .strict()
        .refine((patch) => Object.keys(patch).length > 0, "Test patch must change a field"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("step.add"),
      step: graphTestStep.describe("Complete graph-native Test step with a new stable id"),
      placement: testStepPlacement.optional(),
      index: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("step.patch"),
      stepId: identifier("Stable Test step identifier"),
      patch: z
        .object({
          intent: text("Human-readable step intent").optional(),
          note: z.string().nullable().optional(),
          capture: z.boolean().optional(),
          binding: anyTestBinding.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("step.remove"),
      stepId: identifier("Stable Test step identifier"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("step.reorder"),
      orderedStepIds: z.array(identifier("Stable sibling Test step identifier")),
      placement: testStepPlacement.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("step.bind"),
      stepId: identifier("Stable Test step identifier"),
      binding: anyTestBinding
        .refine((binding) => binding.status === "resolved", "step.bind requires a resolved binding")
        .describe("Resolved canonical binding"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("step.unbind"),
      stepId: identifier("Stable Test step identifier"),
      reason: text("Why the binding is unresolved"),
      candidates: z.array(testBindingCandidate).max(12).optional(),
    })
    .strict(),
]);

export const testSemanticEdits = z
  .array(testSemanticEdit)
  .min(1)
  .max(100)
  .describe("Ordered atomic stable-ID Test edits");
