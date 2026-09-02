import type {
  AppMapTestResolvedBinding,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  AssertionSpec,
  RecipeStep,
} from "@relay/protocol";
import { APP_MAP_TEST_INTENT_LIMITS, APP_MAP_TEST_INTENT_SCHEMA_VERSION } from "@relay/protocol";
import { BROWSER_ENGINES } from "@relay/protocol";
import { validateRecipeSteps } from "../recipes.js";
import { appMapFail } from "./errors.js";
import { assertActions, assertTarget } from "./action-validation.js";
import {
  identifier,
  objectValue,
  optionalText,
  requiredText,
  safeInteger,
  stringArray,
} from "./validation-primitives.js";

function allowedKeys(value: object, keys: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) appMapFail("invalid-map", `${label} contains unknown field ${unknown[0]}`);
}

function validateCanonicalStep(step: RecipeStep, label: string): void {
  try {
    validateRecipeSteps([step]);
  } catch (error) {
    appMapFail(
      "invalid-map",
      `${label} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertCleanup(step: AppMapScenarioTestStep, label: string): void {
  if (step.kind !== "instruction") {
    if ("cleanup" in step && step.cleanup !== undefined) {
      appMapFail("invalid-map", `${label}.cleanup is only supported on instruction steps`);
    }
    return;
  }
  if (step.cleanup === undefined) return;
  const cleanup = objectValue(step.cleanup, `${label}.cleanup`);
  allowedKeys(
    cleanup,
    ["kind", "routineId", "bindings", "terminalScreenId", "onCancel"],
    `${label}.cleanup`,
  );
  if (cleanup.kind !== "routine") {
    appMapFail("invalid-map", `${label}.cleanup.kind must be routine`);
  }
  identifier(cleanup.routineId, `${label}.cleanup.routineId`);
  identifier(cleanup.terminalScreenId, `${label}.cleanup.terminalScreenId`);
  if (cleanup.onCancel !== "run-if-controllable" && cleanup.onCancel !== "skip") {
    appMapFail("invalid-map", `${label}.cleanup.onCancel must be run-if-controllable or skip`);
  }
  if (cleanup.bindings !== undefined) {
    for (const [name, value] of Object.entries(
      objectValue(cleanup.bindings, `${label}.cleanup.bindings`),
    )) {
      identifier(name, `${label}.cleanup.bindings key`);
      if (typeof value !== "string") {
        appMapFail("invalid-map", `${label}.cleanup.bindings.${name} must be a string`);
      }
    }
  }
}

function assertBinding(step: AppMapScenarioTestStep, label: string): void {
  const binding = objectValue(step.binding, `${label}.binding`);
  if (binding.status === "unresolved") {
    allowedKeys(binding, ["status", "reason", "candidates"], `${label}.binding`);
    requiredText(binding.reason, `${label}.binding.reason`);
    if (binding.candidates !== undefined) {
      if (!Array.isArray(binding.candidates)) {
        appMapFail("invalid-map", `${label}.binding.candidates must be an array`);
      }
      if (binding.candidates.length > APP_MAP_TEST_INTENT_LIMITS.maxCandidates) {
        appMapFail("invalid-map", `${label}.binding.candidates exceeds its limit`);
      }
      for (const [index, raw] of binding.candidates.entries()) {
        const candidate = objectValue(raw, `${label}.binding.candidates[${index}]`);
        allowedKeys(candidate, ["kind", "id", "label"], `${label}.binding.candidates[${index}]`);
        if (!(["connection", "screen", "routine"] as unknown[]).includes(candidate.kind)) {
          appMapFail("invalid-map", `${label}.binding.candidates[${index}].kind is unsupported`);
        }
        identifier(candidate.id, `${label}.binding.candidates[${index}].id`);
        requiredText(candidate.label, `${label}.binding.candidates[${index}].label`);
      }
      const candidateIds = binding.candidates.map(({ id }) => id);
      if (new Set(candidateIds).size !== candidateIds.length) {
        appMapFail("duplicate-id", `${label}.binding.candidates contains duplicate ids`);
      }
    }
    return;
  }
  if (binding.status !== "resolved") {
    appMapFail("invalid-map", `${label}.binding.status is unsupported`);
  }

  switch (step.kind) {
    case "instruction":
      allowedKeys(binding, ["status", "kind", "connectionIds"], `${label}.binding`);
      if (binding.kind !== "connections")
        appMapFail("invalid-map", `${label}.binding.kind is unsupported`);
      stringArray(binding.connectionIds, `${label}.binding.connectionIds`);
      if (binding.connectionIds.length === 0)
        appMapFail("invalid-map", `${label}.binding needs a connection`);
      break;
    case "validation":
      if (binding.kind === "assertion") {
        allowedKeys(binding, ["status", "kind", "assertion"], `${label}.binding`);
        assertActions(
          [
            {
              id: `${step.id}-assertion`,
              kind: "assertion",
              assertion: binding.assertion as AssertionSpec,
            },
          ],
          `${label}.binding.assertionAction`,
        );
      } else if (binding.kind === "recipe-step") {
        allowedKeys(binding, ["status", "kind", "step"], `${label}.binding`);
        validateCanonicalStep(binding.step as RecipeStep, `${label}.binding.step`);
        if (
          !(
            [
              "expect",
              "expect-set",
              "assert-content",
              "assert-layout",
              "evaluate-semantic",
            ] as unknown[]
          ).includes(objectValue(binding.step, `${label}.binding.step`).kind)
        ) {
          appMapFail("invalid-map", `${label}.binding.step is not a validation`);
        }
      } else appMapFail("invalid-map", `${label}.binding.kind is unsupported`);
      break;
    case "extraction":
      allowedKeys(binding, ["status", "kind", "as", "target", "role"], `${label}.binding`);
      if (binding.kind !== "extract")
        appMapFail("invalid-map", `${label}.binding.kind is unsupported`);
      identifier(binding.as, `${label}.binding.as`);
      assertTarget(binding.target as never, `${label}.binding.target`);
      break;
    case "manual": {
      allowedKeys(
        binding,
        ["status", "kind", "message", "reason", "resumeLabel", "timeoutMs", "verifyAfter"],
        `${label}.binding`,
      );
      if (binding.kind !== "pause")
        appMapFail("invalid-map", `${label}.binding.kind is unsupported`);
      validateCanonicalStep(
        { kind: "pause", ...binding } as unknown as RecipeStep,
        `${label}.binding`,
      );
      break;
    }
    case "module":
      allowedKeys(binding, ["status", "kind", "routineId", "bindings"], `${label}.binding`);
      if (binding.kind !== "routine")
        appMapFail("invalid-map", `${label}.binding.kind is unsupported`);
      identifier(binding.routineId, `${label}.binding.routineId`);
      if (binding.bindings !== undefined) {
        for (const [name, value] of Object.entries(
          objectValue(binding.bindings, `${label}.binding.bindings`),
        )) {
          identifier(name, `${label}.binding.bindings key`);
          if (typeof value !== "string") {
            appMapFail("invalid-map", `${label}.binding.bindings.${name} must be a string`);
          }
        }
      }
      break;
    case "decision":
      allowedKeys(binding, ["status", "kind", "input", "operator", "expected"], `${label}.binding`);
      if (binding.kind !== "condition")
        appMapFail("invalid-map", `${label}.binding.kind is unsupported`);
      requiredText(binding.input, `${label}.binding.input`);
      if (!(["exists", "equals", "not-equals", "contains"] as unknown[]).includes(binding.operator))
        appMapFail("invalid-map", `${label}.binding.operator is unsupported`);
      break;
    case "loop":
      allowedKeys(binding, ["status", "kind", "count"], `${label}.binding`);
      if (binding.kind !== "repeat")
        appMapFail("invalid-map", `${label}.binding.kind is unsupported`);
      safeInteger(binding.count, `${label}.binding.count`);
      if (binding.count < 1 || binding.count > APP_MAP_TEST_INTENT_LIMITS.maxLoopIterations)
        appMapFail("invalid-map", `${label}.binding.count is out of bounds`);
      break;
    case "script":
      allowedKeys(binding, ["status", "kind", "source"], `${label}.binding`);
      if (binding.kind !== "script")
        appMapFail("invalid-map", `${label}.binding.kind is unsupported`);
      requiredText(
        binding.source,
        `${label}.binding.source`,
        APP_MAP_TEST_INTENT_LIMITS.maxScriptLength,
      );
      validateCanonicalStep(
        { kind: "script", source: binding.source } as RecipeStep,
        `${label}.binding`,
      );
      break;
  }
}

function assertSteps(
  steps: AppMapScenarioTestStep[],
  label: string,
  seen: Set<string>,
  depth: number,
  count: { value: number },
): void {
  if (!Array.isArray(steps)) appMapFail("invalid-map", `${label} must be an array`);
  if (depth > APP_MAP_TEST_INTENT_LIMITS.maxDepth)
    appMapFail("invalid-map", `${label} exceeds nesting depth`);
  for (const [index, step] of steps.entries()) {
    const item = `${label}[${index}]`;
    objectValue(step, item);
    identifier(step.id, `${item}.id`);
    if (seen.has(step.id))
      appMapFail("duplicate-id", `${label} contains duplicate step ${step.id}`);
    seen.add(step.id);
    count.value += 1;
    if (count.value > APP_MAP_TEST_INTENT_LIMITS.maxSteps)
      appMapFail("invalid-map", `${label} exceeds its step limit`);
    requiredText(step.intent, `${item}.intent`, APP_MAP_TEST_INTENT_LIMITS.maxIntentLength);
    optionalText(step.note, `${item}.note`, APP_MAP_TEST_INTENT_LIMITS.maxNoteLength);
    if (step.capture !== undefined && typeof step.capture !== "boolean") {
      appMapFail("invalid-map", `${item}.capture must be a boolean`);
    }
    if (step.execution !== undefined) {
      const execution = objectValue(step.execution, `${item}.execution`);
      allowedKeys(
        execution,
        ["status", "reason", "repairTargetId", "decidedBy", "decidedAt"],
        `${item}.execution`,
      );
      if (execution.status !== "disabled") {
        appMapFail("invalid-map", `${item}.execution.status must be disabled`);
      }
      requiredText(execution.reason, `${item}.execution.reason`);
      identifier(execution.repairTargetId, `${item}.execution.repairTargetId`);
      requiredText(execution.decidedBy, `${item}.execution.decidedBy`);
      safeInteger(execution.decidedAt, `${item}.execution.decidedAt`);
    }
    if (
      !(
        [
          "instruction",
          "validation",
          "extraction",
          "manual",
          "module",
          "decision",
          "loop",
          "script",
        ] as unknown[]
      ).includes(step.kind)
    )
      appMapFail("invalid-map", `${item}.kind is unsupported`);
    const nested =
      step.kind === "decision" ? ["thenSteps", "elseSteps"] : step.kind === "loop" ? ["steps"] : [];
    allowedKeys(
      step,
      ["id", "kind", "intent", "note", "capture", "execution", "cleanup", "binding", ...nested],
      item,
    );
    assertBinding(step, item);
    assertCleanup(step, item);
    if (step.kind === "decision") {
      assertSteps(step.thenSteps, `${item}.thenSteps`, seen, depth + 1, count);
      if (step.elseSteps) assertSteps(step.elseSteps, `${item}.elseSteps`, seen, depth + 1, count);
      if (
        step.thenSteps.length + (step.elseSteps?.length ?? 0) >
        APP_MAP_TEST_INTENT_LIMITS.maxBranches
      )
        appMapFail("invalid-map", `${item} has too many branch steps`);
    } else if (step.kind === "loop") {
      assertSteps(step.steps, `${item}.steps`, seen, depth + 1, count);
    }
  }
}

function indexedSteps(
  steps: AppMapScenarioTestStep[],
  indexed = new Map<string, AppMapScenarioTestStep>(),
): Map<string, AppMapScenarioTestStep> {
  for (const step of steps) {
    indexed.set(step.id, step);
    if (step.kind === "decision") {
      indexedSteps(step.thenSteps, indexed);
      if (step.elseSteps) indexedSteps(step.elseSteps, indexed);
    } else if (step.kind === "loop") {
      indexedSteps(step.steps, indexed);
    }
  }
  return indexed;
}

function assertFamily(test: AppMapScenarioTest, label: string): void {
  if (test.family === undefined) return;
  const family = objectValue(test.family, `${label}.family`);
  allowedKeys(
    family,
    ["logicalIntentRevision", "bindingRevision", "routeVariants"],
    `${label}.family`,
  );
  for (const field of ["logicalIntentRevision", "bindingRevision"] as const) {
    safeInteger(family[field], `${label}.family.${field}`);
    if (family[field] === 0) appMapFail("invalid-map", `${label}.family.${field} must be positive`);
  }
  if (!Array.isArray(family.routeVariants) || family.routeVariants.length === 0) {
    appMapFail("invalid-map", `${label}.family.routeVariants must contain a variant`);
  }
  const steps = indexedSteps(test.steps);
  const requiredRouteStepIds = [...steps.values()]
    .filter((step) => step.kind === "instruction" || step.kind === "module")
    .map((step) => step.id)
    .sort();
  const variantIds = new Set<string>();
  const capabilities = new Set([
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
  family.routeVariants.forEach((raw, index) => {
    const item = `${label}.family.routeVariants[${index}]`;
    const variant = objectValue(raw, item);
    allowedKeys(
      variant,
      ["id", "revision", "predicate", "bindings", "reviewedAt", "reviewedBy"],
      item,
    );
    identifier(variant.id, `${item}.id`);
    if (variantIds.has(variant.id))
      appMapFail("duplicate-id", `${label}.family.routeVariants contains duplicate ${variant.id}`);
    variantIds.add(variant.id);
    safeInteger(variant.revision, `${item}.revision`);
    if (variant.revision === 0) appMapFail("invalid-map", `${item}.revision must be positive`);
    safeInteger(variant.reviewedAt, `${item}.reviewedAt`);
    requiredText(variant.reviewedBy, `${item}.reviewedBy`);
    const predicate = objectValue(variant.predicate, `${item}.predicate`);
    allowedKeys(
      predicate,
      ["platforms", "browserEngines", "viewportClasses", "requiredCapabilities"],
      `${item}.predicate`,
    );
    const dimensions = [
      ["platforms", new Set(["android", "ios", "browser"])],
      ["browserEngines", new Set(BROWSER_ENGINES)],
      ["viewportClasses", new Set(["compact", "medium", "expanded"])],
      ["requiredCapabilities", capabilities],
    ] as const;
    for (const [field, allowed] of dimensions) {
      if (predicate[field] === undefined) continue;
      stringArray(predicate[field], `${item}.predicate.${field}`);
      if (predicate[field].length === 0)
        appMapFail("invalid-map", `${item}.predicate.${field} cannot be empty`);
      if (new Set(predicate[field]).size !== predicate[field].length)
        appMapFail("duplicate-id", `${item}.predicate.${field} contains duplicates`);
      if (predicate[field].some((value) => !allowed.has(value as never)))
        appMapFail("invalid-map", `${item}.predicate.${field} contains an unsupported value`);
    }
    const bindings = objectValue(variant.bindings, `${item}.bindings`);
    if (Object.keys(bindings).length === 0)
      appMapFail("invalid-map", `${item}.bindings must override at least one Test step`);
    for (const [stepId, binding] of Object.entries(bindings)) {
      identifier(stepId, `${item}.bindings key`);
      const step = steps.get(stepId);
      if (!step) appMapFail("invalid-map", `${item}.bindings references unknown step ${stepId}`);
      const resolved = objectValue(binding, `${item}.bindings.${stepId}`);
      if (resolved.status !== "resolved")
        appMapFail("invalid-map", `${item}.bindings.${stepId} must be resolved`);
      assertBinding(
        { ...step, binding: resolved as AppMapTestResolvedBinding } as AppMapScenarioTestStep,
        `${item}.bindings.${stepId}`,
      );
    }
    const missingRouteStepIds = requiredRouteStepIds.filter((stepId) => !(stepId in bindings));
    if (missingRouteStepIds.length) {
      appMapFail(
        "invalid-map",
        `${item}.bindings must implement every route step; missing ${missingRouteStepIds.join(", ")}`,
      );
    }
  });
}

export function assertScenarioTest(test: AppMapScenarioTest, label: string): void {
  objectValue(test, label);
  allowedKeys(
    test,
    [
      "id",
      "organizationId",
      "projectId",
      "appMapId",
      "name",
      "kind",
      "intentSchemaVersion",
      "steps",
      "family",
      "capture",
      "surfaceBindings",
      "createdAt",
      "updatedAt",
    ],
    label,
  );
  identifier(test.id, `${label}.id`);
  identifier(test.organizationId, `${label}.organizationId`);
  identifier(test.projectId, `${label}.projectId`);
  identifier(test.appMapId, `${label}.appMapId`);
  requiredText(test.name, `${label}.name`);
  if (test.kind !== "scenario") appMapFail("invalid-map", `${label}.kind must be scenario`);
  if (test.intentSchemaVersion !== APP_MAP_TEST_INTENT_SCHEMA_VERSION) {
    appMapFail("invalid-map", `${label}.intentSchemaVersion is unsupported`);
  }
  if (test.capture !== undefined) {
    const capture = objectValue(test.capture, `${label}.capture`);
    allowedKeys(capture, ["mode", "screenIds"], `${label}.capture`);
    if (
      !("mode" in capture) ||
      !(
        ["every-screen", "checkpoints", "final-screen", "failures-only", "none"] as unknown[]
      ).includes(capture.mode)
    ) {
      appMapFail("invalid-map", `${label}.capture.mode is unsupported`);
    }
    if (capture.mode === "checkpoints") {
      stringArray(capture.screenIds, `${label}.capture.screenIds`);
      if (capture.screenIds.length === 0) {
        appMapFail("invalid-map", `${label}.capture.screenIds must contain a screen`);
      }
    } else if (capture.screenIds !== undefined) {
      appMapFail("invalid-map", `${label}.capture.screenIds is only valid for checkpoints`);
    }
  }
  if (test.surfaceBindings !== undefined) {
    if (!Array.isArray(test.surfaceBindings) || test.surfaceBindings.length > 50) {
      appMapFail("invalid-map", `${label}.surfaceBindings must be an array of at most 50 items`);
    }
    const seen = new Set<string>();
    test.surfaceBindings.forEach((binding, index) => {
      const item = `${label}.surfaceBindings[${index}]`;
      objectValue(binding, item);
      allowedKeys(
        binding,
        [
          "screenId",
          "variantId",
          "captureMode",
          "reason",
          "surfaceId",
          "baselineCaptureId",
          "compare",
          "repair",
        ],
        item,
      );
      identifier(binding.screenId, `${item}.screenId`);
      identifier(binding.variantId, `${item}.variantId`);
      requiredText(binding.reason, `${item}.reason`, 512);
      if (binding.compare !== "visual-and-semantic" || binding.repair !== "propose-recapture") {
        appMapFail("invalid-map", `${item} comparison or repair policy is unsupported`);
      }
      const key = `${binding.screenId}\0${binding.variantId}`;
      if (seen.has(key)) appMapFail("duplicate-id", `${item} duplicates a surface binding`);
      seen.add(key);
      if (binding.captureMode === "full-surface") {
        identifier(binding.surfaceId ?? "", `${item}.surfaceId`);
        identifier(binding.baselineCaptureId ?? "", `${item}.baselineCaptureId`);
      } else if (binding.captureMode !== "viewport") {
        appMapFail("invalid-map", `${item}.captureMode is unsupported`);
      } else if (binding.surfaceId !== undefined || binding.baselineCaptureId !== undefined) {
        appMapFail("invalid-map", `${item} viewport bindings cannot pin a full-surface baseline`);
      }
    });
  }
  assertSteps(test.steps, `${label}.steps`, new Set(), 0, { value: 0 });
  assertFamily(test, label);
}
