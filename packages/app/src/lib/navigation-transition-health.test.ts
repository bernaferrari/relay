import assert from "node:assert/strict";
import test from "node:test";
import {
  navigationTransitionHealthModel,
  type NavigationTransitionHealthDto,
} from "./navigation-transition-health";

function transition(
  overrides: Partial<NavigationTransitionHealthDto> = {},
): NavigationTransitionHealthDto {
  return {
    transitionId: "settings-to-usage",
    authoredOrder: 2,
    source: { screenId: "settings", title: "Settings" },
    destination: { screenId: "usage", title: "Usage" },
    status: "ready",
    dependentCheckIds: ["usage", "buy-more"],
    observedAt: 1,
    ...overrides,
  };
}

test("navigation health preserves authored order and never infers proof", () => {
  const model = navigationTransitionHealthModel([
    transition(),
    transition({
      transitionId: "home-to-settings",
      authoredOrder: 1,
      destination: { screenId: "settings", title: "Settings" },
      status: "proven",
      proof: {
        tokenId: "proof-1",
        runId: "run-1",
        verifiedAt: 2,
        destination: { screenId: "settings", title: "Settings" },
      },
    }),
  ]);

  assert.deepEqual(
    model.rows.map((row) => [row.transitionId, row.status, row.lastVerifiedDestination]),
    [
      ["home-to-settings", "proven", "Settings"],
      ["settings-to-usage", "ready", undefined],
    ],
  );
  assert.equal(model.counts.proven, 1);
  assert.equal(model.counts.ready, 1);
});

test("navigation health exposes one immutable repair entry for review", () => {
  const model = navigationTransitionHealthModel([
    transition({
      status: "drifted",
      dependentCheckIds: ["usage", "usage", "buy-more"],
      problem: { reason: "Expected Usage, observed Settings" },
      repair: {
        targetId: "run-1:usage",
        sourceRunId: "run-1",
        checkId: "usage",
        title: "Repair Settings → Usage",
        summary: "Review the missing Usage locator.",
      },
    }),
    transition({
      transitionId: "settings-to-advanced",
      authoredOrder: 3,
      status: "blocked",
      repair: {
        targetId: "run-1:advanced",
        sourceRunId: "run-1",
        checkId: "advanced",
        title: "Repair Settings → Advanced",
        summary: "Review the missing Advanced locator.",
      },
    }),
  ]);

  assert.equal(model.rows[0]?.dependentCount, 2);
  assert.deepEqual(model.repair, {
    transitionId: "settings-to-usage",
    targetId: "run-1:usage",
    title: "Repair Settings → Usage",
    summary: "Review the missing Usage locator.",
    operationId: "run.repair.get",
    fixedInput: { runId: "run-1", checkId: "usage" },
  });
});
