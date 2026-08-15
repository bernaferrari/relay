import assert from "node:assert/strict";
import test from "node:test";
import { summarizeExecutionOperationResult } from "./execution-summary.js";

test("job.get keeps a useful tail of logs for agents watching a tour", () => {
  const logs = Array.from({ length: 30 }, (_, index) => `tour → stop ${index + 1}`);
  const result = summarizeExecutionOperationResult("job.get", {
    job: {
      id: "job-1",
      status: "running",
      title: "Settings · depth 0",
      logs,
      lastLogs: logs.slice(-12),
      steps: [{ id: "s1", title: "Tour visible rows", status: "running" }],
    },
  }) as { job?: { logs?: string[]; lastLogs?: unknown; stepCount?: number } };

  assert.equal(result.job?.stepCount, 1);
  assert.deepEqual(result.job?.logs, logs.slice(-24));
  assert.equal(result.job?.logs?.at(-1), "tour → stop 30");
});

test("job.get falls back to lastLogs when the compact summary omitted the full ring", () => {
  const result = summarizeExecutionOperationResult("job.get", {
    job: {
      id: "job-1",
      status: "running",
      lastLogs: ["tour: 14 stop(s)", "tour → Appearance"],
    },
  }) as { job?: { logs?: string[] } };
  assert.deepEqual(result.job?.logs, ["tour: 14 stop(s)", "tour → Appearance"]);
});

test("job.get retains bounded campaign outcomes and lineage", () => {
  const result = summarizeExecutionOperationResult("job.get", {
    job: {
      id: "job-1",
      status: "running",
      batchId: "campaign-1",
      caseIndex: 2,
      caseCount: 40,
      artifacts: [
        {
          kind: "campaign-check-result",
          data: {
            id: "settings",
            title: "Settings",
            status: "failed",
            error: "screen changed",
            startedAt: 100,
            finishedAt: 180,
          },
        },
        { kind: "screenshot", data: { base64: "must-not-leak" } },
      ],
    },
  }) as {
    job?: {
      batchId?: string;
      caseIndex?: number;
      caseCount?: number;
      checks?: Array<Record<string, unknown>>;
    };
  };

  assert.equal(result.job?.batchId, "campaign-1");
  assert.equal(result.job?.caseIndex, 2);
  assert.equal(result.job?.caseCount, 40);
  assert.deepEqual(result.job?.checks, [
    {
      id: "settings",
      title: "Settings",
      status: "failed",
      error: "screen changed",
      startedAt: 100,
      finishedAt: 180,
      durationMs: 80,
    },
  ]);
});
