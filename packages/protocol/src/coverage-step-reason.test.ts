import assert from "node:assert/strict";
import test from "node:test";
import { describeCoverageStepReason, describeCoverageStepReasons } from "./recipes.js";

test("inspect leftover skip copy never claims the opener tap executed", () => {
  const text = describeCoverageStepReason("inspect-setup-skipped");
  assert.equal(text, "Inspect setup skipped — already on this view");
  assert.doesNotMatch(text, /\btap(?:ped|s)?\b/iu);
  assert.doesNotMatch(text, /executed/iu);
});

test("transition leftover still present is an executed action, not a skip", () => {
  const text = describeCoverageStepReason("transition-executed");
  assert.equal(text, "Transition executed");
  assert.doesNotMatch(text, /skipped/iu);
  assert.notEqual(text, describeCoverageStepReason("inspect-setup-skipped"));
});

test("joined coverage notes keep inspect skip distinct from the required tap", () => {
  assert.equal(
    describeCoverageStepReasons(["inspect-setup-skipped", "transition-executed"]),
    "Inspect setup skipped — already on this view; Transition executed",
  );
});
