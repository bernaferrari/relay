import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppMap, AppMapScenarioTestStep } from "@relay/protocol";
import { scenarioStepPath, scenarioStepTitle, splitScenarioPath } from "./app-map-test-step-path";

function mapWithConnections(labels: string[]): AppMap {
  const connections = Object.fromEntries(
    labels.map((label, index) => [
      `c${index}`,
      {
        id: `c${index}`,
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        fromScreenId: "s0",
        destination: { kind: "screen" as const, screenId: "s1" },
        label,
        state: "ready" as const,
        actionIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
  return {
    schemaVersion: 1,
    id: "map",
    organizationId: "org",
    projectId: "project",
    name: "Map",
    revision: 1,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections,
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  } as unknown as AppMap;
}

test("a shared prefix is separable so the distinguishing leaf survives truncation", () => {
  const path = splitScenarioPath("Navigation → Settings → Edit profile → Birth Year");
  assert.equal(path.ancestors, "Navigation → Settings → Edit profile");
  assert.equal(path.leaf, "Birth Year");
  assert.equal(path.full, "Navigation → Settings → Edit profile → Birth Year");
});

test("a single-segment path has no ancestors to dim", () => {
  const path = splitScenarioPath("Launch Grok home");
  assert.equal(path.ancestors, "");
  assert.equal(path.leaf, "Launch Grok home");
});

test("blank and ragged summaries stay safe to render", () => {
  assert.deepEqual(splitScenarioPath(""), { ancestors: "", leaf: "", full: "" });
  const ragged = splitScenarioPath("  Settings →  → Birth Year ");
  assert.equal(ragged.ancestors, "Settings");
  assert.equal(ragged.leaf, "Birth Year");
});

test("an instruction step splits its mapped connection labels", () => {
  const map = mapWithConnections(["Navigation", "Settings", "Birth Year"]);
  const step: AppMapScenarioTestStep = {
    id: "step-1",
    kind: "instruction",
    intent: "Open the Birth Year picker",
    binding: { status: "resolved", kind: "connections", connectionIds: ["c0", "c1", "c2"] },
  };
  const path = scenarioStepPath(map, step);
  assert.equal(path.ancestors, "Navigation → Settings");
  assert.equal(path.leaf, "Birth Year");
  assert.equal(scenarioStepTitle(map, step), "Open the Birth Year picker");
});

test("an unwritten intent falls back to the binding leaf rather than an empty row", () => {
  const map = mapWithConnections(["Navigation", "Settings", "Birth Year"]);
  const step: AppMapScenarioTestStep = {
    id: "step-2",
    kind: "instruction",
    intent: "   ",
    binding: { status: "resolved", kind: "connections", connectionIds: ["c0", "c1", "c2"] },
  };
  assert.equal(scenarioStepTitle(map, step), "Birth Year");
});

test("an unresolved step titles itself with the reason it cannot run", () => {
  const map = mapWithConnections([]);
  const step: AppMapScenarioTestStep = {
    id: "step-3",
    kind: "instruction",
    intent: "",
    binding: { status: "unresolved", reason: "Choose a mapped connection" },
  };
  assert.equal(scenarioStepTitle(map, step), "Choose a mapped connection");
});
