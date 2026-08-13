import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapScenarioTest } from "@relay/protocol";
import { planScenarioTestEdits } from "./app-map-scenario-edit-plan.js";

function fixture(): AppMapScenarioTest {
  return {
    id: "checkout",
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    name: "Checkout",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "choose",
        kind: "decision",
        intent: "Choose path",
        binding: { status: "resolved", kind: "condition", input: "role", operator: "exists" },
        thenSteps: [
          {
            id: "guest",
            kind: "manual",
            intent: "Continue as guest",
            binding: { status: "resolved", kind: "pause", message: "Continue" },
          },
        ],
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
}

test("plans semantic metadata, nested patch, add, and complete sibling order", () => {
  const previous = fixture();
  const next = structuredClone(previous);
  next.name = "Checkout safely";
  const decision = next.steps[0];
  assert.ok(decision?.kind === "decision");
  decision.thenSteps[0]!.intent = "Continue without an account";
  decision.thenSteps.unshift({
    id: "validate",
    kind: "validation",
    intent: "Guest is available",
    binding: { status: "unresolved", reason: "Choose a target" },
  });

  assert.deepEqual(planScenarioTestEdits(previous, next), [
    { kind: "test.patch", patch: { name: "Checkout safely" } },
    {
      kind: "step.add",
      step: decision.thenSteps[0],
      placement: { parentStepId: "choose", branch: "then" },
      index: 0,
    },
    {
      kind: "step.patch",
      stepId: "guest",
      patch: { intent: "Continue without an account" },
    },
  ]);
});

test("rejects identity and kind changes instead of replacing a collaborative document", () => {
  const previous = fixture();
  const identity = structuredClone(previous);
  identity.id = "other";
  assert.throws(() => planScenarioTestEdits(previous, identity), /cannot change test identity/);

  const changedKind = structuredClone(previous);
  changedKind.steps[0] = {
    id: "choose",
    kind: "script",
    intent: "Choose path",
    binding: { status: "resolved", kind: "script", source: "return true" },
  };
  assert.throws(() => planScenarioTestEdits(previous, changedKind), /changed kind/);
});
