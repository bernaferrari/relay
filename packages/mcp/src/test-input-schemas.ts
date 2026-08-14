import * as z from "zod/v4";

const text = (description: string) => z.string().min(1).describe(description);
const natural = (description: string) => z.number().nonnegative().describe(description);
const identifier = (description: string) => text(description);
const point = z
  .object({
    x: z.number(),
    y: z.number(),
    anchor: z
      .object({
        horizontal: z.enum(["left", "center", "right"]),
        vertical: z.enum(["top", "center", "bottom"]),
      })
      .strict()
      .optional(),
    referenceBounds: z
      .object({ width: z.number().positive(), height: z.number().positive() })
      .strict()
      .optional(),
  })
  .strict();

const stepTarget = z
  .object({
    identifier: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    point: point.optional(),
  })
  .strict()
  .refine(
    ({ identifier, ref, label, text: targetText, point: targetPoint }) =>
      Boolean(identifier || ref || label || targetText || targetPoint),
    "Target needs an identifier, ref, label, text, or point",
  )
  .describe("Semantic selector, accessibility reference, or point");

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
      kind: z.literal("content"),
      input: text("Observed or extracted value"),
      expected: z.string(),
      match: z.enum(["exact", "contains", "not-contains"]),
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
    })
    .strict(),
  z
    .object({
      kind: z.literal("assert-content"),
      input: text("Observed or extracted value"),
      expected: z.string(),
      match: z.enum(["exact", "contains", "not-contains"]),
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

const testStepBase = {
  id: identifier("Stable Test step identifier"),
  intent: text("Human-readable Test step intent").max(2_000),
  note: z.string().max(4_000).optional(),
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
    steps: z.array(graphTestStep).max(200),
    capture: testCapturePolicy.optional(),
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

export const legacyTest = z
  .object({
    name: text("Test name"),
    kind: z.enum(["path", "tour"]),
    flowId: identifier("Flow identifier").optional(),
    rootScreenId: identifier("Tour root screen identifier").optional(),
    setupFlowId: identifier("Optional setup Flow identifier").optional(),
    screenIds: z.array(identifier("Mapped tour screen identifier")).optional(),
    optionalScreenIds: z.array(identifier("Optional mapped tour screen identifier")).optional(),
    depth: z.number().int().min(0).optional(),
    capture: testCapturePolicy.optional(),
    screenshotEach: z.boolean().optional(),
  })
  .strict();

const testSemanticEdit = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("test.patch"),
      patch: z
        .object({
          name: text("New Test name").optional(),
          capture: testCapturePolicy.nullable().optional(),
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
