import assert from "node:assert/strict";
import test from "node:test";
import { createSignal } from "solid-js";
import type { RelayClient } from "@relay/client";
import type { JobInfo, PersistedRun, RunEvidenceQuery } from "./api-types";
import { createServerRunReportController } from "./server-run-report-controller";

test("run detail and evidence reads use registered operations", async () => {
  const [jobs, setJobs] = createSignal<JobInfo[]>([]);
  const [runs, setRuns] = createSignal<PersistedRun[]>([]);
  const calls: Array<{ operationId: string; input: unknown }> = [];
  const persisted = {
    id: "run-1",
    action: "app-map.test.run",
    status: "ok",
    attempts: 1,
    dir: "run-1",
    frames: [],
    steps: [],
    logs: [],
    writtenAt: 1,
  } as PersistedRun;
  const evidence = { runId: "run-1", events: [] } as unknown as RunEvidenceQuery;
  const runAction = (async (operationId: string, input: unknown) => {
    calls.push({ operationId, input });
    if (operationId === "run.get") return { run: persisted };
    if (operationId === "job.get") {
      return {
        job: { id: "job-1", action: "app-map.test.run", status: "running", queuedAt: 1 },
      };
    }
    if (operationId === "run.evidence.get") return { evidence };
    throw new Error(`unexpected operation ${operationId}`);
  }) as Parameters<typeof createServerRunReportController>[0]["runAction"];
  const controller = createServerRunReportController({
    client: async () => ({ resource: async () => ({ signals: [] }) }) as unknown as RelayClient,
    runAction,
    setJobs,
    setPersistedRuns: setRuns,
    refreshRuns: async () => undefined,
  });

  await controller.loadRunDetail("run-1", true);
  const loadedEvidence = await controller.loadRunEvidence("run-1", {
    limit: 25,
    includeBodies: true,
  });

  assert.equal(runs()[0]?.id, "run-1");
  assert.deepEqual(loadedEvidence, evidence);
  assert.deepEqual(calls, [
    { operationId: "run.get", input: { runId: "run-1" } },
    {
      operationId: "run.evidence.get",
      input: { runId: "run-1", limit: 25, includeBodies: true },
    },
  ]);
  assert.deepEqual(jobs(), []);
});

test("unregistered regression signals remain a metadata resource", async () => {
  const paths: string[] = [];
  const controller = createServerRunReportController({
    client: async () =>
      ({
        resource: async (path: string) => {
          paths.push(path);
          return { signals: [] };
        },
      }) as unknown as RelayClient,
    runAction: async () => {
      throw new Error("unexpected registered operation");
    },
    setJobs: () => [],
    setPersistedRuns: () => [],
    refreshRuns: async () => undefined,
  });

  assert.deepEqual(await controller.loadRunSignals("run/1"), []);
  assert.deepEqual(paths, ["/runs/run%2F1/signals"]);
});
