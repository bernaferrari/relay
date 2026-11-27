import assert from "node:assert/strict";
import test from "node:test";
import type { StateFixture } from "@relay/protocol";
import { evaluateExplorationActionPolicy, rankExplorationFrontier } from "./exploration-policy.js";

function appFixture(): StateFixture {
  return {
    schemaVersion: 1,
    id: "fixture.app-reset",
    name: "Reviewed app reset",
    review: {
      revision: 2,
      reviewedBy: "human:reviewer",
      reviewedAt: 10,
      reason: "Disposable application state.",
    },
    resetScope: ["app"],
    secrets: [],
    phases: {
      prepare: {
        maxDurationMs: 10_000,
        steps: [{ id: "prepare", scope: "app", operation: "reset", timeoutMs: 2_000 }],
      },
      verify: {
        maxDurationMs: 10_000,
        steps: [{ id: "verify", scope: "app", operation: "verify", timeoutMs: 2_000 }],
      },
      cleanup: {
        maxDurationMs: 10_000,
        steps: [
          { id: "restore", scope: "app", operation: "restore", timeoutMs: 2_000 },
          {
            id: "prove-cleanup",
            scope: "app",
            operation: "prove-cleanup",
            timeoutMs: 2_000,
          },
        ],
      },
    },
    reversibility: {
      status: "reviewed-reversible",
      restoresScopes: ["app"],
      cleanupProofRequired: true,
    },
  };
}

const action = (kind: string, effects: string[] = []) => ({
  schemaVersion: 1,
  action: {
    id: `action-${kind}`,
    kind,
    requiredScopes: kind === "state-change" ? ["app"] : [],
    declaredExternalEffects: effects,
  },
});

test("deterministic policy owns safe, guarded, destructive, and prohibited admission", () => {
  const safe = evaluateExplorationActionPolicy(action("navigate"));
  const guarded = evaluateExplorationActionPolicy({
    ...action("state-change"),
    fixture: appFixture(),
  });
  const destructive = evaluateExplorationActionPolicy(action("data-deletion"));
  const prohibited = evaluateExplorationActionPolicy(action("purchase"));

  assert.deepEqual(
    [safe.level, guarded.level, destructive.level, prohibited.level],
    ["safe", "guarded", "destructive", "prohibited"],
  );
  assert.equal(safe.confirmation, "none");
  assert.equal(guarded.confirmation, "once-per-action");
  assert.equal(destructive.authorization, "human-only");
  assert.equal(prohibited.authorization, "blocked");
  assert.deepEqual(guarded.fixture, { id: "fixture.app-reset", revision: 2 });
});

test("a model override is rejected and declared effects can only escalate policy", () => {
  assert.throws(() =>
    evaluateExplorationActionPolicy({
      ...action("data-deletion"),
      modelDecision: "safe",
    }),
  );
  const escalated = evaluateExplorationActionPolicy(action("navigate", ["purchase"]));
  assert.equal(escalated.level, "prohibited");
  assert.deepEqual(escalated.externalEffects, ["purchase"]);
  assert.equal(escalated.reasons.at(-1)?.code, "exploration.effect.purchase");
});

test("frontier ranking is deterministic, bounded, explainable, and policy-penalized", () => {
  const ranking = rankExplorationFrontier({
    schemaVersion: 1,
    candidates: [
      {
        action: { ...action("data-deletion").action, id: "delete" },
        factors: {
          novelty: 100,
          coverageValue: 100,
          changedCodeRelevance: 100,
          uncertaintyReduction: 100,
          executionCost: 0,
        },
      },
      {
        action: { ...action("navigate").action, id: "settings" },
        factors: {
          novelty: 80,
          coverageValue: 80,
          changedCodeRelevance: 60,
          uncertaintyReduction: 70,
          executionCost: 20,
        },
      },
    ],
  });

  assert.equal(ranking.formula, "relay.exploration.frontier.v1");
  assert.deepEqual(
    ranking.entries.map((entry) => [entry.actionId, entry.rationale.riskPenalty]),
    [
      ["settings", 0],
      ["delete", 75],
    ],
  );
  assert.equal(ranking.entries[0]?.rationale.changedCodeRelevance, 60);
  assert.equal(ranking.entries[0]?.admission, "policy-eligible");
  assert.equal(ranking.entries[1]?.admission, "human-only");
});
