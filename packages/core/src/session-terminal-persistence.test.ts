import assert from "node:assert/strict";
import test from "node:test";
import { commitTerminalSessionRun } from "./session-terminal-persistence.js";
import type { TestJob } from "./session-contract.js";

function terminalJob(): TestJob {
  return {
    id: "terminal-persistence",
    targetContext: { kind: "device", platform: "android", serial: "emulator-5554" },
    action: "settings-tour",
    recipeId: "settings-tour",
    serial: "emulator-5554",
    platform: "android",
    status: "ok",
    queuedAt: 1_000,
    startedAt: 1_100,
    finishedAt: 1_200,
    logs: [],
    attempts: 1,
    steps: [],
    frames: [],
    glyphs: ["ai"],
    kind: "Replay",
    tone: "acc",
    title: "Settings tour",
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
}

function setOutcome(job: TestJob): void {
  job.outcome = job.status === "ok" || job.status === "healed" ? "passed" : "harness-failure";
}

test("manifest failure replaces a would-be pass with a durable non-pass verdict", async () => {
  const job = terminalJob();
  let attempts = 0;
  const result = await commitTerminalSessionRun(job, () => undefined, {
    persistRun: async (candidate) => {
      attempts += 1;
      if (attempts === 1) throw new Error("disk unavailable at /private/relay/runs");
      candidate.persisted = true;
      return { id: candidate.id } as never;
    },
    projectPersistedRun: async () => undefined,
    now: () => 1_300,
    setOutcome,
  });

  assert.deepEqual(result, { durable: true, replacedWithNonPass: true });
  assert.equal(attempts, 2);
  assert.equal(job.status, "error");
  assert.equal(job.outcome, "harness-failure");
  assert.equal(job.errorCode, "INTERNAL");
  assert.equal(job.healed, undefined);
  assert.equal(job.persisted, true);
  assert.deepEqual(job.artifacts.at(-1)?.data, {
    schemaVersion: 1,
    code: "RUN_MANIFEST_COMMIT_FAILED",
  });
});

test("a second manifest failure leaves the target-owning job non-durable and non-pass", async () => {
  const job = terminalJob();
  const logs: string[] = [];
  const result = await commitTerminalSessionRun(job, (line) => logs.push(line), {
    persistRun: async () => {
      throw new Error("storage unavailable");
    },
    projectPersistedRun: async () => undefined,
    now: () => 1_300,
    setOutcome,
  });

  assert.deepEqual(result, { durable: false });
  assert.equal(job.status, "error");
  assert.equal(job.outcome, "harness-failure");
  assert.equal(job.persisted, undefined);
  assert.ok(logs.some((line) => line.includes("target stays fenced")));
});
