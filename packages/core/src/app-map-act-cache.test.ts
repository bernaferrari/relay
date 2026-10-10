import assert from "node:assert/strict";
import test from "node:test";
import { withCache } from "./app-map-act-cache.js";

test("saved actions attach only to plain-English steps whose words still match", () => {
  const steps = [
    {
      id: "a",
      kind: "instruction",
      intent: "Open Settings",
      binding: { status: "unresolved", reason: "r", fromText: true },
    },
    {
      id: "b",
      kind: "instruction",
      intent: "Renamed",
      binding: { status: "unresolved", reason: "r", fromText: true },
    },
    {
      id: "c",
      kind: "instruction",
      intent: "Recorded",
      binding: { status: "resolved", kind: "connections", connectionIds: ["x"] },
    },
  ] as never;
  const tap = [{ kind: "tap", target: { label: "Settings" } }] as never;
  const updates = new Map([
    ["a", { recipeStepId: "r1", intent: "Open Settings", source: "model", steps: tap }],
    ["b", { recipeStepId: "r2", intent: "Old words", source: "model", steps: tap }],
    ["c", { recipeStepId: "r3", intent: "Recorded", source: "model", steps: tap }],
  ]);
  const next = withCache(steps, updates as never, "run-1", 5);
  assert.equal(next.changed, 1);
  assert.deepEqual((next.steps[0]!.binding as { cache?: unknown }).cache, {
    steps: tap,
    runId: "run-1",
    savedAt: 5,
  });
  assert.equal((next.steps[1]!.binding as { cache?: unknown }).cache, undefined);
});
