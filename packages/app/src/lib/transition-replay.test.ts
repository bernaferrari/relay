import assert from "node:assert/strict";
import test from "node:test";
import type { RecipeStep } from "@relay/protocol";
import { replayTransitionSteps } from "./transition-replay";

const steps: RecipeStep[] = [
  { kind: "key", key: "back" },
  { kind: "sleep", ms: 250 },
  { kind: "key", key: "home" },
];

test("transition replay runs every action in order", async () => {
  const seen: RecipeStep[] = [];
  const result = await replayTransitionSteps(steps, async (step) => {
    seen.push(step);
    return { ok: true };
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(seen, steps);
});

test("transition replay stops at the first failed action", async () => {
  let calls = 0;
  const result = await replayTransitionSteps(steps, async () => {
    calls += 1;
    return calls === 2 ? { ok: false, error: "Button was not found" } : { ok: true };
  });

  assert.deepEqual(result, {
    ok: false,
    error: "Button was not found",
    failedStepIndex: 1,
  });
  assert.equal(calls, 2);
});

test("transition replay keeps an iOS review boundary instead of treating it as retryable", async () => {
  let calls = 0;
  const result = await replayTransitionSteps(steps, async () => {
    calls += 1;
    return {
      ok: false as const,
      error: "Action may already have happened",
      terminal: "review-needed" as const,
      stepReview: {
        captureCurrent: {
          operationId: "target.screenshot.capture" as const,
          input: { serial: "ipad-1" },
        },
      },
    };
  });

  assert.deepEqual(result, {
    ok: false,
    error: "Action may already have happened",
    failedStepIndex: 0,
    terminal: "review-needed",
    stepReview: {
      captureCurrent: {
        operationId: "target.screenshot.capture",
        input: { serial: "ipad-1" },
      },
    },
  });
  assert.equal(calls, 1, "a review-needed outcome must stop the transition immediately");
});
