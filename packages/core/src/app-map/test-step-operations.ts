import type {
  AppMapScenarioTestEdit,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
  AppMapTestBindingCandidate,
  AppMapTestStepBranch,
  AppMapTestStepPatch,
  AppMapTestStepPlacement,
} from "@relay/protocol";
import { assertScenarioTest } from "./test-intent-validation.js";

export type {
  AppMapScenarioTestEdit,
  AppMapTestStepBranch,
  AppMapTestStepPatch,
  AppMapTestStepPlacement,
} from "@relay/protocol";

export type AppMapTestStepLocation = {
  step: AppMapScenarioTestStep;
  parentStepId?: string;
  branch: AppMapTestStepBranch;
  index: number;
  /** Stable IDs from the outermost parent to the immediate parent. */
  ancestorStepIds: string[];
};

export type AppMapTestStepOperationErrorCode =
  | "step-not-found"
  | "parent-not-found"
  | "invalid-parent"
  | "invalid-branch"
  | "step-id-conflict"
  | "invalid-index"
  | "invalid-patch"
  | "invalid-binding"
  | "incomplete-order";

export class AppMapTestStepOperationError extends Error {
  readonly code: AppMapTestStepOperationErrorCode;
  readonly editIndex?: number;

  constructor(code: AppMapTestStepOperationErrorCode, message: string, editIndex?: number) {
    super(message);
    this.name = "AppMapTestStepOperationError";
    this.code = code;
    this.editIndex = editIndex;
  }
}

function fail(code: AppMapTestStepOperationErrorCode, message: string): never {
  throw new AppMapTestStepOperationError(code, message);
}

function nestedBranches(
  step: AppMapScenarioTestStep,
): Array<{ branch: Exclude<AppMapTestStepBranch, "root">; steps: AppMapScenarioTestStep[] }> {
  if (step.kind === "decision") {
    return [
      { branch: "then", steps: step.thenSteps },
      ...(step.elseSteps ? [{ branch: "else" as const, steps: step.elseSteps }] : []),
    ];
  }
  return step.kind === "loop" ? [{ branch: "steps", steps: step.steps }] : [];
}

function findInSteps(
  steps: AppMapScenarioTestStep[],
  stepId: string,
  parentStepId: string | undefined,
  branch: AppMapTestStepBranch,
  ancestors: string[],
): AppMapTestStepLocation | undefined {
  for (const [index, step] of steps.entries()) {
    if (step.id === stepId) {
      return { step, parentStepId, branch, index, ancestorStepIds: ancestors };
    }
    for (const nested of nestedBranches(step)) {
      const found = findInSteps(nested.steps, stepId, step.id, nested.branch, [
        ...ancestors,
        step.id,
      ]);
      if (found) return found;
    }
  }
  return undefined;
}

export function findScenarioTestStep(
  test: AppMapScenarioTest,
  stepId: string,
): AppMapTestStepLocation | undefined {
  return findInSteps(test.steps, stepId, undefined, "root", []);
}

export function selectScenarioTestStep(
  test: AppMapScenarioTest,
  stepId: string,
): AppMapTestStepLocation {
  return (
    findScenarioTestStep(test, stepId) ??
    fail("step-not-found", `Test step ${stepId} does not exist`)
  );
}

function replaceStep(
  steps: AppMapScenarioTestStep[],
  stepId: string,
  replacement: AppMapScenarioTestStep,
): AppMapScenarioTestStep[] {
  let changed = false;
  const next = steps.map((step) => {
    if (step.id === stepId) {
      changed = true;
      return replacement;
    }
    if (step.kind === "decision") {
      const thenSteps = replaceStep(step.thenSteps, stepId, replacement);
      const otherwise = step.elseSteps
        ? replaceStep(step.elseSteps, stepId, replacement)
        : undefined;
      if (thenSteps !== step.thenSteps || otherwise !== step.elseSteps) {
        changed = true;
        return { ...step, thenSteps, ...(otherwise ? { elseSteps: otherwise } : {}) };
      }
    } else if (step.kind === "loop") {
      const nested = replaceStep(step.steps, stepId, replacement);
      if (nested !== step.steps) {
        changed = true;
        return { ...step, steps: nested };
      }
    }
    return step;
  });
  return changed ? next : steps;
}

