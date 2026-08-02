import assert from "node:assert/strict";
import test from "node:test";
import { TargetWorkerScheduler, defaultTargetWorkerAssignment } from "./target-worker.js";

function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve,
  };
}

test("runs independent targets up to worker capacity while serializing one target", async () => {
  const scheduler = new TargetWorkerScheduler();
  const first = deferred();
  const second = deferred();
  const duplicate = deferred();
  const started: string[] = [];

  scheduler.enqueue({
    id: "a",
    workerId: "worker",
    targetId: "phone-a",
    capacity: 2,
    run: async () => {
      started.push("a");
      await first.promise;
    },
  });
  scheduler.enqueue({
    id: "b",
    workerId: "worker",
    targetId: "phone-b",
    capacity: 2,
    run: async () => {
      started.push("b");
      await second.promise;
    },
  });
  scheduler.enqueue({
    id: "a-again",
    workerId: "worker",
    targetId: "phone-a",
    capacity: 2,
    run: async () => {
      started.push("a-again");
      await duplicate.promise;
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["a", "b"]);
  assert.deepEqual(scheduler.statuses(), [
    {
      workerId: "worker",
      capacity: 2,
      active: 2,
      queued: 1,
      activeTargets: ["phone-a", "phone-b"],
      queuedTargets: ["phone-a"],
    },
  ]);

  first.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["a", "b", "a-again"]);
  second.resolve();
  duplicate.resolve();
});

test("uses conservative, platform-specific worker defaults", () => {
  assert.deepEqual(defaultTargetWorkerAssignment({ targetId: "a", platform: "ios" }), {
    workerId: "local:ios",
    targetId: "a",
    capacity: 1,
  });
  assert.deepEqual(defaultTargetWorkerAssignment({ targetId: "b", platform: "android" }), {
    workerId: "local:android",
    targetId: "b",
    capacity: 2,
  });
});
