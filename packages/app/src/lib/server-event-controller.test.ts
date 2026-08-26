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
