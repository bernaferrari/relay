import assert from "node:assert/strict";
import test from "node:test";
import { createSignal } from "solid-js";
import type { JobInfo, PersistedRun } from "./api-types";
import { createServerJobController } from "./server-job-controller";

function job(id: string): JobInfo {
  return { id, action: "app-map.test.run", status: "queued", queuedAt: 1, logs: [] };
}

test("overlapping job refreshes use one read plus one trailing latest read", async () => {
  const [jobs, setJobs] = createSignal<JobInfo[]>([]);
  const [, setRuns] = createSignal<PersistedRun[]>([]);
  const [, setRunsRoot] = createSignal("");
  const [, setRunning] = createSignal(false);
  let reads = 0;
  let releaseFirst!: () => void;
  const firstRead = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const controller = createServerJobController({
    request: async <Value>(path: string) => {
      assert.equal(path, "/jobs");
      reads += 1;
      if (reads === 1) {
        await firstRead;
        return { jobs: [job("stale")], active: null } as Value;
      }
      return { jobs: [job("fresh")], active: null } as Value;
    },
    client: async () => null as never,
    health: () => "online",
    jobs,
    setJobs,
    persistedRuns: () => [],
    setPersistedRuns: setRuns,
    setRunsRoot,
    setRunning,
    selectedJobId: () => null,
    appendLog: () => undefined,
  });

  const first = controller.refreshJobs();
  const concurrent = controller.refreshJobs();
  await Promise.resolve();
  assert.equal(reads, 1);

  const afterEvent = controller.refreshJobs();
  releaseFirst();
  assert.deepEqual(await Promise.all([first, concurrent]), [{ ok: true }, { ok: true }]);

  await Promise.resolve();
  assert.equal(reads, 2);
  assert.deepEqual(await afterEvent, { ok: true });
  assert.deepEqual(
    jobs().map((current) => current.id),
    ["fresh"],
  );
});

test("a failed job refresh recovers on the next request", async () => {
  const [, setJobs] = createSignal<JobInfo[]>([]);
  const [, setRuns] = createSignal<PersistedRun[]>([]);
  const [, setRunsRoot] = createSignal("");
  const [, setRunning] = createSignal(false);
  let reads = 0;
  const controller = createServerJobController({
    request: async <Value>() => {
      reads += 1;
      if (reads === 1) throw new Error("temporary job transport failure");
      return { jobs: [], active: null } as Value;
    },
    client: async () => null as never,
    health: () => "online",
    jobs: () => [],
    setJobs,
    persistedRuns: () => [],
    setPersistedRuns: setRuns,
    setRunsRoot,
    setRunning,
    selectedJobId: () => null,
    appendLog: () => undefined,
  });

  assert.deepEqual(await controller.refreshJobs(), {
    ok: false,
    error: "temporary job transport failure",
  });
  assert.deepEqual(await controller.refreshJobs(), { ok: true });
  assert.equal(reads, 2);
});
