import assert from "node:assert/strict";
import test from "node:test";
import { CHANGE_PROOF_GOLDEN_DEMO } from "./change-proof-golden-demo.js";
import { runChangeProofGoldenHarness } from "./change-proof-golden-harness.js";

test("golden harness reports the real Proof loop with injected timing", async () => {
  const ticks = [12_000, 12_475];
  let index = 0;
  const report = await runChangeProofGoldenHarness({
    clock: { now: () => ticks[index++] ?? ticks.at(-1)! },
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.kind, "change-proof-golden-harness");
  assert.deepEqual(report.benchmark.timing, {
    clock: "injected",
    scope: "runChangeProofGoldenDemo",
    startedAt: 12_000,
    finishedAt: 12_475,
    durationMs: 475,
  });
  assert.equal(report.benchmark.oldHead.decision, "rejected");
  assert.equal(report.benchmark.repairedHead.decision, "proved");
  assert.deepEqual(report.benchmark.reusedCaseIds, []);
  assert.deepEqual(report.scenario, {
    repository: CHANGE_PROOF_GOLDEN_DEMO.repository,
    baseSha: CHANGE_PROOF_GOLDEN_DEMO.baseSha,
    failedHeadSha: CHANGE_PROOF_GOLDEN_DEMO.failedHeadSha,
    repairedHeadSha: CHANGE_PROOF_GOLDEN_DEMO.repairedHeadSha,
    journey: {
      appMapId: CHANGE_PROOF_GOLDEN_DEMO.appMapId,
      testId: CHANGE_PROOF_GOLDEN_DEMO.testId,
    },
    targetCaseIds: ["android-pixel-9-ar", "web-chromium-compact-ar", "web-chromium-desktop-ar"],
  });
  assert.equal(report.providerChecks.old.externalId, "proof-settings-failed");
  assert.equal(report.providerChecks.old.headSha, CHANGE_PROOF_GOLDEN_DEMO.failedHeadSha);
  assert.equal(report.providerChecks.old.conclusion, "failure");
  assert.equal(report.providerChecks.repaired.externalId, "proof-settings-repaired");
  assert.equal(report.providerChecks.repaired.headSha, CHANGE_PROOF_GOLDEN_DEMO.repairedHeadSha);
  assert.equal(report.providerChecks.repaired.conclusion, "success");
  assert.ok(report.providerChecks.repaired.policyDigest);
  assert.ok(report.providerChecks.repaired.planDigest);
  assert.ok(report.providerChecks.repaired.decisionDigest);
  assert.deepEqual(
    report.steps.map(({ id, outcome }) => ({ id, outcome })),
    [
      { id: "bind-change", outcome: "passed" },
      { id: "select-journey", outcome: "passed" },
      { id: "run-pilot", outcome: "passed" },
      { id: "detect-regression", outcome: "passed" },
      { id: "return-repair-packet", outcome: "passed" },
      { id: "supersede-proof", outcome: "passed" },
      { id: "rerun-repaired-head", outcome: "passed" },
      { id: "clear-merge", outcome: "passed" },
    ],
  );
  assert.match(report.steps[3]!.detail, /22 px/u);
  assert.equal(report.checks.length, 4);
  assert.ok(
    report.checks.every(({ answer, status }) => answer === null && status === "not-measured"),
  );
  assert.ok(report.limitations.unsupported.some(({ field }) => field === "physical-target-health"));
  assert.ok(report.limitations.unmeasured.some(({ field }) => field === "agent-comprehension"));
  assert.equal(report.demo.oldDecision.decision, report.benchmark.oldHead.decision);
});

test("golden harness rejects a non-monotonic injected clock", async () => {
  await assert.rejects(
    runChangeProofGoldenHarness({
      clock: {
        now: (() => {
          const values = [10, 9];
          return () => values.shift()!;
        })(),
      },
    }),
    /finite, monotonic/u,
  );
});
