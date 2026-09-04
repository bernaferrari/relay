import assert from "node:assert/strict";
import test from "node:test";
import type { EventEnvelope } from "@relay/protocol";
import type { RepeatTestSnapshot } from "./types.js";
import { watchWorkflow, type WorkflowEventSource } from "./workflow-watch.js";

function snapshot(phase: RepeatTestSnapshot["phase"], version: number): RepeatTestSnapshot {
  return {
    schemaVersion: 1,
    kind: "repeat-test",
    title: "Repeat locales",
    phase,
    stage: phase === "succeeded" ? "complete" : "pilot",
    version: `workflow-v${version}`,
    workflow: { workflowId: "workflow-1", expectedVersion: version },
    outcomes: {
      selected: 1,
      observed: phase === "succeeded" ? 1 : 0,
      untouched: phase === "succeeded" ? 0 : 1,
      running: phase === "running" ? 1 : 0,
      passed: phase === "succeeded" ? 1 : 0,
      failed: 0,
      needsReview: 0,
      cancelled: 0,
    },
    results: [],
    progress: { label: phase },
    allowedNextActions: [],
    problems: [],
    evidenceRefs: [],
  };
}

function event(sequence: number, payload: EventEnvelope["payload"]): EventEnvelope {
  return {
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    sequence,
    actorId: "system:relay",
    actorKind: "system",
    organizationId: "acme",
    projectId: "mobile",
    operationId: "workflow.transition",
    requestId: `request-${sequence}`,
    occurredAt: sequence,
    payload,
  };
}

function openSource(emit: (onEvent: (event: EventEnvelope) => void) => void): WorkflowEventSource {
  return {
    events: async (onEvent, options) => {
      options?.onOpen?.();
      emit(onEvent);
      await new Promise<void>((resolve) => {
        options?.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  };
}

test("workflow watch ignores other identities and refreshes canonically after a newer event", async () => {
  let inspections = 0;
  const updates: RepeatTestSnapshot[] = [];
  const settled = await watchWorkflow({
    workflowId: "workflow-1",
    initial: snapshot("running", 2),
    source: openSource((onEvent) => {
      setTimeout(() => {
        onEvent(
          event(1, {
            type: "workflow.changed",
            at: 1,
            workflowId: "workflow-other",
            version: 99,
            status: "terminal",
          }),
        );
        onEvent(
          event(2, {
            type: "workflow.changed",
            at: 2,
            workflowId: "workflow-1",
            version: 3,
            status: "terminal",
          }),
        );
      }, 0);
    }),
    inspect: async () => {
      inspections += 1;
      return inspections === 1 ? snapshot("running", 2) : snapshot("succeeded", 3);
    },
    onSnapshot: (next) => updates.push(next as RepeatTestSnapshot),
  });
  assert.equal(inspections, 2);
  assert.equal(settled.phase, "succeeded");
  assert.deepEqual(
    updates.map((update) => update.workflow?.expectedVersion),
    [2, 3],
  );
});

test("a stream gap refreshes the canonical workflow without consuming event payload state", async () => {
  let inspections = 0;
  const settled = await watchWorkflow({
    workflowId: "workflow-1",
    initial: snapshot("running", 2),
    source: openSource((onEvent) => {
      setTimeout(() => {
        onEvent(
          event(20, {
            type: "stream.gap",
            at: 20,
            requestedAfter: 1,
            oldestAvailable: 10,
            latestAvailable: 19,
            requiresRefresh: true,
          }),
        );
      }, 0);
    }),
    inspect: async () => {
      inspections += 1;
      return inspections === 1 ? snapshot("running", 2) : snapshot("succeeded", 4);
    },
  });
  assert.equal(inspections, 2);
  assert.equal(settled.workflow?.expectedVersion, 4);
});

test("an open stream refreshes canonical state even when replay is empty", async () => {
  let inspections = 0;
  const settled = await watchWorkflow({
    workflowId: "workflow-1",
    initial: snapshot("running", 2),
    source: openSource(() => undefined),
    inspect: async () => {
      inspections += 1;
      return snapshot("succeeded", 7);
    },
  });
  assert.equal(inspections, 1);
  assert.equal(settled.workflow?.expectedVersion, 7);
});

test("a connected but idle stream still reconciles a terminal resource", async () => {
  let inspections = 0;
  const settled = await watchWorkflow({
    workflowId: "workflow-1",
    initial: snapshot("running", 2),
    source: openSource(() => undefined),
    connectedRefreshMs: 5,
    inspect: async () => {
      inspections += 1;
      return inspections === 1 ? snapshot("running", 2) : snapshot("succeeded", 3);
    },
  });
  assert.equal(inspections, 2);
  assert.equal(settled.phase, "succeeded");
});

test("a disconnected event stream uses only the slow canonical fallback", async () => {
  let inspections = 0;
  const settled = await watchWorkflow({
    workflowId: "workflow-1",
    initial: snapshot("running", 2),
    source: { events: async () => Promise.reject(new Error("offline")) },
    disconnectedRefreshMs: 5,
    reconnectMs: 1_000,
    inspect: async () => {
      inspections += 1;
      return snapshot("succeeded", 3);
    },
  });
  assert.equal(inspections, 1);
  assert.equal(settled.phase, "succeeded");
});