function resolvePlacement(
  test: AppMapScenarioTest,
  placement: AppMapTestStepPlacement,
): {
  parent?: AppMapScenarioTestStep;
  branch: AppMapTestStepBranch;
  steps: AppMapScenarioTestStep[];
} {
  if (!placement.parentStepId) {
    if (placement.branch && placement.branch !== "root") {
      fail("invalid-branch", `Root placement cannot use branch ${placement.branch}`);
    }
    return { branch: "root", steps: test.steps };
  }

  const location = findScenarioTestStep(test, placement.parentStepId);
  if (!location)
    fail("parent-not-found", `Parent test step ${placement.parentStepId} does not exist`);
  const parent = location.step;
  if (parent.kind === "decision") {
    if (placement.branch === "then") return { parent, branch: "then", steps: parent.thenSteps };
    if (placement.branch === "else")
      return { parent, branch: "else", steps: parent.elseSteps ?? [] };
    fail("invalid-branch", `Decision step ${parent.id} only accepts then or else branches`);
  }
  if (parent.kind === "loop") {
    if (placement.branch === "steps") return { parent, branch: "steps", steps: parent.steps };
    fail("invalid-branch", `Loop step ${parent.id} only accepts the steps branch`);
  }
  return fail("invalid-parent", `Test step ${parent.id} cannot contain child steps`);
}

function replacePlacement(
  test: AppMapScenarioTest,
  placement: ReturnType<typeof resolvePlacement>,
  steps: AppMapScenarioTestStep[],
): AppMapScenarioTest {
  if (!placement.parent) return { ...test, steps };
  const parent = placement.parent;
  let replacement: AppMapScenarioTestStep;
  if (parent.kind === "decision") {
    replacement =
      placement.branch === "then"
        ? { ...parent, thenSteps: steps }
        : { ...parent, elseSteps: steps };
  } else if (parent.kind === "loop") {
    replacement = { ...parent, steps };
  } else {
    return fail("invalid-parent", `Test step ${parent.id} cannot contain child steps`);
  }
  return { ...test, steps: replaceStep(test.steps, parent.id, replacement) };
}

function validated(test: AppMapScenarioTest): AppMapScenarioTest {
  assertScenarioTest(test, "test");
  return test;
}

function resolvedBindingKind(step: AppMapScenarioTestStep): string {
  switch (step.kind) {
    case "instruction":
      return "connections";
    case "validation":
      return "assertion or recipe-step";
    case "extraction":
      return "extract";
    case "manual":
      return "pause";
    case "module":
      return "routine";
    case "decision":
      return "condition";
    case "loop":
      return "repeat";
    case "script":
      return "script";
  }
}

function bindingMatchesStep(
  step: AppMapScenarioTestStep,
  binding: AppMapScenarioTestStep["binding"],
): boolean {
  if (binding.status === "unresolved") return true;
  if (step.kind === "validation") {
    return binding.kind === "assertion" || binding.kind === "recipe-step";
  }
  return binding.kind === resolvedBindingKind(step);
}

export function addScenarioTestStep(
  test: AppMapScenarioTest,
  step: AppMapScenarioTestStep,
  placement: AppMapTestStepPlacement = {},
  index?: number,
): AppMapScenarioTest {
  assertScenarioTest(test, "test");
  if (findScenarioTestStep(test, step.id)) {
    fail("step-id-conflict", `Test step ${step.id} already exists`);
  }
  const target = resolvePlacement(test, placement);
  const insertAt = index ?? target.steps.length;
  if (!Number.isSafeInteger(insertAt) || insertAt < 0 || insertAt > target.steps.length) {
    fail("invalid-index", `Insert index ${String(index)} is outside 0..${target.steps.length}`);
  }
  const steps = [...target.steps.slice(0, insertAt), step, ...target.steps.slice(insertAt)];
  return validated(replacePlacement(test, target, steps));
}

export function patchScenarioTestStep(
  test: AppMapScenarioTest,
  stepId: string,
  patch: AppMapTestStepPatch,
): AppMapScenarioTest {
  assertScenarioTest(test, "test");
  const keys = Object.keys(patch);
  const unknown = keys.find(
    (key) => !["intent", "note", "capture", "cleanup", "binding"].includes(key),
  );
  if (unknown) {
    fail(
      "invalid-patch",
      unknown === "id" || unknown === "kind"
        ? `Test step ${unknown} is immutable`
        : `Test step patch contains unsupported field ${unknown}`,
    );
  }
  const { step } = selectScenarioTestStep(test, stepId);
  if (patch.binding && !bindingMatchesStep(step, patch.binding)) {
    fail(
      "invalid-binding",
      `${step.kind} step ${step.id} requires a ${resolvedBindingKind(step)} binding`,
    );
  }
  const base = (() => {
    const withoutNote = (() => {
      if (patch.note !== null) return step;
      const { note: _note, ...rest } = step;
      return rest;
    })();
    if (patch.cleanup !== null) return withoutNote;
    return Object.fromEntries(
      Object.entries(withoutNote).filter(([key]) => key !== "cleanup"),
    ) as typeof withoutNote;
  })();
  const replacement = {
    ...base,
    ...(patch.intent !== undefined ? { intent: patch.intent } : {}),
    ...(patch.binding !== undefined ? { binding: patch.binding } : {}),
    ...(patch.note !== undefined && patch.note !== null ? { note: patch.note } : {}),
    ...(patch.capture !== undefined ? { capture: patch.capture } : {}),
    ...(patch.cleanup !== undefined && patch.cleanup !== null
      ? { cleanup: structuredClone(patch.cleanup) }
      : {}),
  } as AppMapScenarioTestStep;
  return validated({ ...test, steps: replaceStep(test.steps, stepId, replacement) });
}

