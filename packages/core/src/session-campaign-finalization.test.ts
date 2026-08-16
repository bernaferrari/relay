import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { finalizeDeferredChecksForJob } from "./session-campaign-finalization.js";
import type { RecipeRuntimeState } from "./recipe-runner-context.js";
import type { TestJob } from "./session-contract.js";

describe("campaign check session finalization", () => {
  it("preserves the original failure for selective repair without running recovery", () => {
    const logs: string[] = [];
    const job = {
      id: "coverage-run",
      artifacts: [
        {
          kind: "campaign-check-evidence",
          capturedAt: 12,
          data: { checkId: "usage", screenshot: "original-failure.png" },
        },
      ],
    } as unknown as TestJob;
    const runtime: RecipeRuntimeState = {
      deferredCampaignChecks: [
        {
          check: {
            id: "usage",
            title: "Usage",
            recovery: { groupId: "settings", recipeId: "cold-settings-to-usage" },
          },
          error: "Buy more opened an unknown screen",
          startedAt: 10,
          deferredAt: 12,
        },
      ],
    };

    finalizeDeferredChecksForJob(job, (line) => logs.push(line), runtime);

    assert.equal(job.artifacts[0]?.kind, "campaign-check-evidence");
    assert.deepEqual(job.artifacts[1], {
      kind: "campaign-check-result",
      capturedAt: 12,
      data: {
        id: "usage",
        title: "Usage",
        recovery: { groupId: "settings", recipeId: "cold-settings-to-usage" },
        status: "failed",
        error: "Buy more opened an unknown screen",
        startedAt: 10,
        finishedAt: 12,
        selectiveRepair: {
          status: "pending",
          groupId: "settings",
          recipeId: "cold-settings-to-usage",
        },
      },
    });
    assert.deepEqual(runtime.deferredCampaignChecks, []);
    assert.deepEqual(logs, [
      "1 campaign check queued for selective repair",
      "check needs repair: Usage — Buy more opened an unknown screen",
    ]);
  });
});
