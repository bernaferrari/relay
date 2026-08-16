import assert from "node:assert/strict";
import test from "node:test";
import {
  navigationTransitionHealthFromJob,
  navigationTransitionHealthModel,
  type NavigationTransitionHealthDto,
} from "./navigation-transition-health";
import type { JobInfo } from "./api-types";

function transition(
  overrides: Partial<NavigationTransitionHealthDto> = {},
): NavigationTransitionHealthDto {
  return {
    transitionId: "settings-to-usage",
    authoredOrder: 2,
    source: { screenId: "settings", title: "Settings" },
    destination: { kind: "screen", screenId: "usage", title: "Usage" },
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
      destination: { kind: "screen", screenId: "settings", title: "Settings" },
      status: "proven",
      proof: {
        tokenId: "proof-1",
        runId: "run-1",
        verifiedAt: 2,
        destination: { kind: "screen", screenId: "settings", title: "Settings" },
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
    title: "Repair Settings → Usage",
    summary: "Review the missing Usage locator.",
    operationId: "run.repair.get",
    fixedInput: { runId: "run-1", checkId: "usage" },
  });
});

test("job projection keeps one shared edge and only trusts proof and circuit artifacts", () => {
  const dependency = {
    connectionId: "settings-to-usage",
    originScreenId: "settings",
    destination: { kind: "screen", screenId: "usage" },
  };
  const model = navigationTransitionHealthFromJob({
    id: "run-1",
    action: "settings-tour",
    status: "error",
    queuedAt: 1,
    logs: [],
    artifacts: [
      {
        kind: "campaign-check-result",
        capturedAt: 1,
        data: { id: "usage", status: "passed", transitionDependencies: [dependency] },
      },
      {
        kind: "campaign-check-result",
        capturedAt: 2,
        data: { id: "buy-more", status: "blocked", transitionDependencies: [dependency] },
      },
      {
        kind: "campaign-transition-proof",
        capturedAt: 3,
        data: {
          schemaVersion: 1,
          tokenId: "proof-1",
          connectionId: "settings-to-usage",
          originScreenId: "settings",
          destination: { kind: "screen", screenId: "usage" },
          checkId: "usage",
          status: "verified",
          verifiedAt: 3,
        },
      },
      {
        kind: "campaign-transition-circuit",
        capturedAt: 4,
        data: {
          schemaVersion: 1,
          connectionId: "settings-to-usage",
          checkId: "usage",
          status: "open",
          reason: "Canonical confirmation failed.",
        },
      },
    ],
  } as JobInfo);

  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0]?.status, "blocked");
  assert.equal(model.rows[0]?.dependentCount, 2);
  assert.equal(model.rows[0]?.lastVerifiedDestination, "usage");
  assert.deepEqual(model.repair?.fixedInput, { runId: "run-1", checkId: "usage" });
});
