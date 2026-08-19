import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_MODELS } from "../components/app-map-agent-types";
import { agentTargetQueues, buildAgentWorkers, journeyWorkerOptions } from "./app-map-agent-plan";

test("expands target and model coverage while preserving one serial queue per target", () => {
  let sequence = 0;
  const workers = buildAgentWorkers(
    [
      { serial: "pixel", name: "Pixel", platform: "android" },
      { serial: "ipad", name: "iPad", platform: "ios" },
    ],
    AGENT_MODELS.slice(0, 2),
    { strategy: "divide", areas: ["Account", "Settings"], actionBudget: 60 },
    () => `worker-${++sequence}`,
  );
  assert.deepEqual(
    workers.map((worker) => worker.focus),
    ["Account", "Settings", "Account", "Settings"],
  );

  assert.equal(workers.length, 4);
  assert.deepEqual(
    workers.map((worker) => [worker.targetId, worker.model.id]),
    [
      ["pixel", "relay"],
      ["pixel", "gpt"],
      ["ipad", "relay"],
      ["ipad", "gpt"],
    ],
  );
  assert.deepEqual(
    agentTargetQueues(workers).map((queue) => queue.map((worker) => worker.id)),
    [
      ["worker-1", "worker-2"],
      ["worker-3", "worker-4"],
    ],
  );
});

test("every crawl that reached a session is offered as its own journey", () => {
  let sequence = 0;
  const workers = buildAgentWorkers(
    [
      { serial: "pixel", name: "Pixel", platform: "android" },
      { serial: "ipad", name: "iPad", platform: "ios" },
    ],
    AGENT_MODELS.slice(0, 1),
    { strategy: "divide", areas: ["Account", "Settings"], actionBudget: 60 },
    () => `worker-${++sequence}`,
  ).map((worker, index) => ({
    ...worker,
    ...(index === 0
      ? { sessionId: "session-1", status: "running" as const }
      : { sessionId: "session-2", status: "complete" as const }),
  }));

  assert.deepEqual(journeyWorkerOptions(workers), [
    { id: "worker-1", label: "Account", detail: "Pixel", live: true },
    { id: "worker-2", label: "Settings", detail: "iPad", live: false },
  ]);
});

test("a worker without a session has no journey to show, and compare falls back to the model", () => {
  let sequence = 0;
  const workers = buildAgentWorkers(
    [{ serial: "pixel", name: "Pixel", platform: "android" }],
    AGENT_MODELS.slice(0, 2),
    { strategy: "compare", areas: ["Account"], actionBudget: 60 },
    () => `worker-${++sequence}`,
  ).map((worker, index) => (index === 0 ? { ...worker, sessionId: "session-1" } : worker));

  assert.deepEqual(journeyWorkerOptions(workers), [
    { id: "worker-1", label: "Relay", detail: "Pixel", live: false },
  ]);
});
