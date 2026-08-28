import assert from "node:assert/strict";
import test from "node:test";
import { createSignal } from "solid-js";
import type { RelayClient } from "@relay/client";
import type { EventEnvelope } from "@relay/protocol";
import { createCoalescedRefresh } from "./coalesced-refresh";
import { type EventRefresh } from "./event-projection";
import { createServerEventController } from "./server-event-controller";

function jobStep(sequence: number): EventEnvelope {
  return {
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    sequence,
    actorId: "agent:runner",
    actorKind: "agent",
    organizationId: "local",
    projectId: "default",
    operationId: "app-map.test.run",
    requestId: `request-${sequence}`,
    occurredAt: sequence,
    payload: {
      type: "job.step",
      at: sequence,
      action: "app-map.test.run",
      jobId: "job-1",
      step: { title: `step ${sequence}`, status: "running" },
    },
  };
}

test("a burst of job events causes one effective job refresh", async () => {
  let reads = 0;
  const refreshJobs = createCoalescedRefresh(async () => {
    reads += 1;
  });
  const ignore = async () => undefined;
  const refreshers = {
    devices: ignore,
    appMaps: ignore,
    jobs: refreshJobs,
    runs: ignore,
    variables: ignore,
    matrices: ignore,
    discoveries: ignore,
    authoring: ignore,
  } satisfies Record<EventRefresh, () => Promise<unknown>>;
  let emit: ((event: EventEnvelope) => void) | undefined;
  const client = {
    events: async (
      onEvent: (event: EventEnvelope) => void,
      options: { signal?: AbortSignal; onOpen?: () => void },
    ) => {
      emit = onEvent;
      options.onOpen?.();
      await new Promise<void>((resolve) => {
        options.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  } as unknown as RelayClient;
  const [, setRunning] = createSignal(false);
  const [, setSelectedJobId] = createSignal<string | null>(null);
  const controller = createServerEventController({
    client: () => client,
    refreshers,
    appendLog: () => undefined,
    pushFrame: () => ({}) as never,
    setRunning,
    selectedJobId: () => null,
    setSelectedJobId,
    loadRunDetail: async () => undefined,
    captureUiScreenshot: async () => ({}) as never,
  });

  controller.connect();
  assert.ok(emit);
  emit(jobStep(1));
  emit(jobStep(2));
  emit(jobStep(3));

  await Promise.resolve();
  assert.equal(reads, 1);
  controller.dispose();
});

test("workflow watchers receive only their bounded change and all watchers refresh on gaps", async () => {
  let emit: ((event: EventEnvelope) => void) | undefined;
  const client = {
    events: async (onEvent: (event: EventEnvelope) => void) => {
      emit = onEvent;
    },
  } as unknown as RelayClient;
  const [, setRunning] = createSignal(false);
  const [, setSelectedJobId] = createSignal<string | null>(null);
  const ignore = async () => undefined;
  const controller = createServerEventController({
    client: () => client,
    refreshers: {
      devices: ignore,
      appMaps: ignore,
      jobs: ignore,
      runs: ignore,
      variables: ignore,
      matrices: ignore,
      discoveries: ignore,
      authoring: ignore,
    },
    appendLog: () => undefined,
    pushFrame: () => ({}) as never,
    setRunning,
    selectedJobId: () => null,
    setSelectedJobId,
    loadRunDetail: ignore,
    captureUiScreenshot: async () => ({}) as never,
  });
  const first: unknown[] = [];
  const second: unknown[] = [];
  controller.watchWorkflow("workflow-1", (notice) => first.push(notice));
  controller.watchWorkflow("workflow-2", (notice) => second.push(notice));
  controller.connect();
  assert.ok(emit);
  emit!({
    ...jobStep(1),
    payload: {
      type: "workflow.changed",
      at: 1,
      workflowId: "workflow-1",
      version: 3,
      status: "active",
    },
  });
  emit!({
    ...jobStep(2),
    payload: {
      type: "stream.gap",
      at: 2,
      requestedAfter: 1,
      oldestAvailable: 9,
      latestAvailable: 10,
      requiresRefresh: true,
    },
  });
  assert.deepEqual(first, [{ kind: "changed", version: 3, status: "active" }, { kind: "gap" }]);
  assert.deepEqual(second, [{ kind: "gap" }]);
  controller.dispose();
});
