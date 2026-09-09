import assert from "node:assert/strict";
import test from "node:test";
import { proofApplicationId } from "./run-evidence-network.js";
import type { TestJob } from "./session.js";

test("ordinary saved Tests bind the one explicit app package in their frozen recipe graph", () => {
  const job = {
    artifacts: [],
    recipeGraph: {
      root: { steps: [{ kind: "app", action: "launch", app: "com.android.settings" }] },
    },
  } as unknown as TestJob;
  assert.equal(proofApplicationId(job), "com.android.settings");
});
test("multi-app frozen Tests do not invent single-package attribution", () => {
  const job = {
    artifacts: [],
    recipeGraph: {
      root: {
        steps: [
          { kind: "app", action: "launch", app: "com.android.settings" },
          { kind: "app", action: "launch", app: "ai.x.grok" },
        ],
      },
    },
  } as unknown as TestJob;
  assert.equal(proofApplicationId(job), undefined);
});