export function removeScenarioTestStep(
  test: AppMapScenarioTest,
  stepId: string,
): AppMapScenarioTest {
  assertScenarioTest(test, "test");
  const location = selectScenarioTestStep(test, stepId);
  const placement: AppMapTestStepPlacement = location.parentStepId
    ? {
        parentStepId: location.parentStepId,
        branch: location.branch as Exclude<AppMapTestStepBranch, "root">,
      }
    : {};
  const target = resolvePlacement(test, placement);
  const steps = target.steps.filter((step) => step.id !== stepId);
  return validated(replacePlacement(test, target, steps));
}

export function reorderScenarioTestSteps(
  test: AppMapScenarioTest,
  orderedStepIds: string[],
  placement: AppMapTestStepPlacement = {},
): AppMapScenarioTest {
  assertScenarioTest(test, "test");
  const target = resolvePlacement(test, placement);
  const currentIds = target.steps.map((step) => step.id);
  if (
    orderedStepIds.length !== currentIds.length ||
    new Set(orderedStepIds).size !== orderedStepIds.length ||
    orderedStepIds.some((id) => !currentIds.includes(id))
  ) {
    fail(
      "incomplete-order",
      `Reorder must contain each sibling exactly once (expected: ${currentIds.join(", ")})`,
    );
  }
  const byId = new Map(target.steps.map((step) => [step.id, step]));
  const steps = orderedStepIds.map((id) => byId.get(id)!);
  return validated(replacePlacement(test, target, steps));
}

export function bindScenarioTestStep(
  test: AppMapScenarioTest,
  stepId: string,
  binding: AppMapScenarioTestStep["binding"],
): AppMapScenarioTest {
  assertScenarioTest(test, "test");
  const { step } = selectScenarioTestStep(test, stepId);
  if (binding.status !== "resolved") {
    fail("invalid-binding", "bind requires a resolved binding");
  }
  if (!bindingMatchesStep(step, binding)) {
    fail(
      "invalid-binding",
      `${step.kind} step ${step.id} requires a ${resolvedBindingKind(step)} binding`,
    );
  }
  return patchScenarioTestStep(test, stepId, { binding });
}

export function unbindScenarioTestStep(
  test: AppMapScenarioTest,
  stepId: string,
  reason: string,
  candidates?: AppMapTestBindingCandidate[],
): AppMapScenarioTest {
  return patchScenarioTestStep(test, stepId, {
    binding: {
      status: "unresolved",
      reason,
      ...(candidates ? { candidates: candidates.map((candidate) => ({ ...candidate })) } : {}),
    },
  });
}

export function applyScenarioTestStepEdits(
  test: AppMapScenarioTest,
  edits: AppMapScenarioTestEdit[],
): AppMapScenarioTest {
  assertScenarioTest(test, "test");
  return edits.reduce((current, edit, editIndex) => {
    try {
      switch (edit.kind) {
        case "test.patch": {
          const keys = Object.keys(edit.patch);
          const unknown = keys.find((key) => !["name", "capture"].includes(key));
          if (unknown) {
            fail(
              "invalid-patch",
              unknown === "id" || unknown === "kind"
                ? `Test ${unknown} is immutable`
                : `Test patch contains unsupported field ${unknown}`,
            );
          }
          if (keys.length === 0) fail("invalid-patch", "Test patch must change a field");
          const base =
            edit.patch.capture === null
              ? (() => {
                  const { capture: _capture, ...withoutCapture } = current;
                  return withoutCapture;
                })()
              : current;
          return validated({
            ...base,
            ...(edit.patch.name !== undefined ? { name: edit.patch.name } : {}),
            ...(edit.patch.capture && { capture: structuredClone(edit.patch.capture) }),
          });
        }
        case "step.add":
          return addScenarioTestStep(current, edit.step, edit.placement, edit.index);
        case "step.patch":
          return patchScenarioTestStep(current, edit.stepId, edit.patch);
        case "step.remove":
          return removeScenarioTestStep(current, edit.stepId);
        case "step.reorder":
          return reorderScenarioTestSteps(current, edit.orderedStepIds, edit.placement);
        case "step.bind":
          return bindScenarioTestStep(current, edit.stepId, edit.binding);
        case "step.unbind":
          return unbindScenarioTestStep(current, edit.stepId, edit.reason, edit.candidates);
      }
    } catch (error) {
      if (error instanceof AppMapTestStepOperationError) {
        throw new AppMapTestStepOperationError(
          error.code,
          `Edit ${editIndex} (${edit.kind}) failed: ${error.message}`,
          editIndex,
        );
      }
      throw error;
    }
  }, test);
}
