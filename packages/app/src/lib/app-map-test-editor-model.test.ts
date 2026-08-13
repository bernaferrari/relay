import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import {
  createScenarioStep,
  createScenarioTest,
  duplicateScenarioStep,
  moveScenarioStep,
  scenarioDiagnostics,
} from "./app-map-test-editor-model.js";

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
