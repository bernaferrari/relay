import assert from "node:assert/strict";
import test from "node:test";
import {
  explorationActionPolicyInputSchema,
  explorationFrontierRequestSchema,
  stateFixtureSchema,
  type StateFixture,
} from "./exploration-policy.js";

function fixture(): StateFixture {
  return {
    schemaVersion: 1,
    id: "fixture.settings",
    name: "Reviewed settings state",
    review: {
      revision: 3,
      reviewedBy: "human:reviewer",
      reviewedAt: 10,
      reason: "Disposable account and deterministic settings reset.",
    },
    resetScope: ["app", "account"],
    secrets: [{ id: "account-token", source: "vault", key: "mobile/test-account" }],
    phases: {
      prepare: {
        maxDurationMs: 20_000,
        steps: [
          { id: "prepare-app", scope: "app", operation: "reset", timeoutMs: 5_000 },
          {
            id: "prepare-account",
            scope: "account",
            operation: "apply-reviewed-preset",
            presetRef: "preset/test-account",
            secretRefs: ["account-token"],
            timeoutMs: 5_000,
          },
        ],
      },
      verify: {
        maxDurationMs: 10_000,
        steps: [
          { id: "verify-app", scope: "app", operation: "verify", timeoutMs: 2_000 },
          { id: "verify-account", scope: "account", operation: "verify", timeoutMs: 2_000 },
        ],
      },
      cleanup: {
        maxDurationMs: 20_000,
        steps: [
          { id: "restore-app", scope: "app", operation: "restore", timeoutMs: 2_000 },
          {
            id: "prove-app-cleanup",
            scope: "app",
            operation: "prove-cleanup",
            timeoutMs: 2_000,
          },
          {
            id: "restore-account",
            scope: "account",
            operation: "restore",
            timeoutMs: 2_000,
          },
          {
            id: "prove-account-cleanup",
            scope: "account",
            operation: "prove-cleanup",
            timeoutMs: 2_000,
          },
        ],
      },
    },
    reversibility: {
      status: "reviewed-reversible",
      restoresScopes: ["app", "account"],
      cleanupProofRequired: true,
    },
  };
}

test("StateFixture accepts reviewed references and rejects embedded secret values", () => {
  assert.equal(stateFixtureSchema.parse(fixture()).secrets[0]?.key, "mobile/test-account");
  const embedded = structuredClone(fixture()) as unknown as {
    secrets: Array<Record<string, unknown>>;
  };
  embedded.secrets[0]!.value = "actual-bearer-token";
  assert.throws(() => stateFixtureSchema.parse(embedded));
});

test("StateFixture rejects incomplete or irreversible cleanup", () => {
  const irreversible = fixture();
  irreversible.phases.cleanup.steps = irreversible.phases.cleanup.steps.filter(
    (step) => !(step.scope === "account" && step.operation === "prove-cleanup"),
  );
  assert.throws(
    () => stateFixtureSchema.parse(irreversible),
    /does not prove cleanup for account/u,
  );
});

test("policy and frontier parsers reject model overrides and unbounded inputs", () => {
  assert.throws(() =>
    explorationActionPolicyInputSchema.parse({
      schemaVersion: 1,
      action: {
        id: "delete-account",
        kind: "data-deletion",
        requiredScopes: ["account"],
        declaredExternalEffects: ["data-deletion"],
      },
      modelDecision: "safe",
    }),
  );

  const candidate = {
    action: {
      id: "open-settings",
      kind: "navigate",
      requiredScopes: [],
      declaredExternalEffects: [],
    },
    factors: {
      novelty: 100,
      coverageValue: 100,
      changedCodeRelevance: 0,
      uncertaintyReduction: 50,
      executionCost: 20,
    },
  } as const;
  assert.throws(() =>
    explorationFrontierRequestSchema.parse({
      schemaVersion: 1,
      candidates: Array.from({ length: 201 }, (_, index) => ({
        ...candidate,
        action: { ...candidate.action, id: `action-${index}` },
      })),
    }),
  );
  assert.throws(() =>
    explorationFrontierRequestSchema.parse({
      schemaVersion: 1,
      candidates: [{ ...candidate, factors: { ...candidate.factors, uncertaintyReduction: 101 } }],
    }),
  );
});
