import assert from "node:assert/strict";
import test from "node:test";
import { classifyDeliveryLoop, type DeliveryLoopProof } from "./delivery-loop.js";

function proof(overrides: Partial<DeliveryLoopProof> = {}): DeliveryLoopProof {
  return {
    id: "proof-original",
    version: 3,
    state: "needs-review",
    decision: "rejected",
    repository: "acme/app",
    baseSha: "base-1",
    headSha: "head-fail",
    buildIds: ["build-92"],
    testIds: ["checkout"],
    targetNames: ["Firefox · Member"],
    runIds: ["run-fail"],
    planApproved: true,
    firstFailure: {
      runId: "run-fail",
      summary: "Checkout stayed disabled",
      testId: "checkout",
    },
    ...overrides,
  };
}

test("delivery loop binds exact build and configuration before a claim can be proved", () => {
  const snapshot = classifyDeliveryLoop({
    current: proof({ buildIds: [], testIds: [], targetNames: [], firstFailure: undefined }),
  });
  assert.equal(snapshot.phase, "prepare");
  assert.equal(snapshot.next.action, "prepare-exact-configuration");
});

test("a required test failure yields causal evidence on the original Proof", () => {
  const snapshot = classifyDeliveryLoop({ current: proof() });
  assert.equal(snapshot.phase, "failed");
  assert.deepEqual(snapshot.failureEvidence, {
    runId: "run-fail",
    summary: "Checkout stayed disabled",
    testId: "checkout",
    proofId: "proof-original",
  });
  assert.equal(snapshot.replacementEvidence, undefined);
  assert.equal(snapshot.next.action, "repair");
});

test("replacement evidence on a new build never rewrites the original failure", () => {
  const original = proof();
  const replacement = proof({
    id: "proof-replacement",
    version: 1,
    state: "proved",
    decision: "proved",
    headSha: "head-fix",
    buildIds: ["build-93"],
    runIds: ["run-pass"],
    firstFailure: undefined,
    publication: {
      conclusion: "success",
      checkRunId: "check-88",
      htmlUrl: "https://github.com/acme/app/runs/88",
    },
  });
  const snapshot = classifyDeliveryLoop({ current: replacement, predecessor: original });
  assert.equal(snapshot.phase, "published");
  assert.equal(snapshot.failureEvidence?.proofId, "proof-original");
  assert.equal(snapshot.failureEvidence?.runId, "run-fail");
  assert.deepEqual(snapshot.replacementEvidence, {
    runIds: ["run-pass"],
    proofId: "proof-replacement",
    headSha: "head-fix",
  });
  assert.notDeepEqual(snapshot.failureEvidence?.runId, snapshot.replacementEvidence?.runIds[0]);
  assert.deepEqual(snapshot.merge, {
    proofId: "proof-replacement",
    conclusion: "success",
    checkRunId: "check-88",
    htmlUrl: "https://github.com/acme/app/runs/88",
  });
});

test("the same build cannot become replacement evidence", () => {
  const snapshot = classifyDeliveryLoop({
    predecessor: proof(),
    current: proof({
      id: "proof-same",
      headSha: "head-fail",
      buildIds: ["build-92"],
      runIds: ["run-retry"],
      firstFailure: undefined,
      decision: "proved",
      state: "proved",
    }),
  });
  assert.notEqual(snapshot.phase, "published");
  assert.equal(snapshot.next.action, "retry-same-build");
  assert.equal(snapshot.failureEvidence?.proofId, "proof-original");
  assert.equal(snapshot.merge, undefined);
});

test("a ready replacement after a failed predecessor is run, not repair", () => {
  const snapshot = classifyDeliveryLoop({
    predecessor: proof(),
    current: proof({
      id: "proof-ready",
      headSha: "head-fix",
      buildIds: ["build-93"],
      runIds: [],
      firstFailure: undefined,
      decision: undefined,
      state: "ready",
    }),
  });
  assert.equal(snapshot.phase, "ready");
  assert.equal(snapshot.next.action, "run-replacement");
  assert.equal(snapshot.failureEvidence?.proofId, "proof-original");
});

test("needs-review and missing publication conclusions stay distinct from failure and success", () => {
  const review = classifyDeliveryLoop({
    current: proof({
      firstFailure: undefined,
      decision: undefined,
      state: "needs-review",
    }),
  });
  assert.equal(review.phase, "needs-review");
  assert.notEqual(review.next.action, "repair");
  const pending = classifyDeliveryLoop({
    current: proof({
      firstFailure: undefined,
      decision: "proved",
      state: "proved",
      publication: {},
    }),
  });
  assert.equal(pending.phase, "verified-pending-publication");
  assert.equal(pending.merge, undefined);
  const missingEvidence = classifyDeliveryLoop({
    current: proof({
      firstFailure: undefined,
      decision: undefined,
      state: "insufficient-evidence",
    }),
  });
  assert.equal(missingEvidence.phase, "insufficient-evidence");
  assert.equal(missingEvidence.next.action, "collect-evidence");
  assert.notEqual(missingEvidence.next.action, "repair");
});
