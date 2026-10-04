import assert from "node:assert/strict";
import test from "node:test";
import { TargetSupervisor } from "@relay/core";
import { assertClientUnknownReviewAllowed } from "./target-client-input-review.js";

test("client-only review cannot replace native receipts, recovery fences or control ownership", () => {
  const health = TargetSupervisor.start({ id: "pixel-review", kind: "android" }).health();
  const input = { mutationId: "recording-mutation-exact", platform: "android" as const, health };
  assert.doesNotThrow(() => assertClientUnknownReviewAllowed(input));
  for (const invalid of [
    { ...input, platform: "ios" as const },
    { ...input, platform: "browser" as const },
    { ...input, mutationId: "android-input-native" },
    { ...input, reconcilePending: true },
    { ...input, health: { ...health, input: { state: "blocked" as const } } },
    {
      ...input,
      health: { ...health, input: { state: "ready" as const, pendingMutationId: "newer-input" } },
    },
    {
      ...input,
      health: {
        ...health,
        input: { state: "uncertain" as const, pendingMutationId: "newer-input" },
      },
    },
    { ...input, health: { ...health, overall: "recovering" as const } },
    { ...input, health: { ...health, overall: "needs-human" as const } },
    { ...input, health: { ...health, overall: "quarantined" as const } },
    { ...input, health: { ...health, control: { state: "held-by-other" as const } } },
  ])
    assert.throws(() => assertClientUnknownReviewAllowed(invalid));
});
