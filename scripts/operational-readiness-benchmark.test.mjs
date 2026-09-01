import assert from "node:assert/strict";
import test from "node:test";
import {
  OperationalBenchmarkStageError,
  runOperationalReadinessBenchmark,
} from "./operational-readiness-benchmark.mjs";

function tickingClock(start = 1_000, step = 25) {
  let value = start;
  return { now: () => (value += step) };
}

test("operational benchmark reports machine-readable timings and honest external gaps", async () => {
  const report = await runOperationalReadinessBenchmark({
    clock: tickingClock(),
    environment: { commitSha: "a".repeat(40), mode: "fresh-worktree" },
    actions: {
      cleanInstall: async () => ({ evidence: { kind: "fresh-git-worktree" } }),
      firstProof: async () => ({
        evidence: {
          kind: "device-free-golden-proof",
          oldDecision: "rejected",
          repairedDecision: "proved",
        },
      }),
      leaseRecovery: async () => ({
        evidence: { kind: "deterministic-policy-tests", liveWatchRestartMeasured: false },
      }),
    },
  });

  assert.equal(report.status, "incomplete");
  assert.equal(report.automationStatus, "passed");
  assert.deepEqual(
    report.stages.map(({ id, status, durationMs }) => ({ id, status, durationMs })),
    [
      { id: "clean-install", status: "passed", durationMs: 25 },
      { id: "first-proof", status: "passed", durationMs: 25 },
      { id: "watch-restart-lease-recovery", status: "passed", durationMs: 25 },
    ],
  );
  assert.equal(report.operatorSummary.reportIsMergeEvidence, false);
  assert.ok(report.externalAcceptance.every(({ status }) => status === "not-measured"));
  assert.ok(report.externalAcceptance.some(({ id }) => id === "unfamiliar-users"));
  assert.ok(report.externalAcceptance.some(({ id }) => id === "physical-ios-retained-history"));
});

test("clean-install failure names the stage, command recovery, and blocked stages", async () => {
  let laterStageRan = false;
  const report = await runOperationalReadinessBenchmark({
    clock: tickingClock(),
    environment: { mode: "fresh-worktree" },
    actions: {
      cleanInstall: async () => {
        throw new OperationalBenchmarkStageError(
          "CLEAN_INSTALL_FAILED",
          "Dependency installation failed in the isolated worktree.",
          {
            command: ["vp", "install", "--frozen-lockfile"],
            nextAction: "Run vp env doctor.",
            stderr: "registry unavailable",
            exitCode: 1,
          },
        );
      },
      firstProof: async () => {
        laterStageRan = true;
        return {};
      },
      leaseRecovery: async () => {
        laterStageRan = true;
        return {};
      },
    },
  });

  assert.equal(report.status, "failed");
  assert.equal(report.automationStatus, "failed");
  assert.equal(laterStageRan, false);
  assert.deepEqual(report.operatorSummary.failedStageIds, ["clean-install"]);
  assert.deepEqual(report.operatorSummary.nextActions, ["Run vp env doctor."]);
  assert.equal(report.stages[0].diagnostic.code, "CLEAN_INSTALL_FAILED");
  assert.equal(report.stages[0].diagnostic.stderrTail, "registry unavailable");
  assert.deepEqual(
    report.stages.slice(1).map(({ status }) => status),
    ["skipped", "skipped"],
  );
});

test("reuse mode remains incomplete but may measure Proof and lease policy", async () => {
  const report = await runOperationalReadinessBenchmark({
    clock: tickingClock(),
    environment: { mode: "reuse-workspace" },
    actions: {
      cleanInstall: async () => ({
        status: "skipped",
        reason: "Existing workspace was explicitly reused.",
        evidence: { kind: "existing-workspace" },
      }),
      firstProof: async () => ({ evidence: { kind: "device-free-golden-proof" } }),
      leaseRecovery: async () => ({ evidence: { kind: "deterministic-policy-tests" } }),
    },
  });

  assert.equal(report.status, "incomplete");
  assert.equal(report.automationStatus, "incomplete");
  assert.deepEqual(
    report.stages.map(({ status }) => status),
    ["skipped", "passed", "passed"],
  );
});

test("operational benchmark rejects a non-monotonic clock", async () => {
  const values = [100, 90, 80, 70];
  await assert.rejects(
    runOperationalReadinessBenchmark({
      clock: { now: () => values.shift() ?? 60 },
      environment: {},
      actions: {
        cleanInstall: async () => ({ evidence: {} }),
        firstProof: async () => ({ evidence: {} }),
        leaseRecovery: async () => ({ evidence: {} }),
      },
    }),
    /finite, monotonic/u,
  );
});
