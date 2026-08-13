import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTestStep } from "@relay/protocol";
import {
  createScenarioStep,
  createScenarioTest,
  duplicateScenarioStep,
  moveScenarioStep,
  scenarioDiagnostics,
} from "./app-map-test-editor-model.js";
import {
  addScenarioChild,
  deleteScenarioStepTree,
  duplicateScenarioStepTree,
  findScenarioStep,
  flattenScenarioSteps,
  moveScenarioStepTree,
  siblingFocusAfterDelete,
  updateScenarioStepTree,
} from "./app-map-test-editor-tree.js";

const map = {
  id: "map-1",
  organizationId: "org-1",
  projectId: "project-1",
  revision: 1,
  connections: {},
  routines: {},
} as AppMap;

test("scenario templates preserve stable ids while moving and renew ids when duplicating", () => {
  const first = createScenarioStep("instruction", "first");
  const second = createScenarioStep("manual", "second");
  assert.deepEqual(
    moveScenarioStep([first, second], "second", -1).map((step) => step.id),
    ["second", "first"],
  );
  assert.deepEqual(
    duplicateScenarioStep([first, second], "first", () => "copy").map((step) => step.id),
    ["first", "copy", "second"],
  );
});

test("new scenario tests are scoped without manufacturing executable bindings", () => {
  const scenario = createScenarioTest(map, "Checkout", "checkout", 42);
  scenario.steps.push(createScenarioStep("validation", "visible"));
  assert.equal(scenario.kind, "scenario");
  assert.equal(scenario.intentSchemaVersion, 1);
  assert.equal(scenario.createdAt, 42);
  assert.equal(scenario.steps[0]?.binding.status, "unresolved");
  assert.match(scenarioDiagnostics(map, scenario)[0]!.message, /Finish the validation binding/);
});

test("readiness distinguishes blockers from an honest empty loop warning", () => {
  const scenario = createScenarioTest(map, "Loop", "loop-test", 42);
  const loop = createScenarioStep("loop", "loop");
  if (loop.kind !== "loop") throw new Error("expected loop");
  loop.binding = { status: "resolved", kind: "repeat", count: 2 };
  scenario.steps = [loop];
  assert.deepEqual(scenarioDiagnostics(map, scenario), [
    { stepId: "loop", tone: "warning", message: "This loop has no body yet." },
  ]);
});

test("tree edits address nested steps by stable id and stay inside their sibling branch", () => {
  const decision = createScenarioStep("decision", "decision");
  if (decision.kind !== "decision") throw new Error("expected decision");
  const thenFirst = createScenarioStep("manual", "then-first");
  const thenSecond = createScenarioStep("script", "then-second");
  const elseStep = createScenarioStep("validation", "else-first");
  decision.thenSteps = [thenFirst, thenSecond];
  decision.elseSteps = [elseStep];

  let steps: AppMapScenarioTestStep[] = [decision];
  steps = moveScenarioStepTree(steps, "then-second", -1);
  const moved = findScenarioStep(steps, "decision");
  assert.equal(moved?.kind, "decision");
  assert.deepEqual(moved?.kind === "decision" ? moved.thenSteps.map((step) => step.id) : [], [
    "then-second",
    "then-first",
  ]);
  assert.deepEqual(moved?.kind === "decision" ? moved.elseSteps?.map((step) => step.id) : [], [
    "else-first",
  ]);

  steps = updateScenarioStepTree(steps, "then-first", (step) => ({ ...step, intent: "Updated" }));
  assert.equal(findScenarioStep(steps, "then-first")?.intent, "Updated");
  assert.equal(siblingFocusAfterDelete(steps, "then-second"), "then-first");
  steps = deleteScenarioStepTree(steps, "then-second");
  assert.equal(findScenarioStep(steps, "then-second"), undefined);
});

test("tree insertion and duplication renew every id in a nested subtree", () => {
  const loop = createScenarioStep("loop", "loop");
  if (loop.kind !== "loop") throw new Error("expected loop");
  const nestedDecision = createScenarioStep("decision", "nested-decision");
  if (nestedDecision.kind !== "decision") throw new Error("expected decision");
  nestedDecision.thenSteps = [createScenarioStep("instruction", "nested-child")];

  let steps: AppMapScenarioTestStep[] = addScenarioChild([loop], "loop", "loop", nestedDecision);
  const ids = ["copy-parent", "copy-child"];
  steps = duplicateScenarioStepTree(steps, "nested-decision", () => ids.shift()!);
  const body = findScenarioStep(steps, "loop");
  assert.deepEqual(body?.kind === "loop" ? body.steps.map((step) => step.id) : [], [
    "nested-decision",
    "copy-parent",
  ]);
  assert.equal(findScenarioStep(steps, "copy-child")?.kind, "instruction");
  assert.deepEqual(
    flattenScenarioSteps(steps).map(({ step, branch, depth }) => [step.id, branch, depth]),
    [
      ["loop", "root", 0],
      ["nested-decision", "loop", 1],
      ["nested-child", "then", 2],
      ["copy-parent", "loop", 1],
      ["copy-child", "then", 2],
    ],
  );
});
