import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_MODELS } from "../components/app-map-agent-types";
import { agentTargetQueues, buildAgentWorkers } from "./app-map-agent-plan";

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
