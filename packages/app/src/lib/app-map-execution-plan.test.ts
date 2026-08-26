import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import { appMapExecutionPlan, connectionUpdateForExecutionStep } from "./app-map-execution-plan";

const scope = { organizationId: "local", projectId: "default", appMapId: "settings" };

function connections(): AppMap["connections"] {
  return {
    later: {
      ...scope,
      id: "later",
      fromScreenId: "details",
      destination: { kind: "end" },
      state: "ready",
      actions: [{ id: "wait", kind: "wait", ms: 300 }],
      createdAt: 20,
      updatedAt: 20,
    },
    open: {
      ...scope,
      id: "open",
      fromScreenId: "home",
      destination: { kind: "screen", screenId: "details" },
      state: "ready",
      actions: [
        {
          id: "take",
          kind: "recorded",
          takeId: "take-1",
          takeRevision: 1,
          evidenceIds: ["evidence-1"],
          steps: [
            { id: "tap-menu", kind: "tap", target: { label: "Menu" } },
            { id: "tap-settings", kind: "tap", target: { label: "Settings" } },
          ],
        },
      ],
      createdAt: 10,
      updatedAt: 10,
    },
  };
}

test("projects canonical Connections in stable execution order with exact origins", () => {
  const plan = appMapExecutionPlan(connections());
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ["tap-menu", "tap-settings", "wait"],
  );
  assert.deepEqual(plan.origins, [
    { connectionId: "open", actionIndex: 0, stepIndex: 0 },
    { connectionId: "open", actionIndex: 0, stepIndex: 1 },
    { connectionId: "later", actionIndex: 0, stepIndex: 0 },
  ]);
});

test("edits a projected row by producing a canonical Connection action update", () => {
  const source = connections();
  const update = connectionUpdateForExecutionStep({
    connections: source,
    index: 1,
    step: { id: "tap-settings", kind: "tap", target: { ref: "settings-button" } },
  });
  assert.equal(update?.connectionId, "open");
  assert.deepEqual(update?.actions[0]?.kind === "recorded" ? update.actions[0].steps[1] : null, {
    id: "tap-settings",
    kind: "tap",
    target: { ref: "settings-button" },
  });
  assert.deepEqual(
    source.open?.actions[0]?.kind === "recorded" ? source.open.actions[0].steps[1] : null,
    { id: "tap-settings", kind: "tap", target: { label: "Settings" } },
  );
});
