import assert from "node:assert/strict";
import test from "node:test";
import { deriveFirstTestState } from "./onboarding";

test("keeps offline, missing, and stale targets in target setup", () => {
  assert.equal(
    deriveFirstTestState({ serverOnline: false, targetSelected: true, targetAvailable: true })
      .stage,
    "target",
  );
  assert.equal(
    deriveFirstTestState({ serverOnline: true, targetSelected: false, targetAvailable: false })
      .stage,
    "target",
  );
  assert.equal(
    deriveFirstTestState({ serverOnline: true, targetSelected: true, targetAvailable: false })
      .stage,
    "target",
  );
});

test("advances only from real custom steps and a real successful run", () => {
  const base = { serverOnline: true, targetSelected: true, targetAvailable: true };
  assert.equal(deriveFirstTestState(base).stage, "author");
  assert.equal(
    deriveFirstTestState({ ...base, recipeSource: "custom", recipeId: "login", stepCount: 2 })
      .stage,
    "run",
  );
  assert.equal(
    deriveFirstTestState({
      ...base,
      recipeSource: "custom",
      recipeId: "login",
      stepCount: 2,
      runs: [
        { id: "queued", action: "login", status: "queued" },
        { id: "other", action: "other", status: "ok" },
      ],
    }).stage,
    "run",
  );
  assert.equal(
    deriveFirstTestState({
      ...base,
      recipeSource: "custom",
      recipeId: "login",
      stepCount: 2,
      runs: [{ id: "passed", action: "login", status: "ok" }],
    }).stage,
    "complete",
  );
});
