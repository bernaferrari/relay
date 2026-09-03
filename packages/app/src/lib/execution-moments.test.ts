import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { JobInfo, RecipeInfo } from "../context/server";
import { executionMoments, executionMomentTitle } from "./execution-moments";

describe("executionMoments", () => {
  it("keeps compiler screenshot identities out of the human step title", () => {
    assert.equal(
      executionMomentTitle(
        "Screenshot · step:open-language:Open Language from Settings",
        "screenshot",
      ),
      "Open Language from Settings",
    );
  });

  it("replaces legacy reusable-test trace IDs with human action copy", () => {
    const recipe = {
      id: "proof-plan",
      title: "Launcher checkpoint Test",
      steps: [
        {
          kind: "module",
          recipeId: "app-map:avd-acceptance:tests:launcher-proof@10",
        },
      ],
    } as RecipeInfo;
    const job = {
      id: "run-1",
      action: "app-map.test.run",
      status: "ok",
      queuedAt: 1,
      logs: [],
      steps: [
        {
          id: "step-1",
          index: 0,
          kind: "module",
          tone: "pass",
          status: "ok",
          title: "Run reusable test: app-map:avd-acceptance:tests:launcher-proof@10",
          glyphs: ["store"],
          startedAt: 1,
          frames: [],
          log: "",
        },
      ],
    } as JobInfo;

    assert.equal(executionMoments({ recipe, job, recipes: [recipe] })[0]?.title, "Run saved Test");
  });
});
