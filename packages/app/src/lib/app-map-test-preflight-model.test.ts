import assert from "node:assert/strict";
import test from "node:test";
import { groupPreflightFindings } from "./app-map-test-preflight-model.js";

test("groups a noisy frozen-plan report into ordered repair actions without dropping detail", () => {
  const groups = groupPreflightFindings([
    {
      severity: "warning",
      code: "raw-evidence-recapture-required",
      recipeId: "settings",
      screenId: "settings",
      message: "Settings has no raw tree.",
    },
    {
      severity: "warning",
      code: "selector-needs-raw-tree",
      recipeId: "settings",
      recipeStepId: "open-voice",
      message: "Voice needs a raw tree.",
    },
    {
      severity: "blocker",
      code: "unresolved-return",
      recipeId: "kids",
      recipeStepId: "return-kids",
      message: "A reviewed return is required.",
    },
    {
      severity: "warning",
      code: "surface-recapture-required",
      recipeId: "voice",
      screenId: "voice",
      message: "Voice needs a full capture.",
    },
  ]);

  assert.deepEqual(
    groups.map((group) => [group.id, group.findings.length]),
    [
      ["returns", 1],
      ["surface", 1],
      ["evidence", 2],
    ],
  );
  assert.match(groups.at(-1)!.action, /will not guess/u);
});
