import assert from "node:assert/strict";
import test from "node:test";
import {
  agentTargetQueues,
  buildAgentWorkers,
  explorationTimelineWorkerOptions,
} from "./app-map-agent-plan";

test("creates one explainable worker per target", () => {
  let sequence = 0;
  const workers = buildAgentWorkers(
    [
      { serial: "pixel", name: "Pixel", platform: "android" },
      { serial: "ipad", name: "iPad", platform: "ios" },
    ],
    { strategy: "divide", areas: ["Account", "Settings"], actionBudget: 60 },
    () => `worker-${++sequence}`,
  );
  assert.deepEqual(
    workers.map((worker) => worker.focus),
    ["Account", "Settings"],
  );

  assert.equal(workers.length, 2);
  assert.deepEqual(
    workers.map((worker) => worker.targetId),
    ["pixel", "ipad"],
  );
  assert.deepEqual(
    agentTargetQueues(workers).map((queue) => queue.map((worker) => worker.id)),
    [["worker-1"], ["worker-2"]],
  );
});

test("every crawl that reached a session is offered as its own exploration timeline", () => {
  let sequence = 0;
  const workers = buildAgentWorkers(
    [
      { serial: "pixel", name: "Pixel", platform: "android" },
      { serial: "ipad", name: "iPad", platform: "ios" },
    ],
    { strategy: "divide", areas: ["Account", "Settings"], actionBudget: 60 },
    () => `worker-${++sequence}`,
  ).map((worker, index) => ({
    ...worker,
    ...(index === 0
      ? { sessionId: "session-1", status: "running" as const }
      : { sessionId: "session-2", status: "complete" as const }),
  }));

  assert.deepEqual(explorationTimelineWorkerOptions(workers), [
    { id: "worker-1", label: "Account", detail: "Pixel", live: true },
    { id: "worker-2", label: "Settings", detail: "iPad", live: false },
  ]);
});

test("a worker without a session has no exploration timeline to show", () => {
  let sequence = 0;
  const workers = buildAgentWorkers(
    [{ serial: "pixel", name: "Pixel", platform: "android" }],
    { strategy: "compare", areas: ["Account"], actionBudget: 60 },
    () => `worker-${++sequence}`,
  ).map((worker, index) => (index === 0 ? { ...worker, sessionId: "session-1" } : worker));

  assert.deepEqual(explorationTimelineWorkerOptions(workers), [
    { id: "worker-1", label: "Relay", detail: "Pixel", live: false },
  ]);
});
