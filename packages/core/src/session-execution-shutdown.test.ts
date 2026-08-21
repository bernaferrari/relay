import assert from "node:assert/strict";
import test from "node:test";
import {
  SessionExecutionShutdownError,
  shutdownSessionExecutions,
} from "./session-execution-shutdown.js";
import type { TestJob } from "./session-contract.js";

function job(id: string): TestJob {
  return { id } as TestJob;
}

test("session shutdown cancels every active job and waits for its lifecycle boundary", async () => {
  const jobs = [job("queued"), job("running")];
  const cancelled: string[] = [];
  const completions = new Map<string, () => void>();
  const shutdown = shutdownSessionExecutions(
    {
      activeJobs: () => jobs,
      cancelJob: (id) => {
        cancelled.push(id);
        return job(id);
      },
      waitForCompletion: (id) =>
        new Promise<TestJob>((resolve) => {
          completions.set(id, () => resolve(job(id)));
        }),
    },
    { timeoutMs: 100 },
  );

  assert.deepEqual(cancelled, ["queued", "running"]);
  jobs.length = 0;
  completions.get("queued")?.();
  completions.get("running")?.();
  await shutdown;
});

test("session shutdown does not truncate a large active campaign", async () => {
  const jobs = Array.from({ length: 101 }, (_, index) => job(`campaign-${index}`));
  const expected = jobs.map((item) => item.id);
  const cancelled: string[] = [];
  await shutdownSessionExecutions(
    {
      activeJobs: () => jobs,
      cancelJob: (id) => {
        cancelled.push(id);
        jobs.splice(
          jobs.findIndex((item) => item.id === id),
          1,
        );
        return job(id);
      },
      waitForCompletion: async (id) => job(id),
    },
    { timeoutMs: 100 },
  );
  assert.deepEqual(cancelled, expected);
});

test("session shutdown fails closed when a job cannot reach completion in time", async () => {
  const active = [job("stuck")];
  await assert.rejects(
    shutdownSessionExecutions(
      {
        activeJobs: () => active,
        cancelJob: (id) => job(id),
        waitForCompletion: () => new Promise<TestJob>(() => undefined),
      },
      { timeoutMs: 10 },
    ),
    (error: unknown) =>
      error instanceof SessionExecutionShutdownError &&
      error.code === "SESSION_EXECUTION_SHUTDOWN_TIMEOUT" &&
      error.jobIds.includes("stuck"),
  );
});
