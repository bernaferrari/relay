import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canShowFirstRunGuide, firstSuccessfulRun } from "./first-run";

describe("firstSuccessfulRun", () => {
  it("uses only a real successful or healed run as completion", () => {
    const result = firstSuccessfulRun([
      { id: "queued", action: "a", status: "queued", queuedAt: 1 },
      { id: "late", action: "b", status: "ok", finishedAt: 30 },
      { id: "first", action: "a", status: "healed", finishedAt: 20 },
    ]);
    assert.equal(result?.id, "first");
  });

  it("only shows the handoff for the first completed custom test", () => {
    const first = { id: "run", action: "welcome", status: "ok", finishedAt: 1 };
    assert.equal(
      canShowFirstRunGuide({ recipeId: "welcome", recipeSource: "custom", firstRun: first }),
      true,
    );
    assert.equal(
      canShowFirstRunGuide({ recipeId: "other", recipeSource: "custom", firstRun: first }),
      false,
    );
    assert.equal(
      canShowFirstRunGuide({ recipeId: "builtin", recipeSource: "builtin", firstRun: null }),
      false,
    );
  });
});
