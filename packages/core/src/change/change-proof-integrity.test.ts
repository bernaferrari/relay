import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeVerification } from "@relay/protocol";
import {
  ChangeProofIntegrityError,
  VERIFY_CHANGE_POLICY_DEFINITION,
  materializeChangeVerificationIntegrity,
  verifyChangeDecisionDigest,
  verifyChangePlanDigest,
  verifyDurableChangeVerification,
  verifyChangePolicyDigest,
  resolveVerifyChangePolicy,
} from "./change-proof-integrity.js";

const digest = (value: string) => `sha256:${value.repeat(64)}` as const;

function draft(overrides: Partial<ChangeVerification> = {}): ChangeVerification {
  return materializeChangeVerificationIntegrity({
    schemaVersion: 2,
    id: "proof-integrity",
    organizationId: "acme",
    projectId: "relay",
    version: 1,
    state: "planning",
    change: { repository: "acme/settings", baseSha: "1".repeat(40), headSha: "2".repeat(40) },
    builds: [],
    selection: { affectedJourneys: [], targetCases: [] },
    policy: { id: "relay.verify-change", version: 2 },
    runIds: [],
    evidenceDigests: [],
    coverageGaps: [],
    residualRisk: [],
    requestedBy: "agent:coder",
    updatedBy: "agent:coder",
    createdAt: 1,
    updatedAt: 1,
    lastMutation: {
      schemaVersion: 1,
      requestId: "start",
      requestDigest: digest("a"),
      action: "start",
      actorId: "agent:coder",
      proofId: "proof-integrity",
      previousVersion: 0,
      version: 1,
      at: 1,
    },
    ...overrides,
  });
}

test("the live policy definition is deeply frozen and version dispatched", () => {
  assert.equal(Object.isFrozen(VERIFY_CHANGE_POLICY_DEFINITION), true);
  assert.equal(Object.isFrozen(VERIFY_CHANGE_POLICY_DEFINITION.ruleIds), true);
  assert.equal(
    resolveVerifyChangePolicy({ id: "relay.verify-change", version: 2 }),
    VERIFY_CHANGE_POLICY_DEFINITION,
  );
  assert.notEqual(
    resolveVerifyChangePolicy({ id: "relay.verify-change", version: 1 }),
    VERIFY_CHANGE_POLICY_DEFINITION,
  );
  assert.throws(
    () => resolveVerifyChangePolicy({ id: "relay.unknown", version: 1 }),
    (error) => error instanceof ChangeProofIntegrityError && error.code === "POLICY_UNSUPPORTED",
  );
});

test("policy and plan digests are locale-independent and insertion-order independent", () => {
  const left = draft({
    selection: {
      affectedJourneys: [],
      targetCases: [],
    },
  });
  const right = draft({
    selection: {
      targetCases: [],
      affectedJourneys: [],
    },
  });
  assert.equal(verifyChangePlanDigest(left), verifyChangePlanDigest(right));
  assert.equal(
    verifyChangePolicyDigest({ id: "relay.verify-change", version: 2 }),
    verifyChangePolicyDigest({ version: 2, id: "relay.verify-change" }),
  );
  assert.notEqual(
    verifyChangePolicyDigest({ id: "relay.verify-change", version: 1 }),
    verifyChangePolicyDigest({ id: "relay.verify-change", version: 2 }),
  );
});

test("durable Proof mutations fail closed at the digest boundary", () => {
  const planning = draft();
  assert.equal(planning.policyDigest?.startsWith("sha256:"), true);
  assert.equal(planning.planDigest?.startsWith("sha256:"), true);
  assert.deepEqual(verifyDurableChangeVerification(planning), planning);

  assert.throws(
    () => verifyDurableChangeVerification({ ...planning, planDigest: digest("f") }),
    (error) => error instanceof ChangeProofIntegrityError && error.code === "PLAN_DIGEST_MISMATCH",
  );
  assert.throws(
    () => verifyDurableChangeVerification({ ...planning, policyDigest: digest("f") }),
    (error) =>
      error instanceof ChangeProofIntegrityError && error.code === "POLICY_DIGEST_MISMATCH",
  );

  const terminal = materializeChangeVerificationIntegrity({
    ...planning,
    version: 2,
    state: "needs-review",
    decision: "needs-review",
    updatedBy: "system:relay",
    updatedAt: 2,
    smallestNextVerification: { kind: "review", reason: "Review this Proof." },
    lastMutation: {
      ...planning.lastMutation,
      requestId: "review",
      action: "request-plan-review",
      actorId: "system:relay",
      previousVersion: 1,
      version: 2,
      at: 2,
    },
  });
  assert.equal(terminal.decisionDigest, verifyChangeDecisionDigest(terminal));
  assert.throws(
    () =>
      verifyDurableChangeVerification({
        ...terminal,
        residualRisk: ["mutated after terminal decision"],
      }),
    (error) =>
      error instanceof ChangeProofIntegrityError && error.code === "DECISION_DIGEST_MISMATCH",
  );
});

test("legacy durable Proofs are projected to review and never silently blessed", () => {
  const planning = draft();
  const legacy = { ...planning } as Record<string, unknown>;
  delete legacy.policyDigest;
  delete legacy.planDigest;
  const projected = verifyDurableChangeVerification(legacy);
  assert.equal(projected.state, "needs-review");
  assert.equal(projected.decision, "needs-review");
  assert.equal(projected.planApproval, undefined);
});
