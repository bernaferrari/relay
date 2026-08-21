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

test("gives each physical target its own local execution lane", () => {
  assert.deepEqual(defaultTargetWorkerAssignment({ targetId: "a", platform: "ios" }), {
    workerId: "local:ios:target:a",
    targetId: "a",
    capacity: 1,
  });
  assert.deepEqual(defaultTargetWorkerAssignment({ targetId: "b", platform: "android" }), {
    workerId: "local:android:target:b",
    targetId: "b",
    capacity: 1,
  });
  assert.deepEqual(
    defaultTargetWorkerAssignment({
      targetId: "ipad-b",
      platform: "ios",
      workerId: "mac-xcode",
      workerCapacity: 2,
    }),
    {
      workerId: "local:ios:target:ipad-b",
      targetId: "ipad-b",
      capacity: 1,
      host: { workerId: "mac-xcode", capacity: 2 },
    },
  );
});

test("runs two default iOS target lanes concurrently", async () => {
  const scheduler = new TargetWorkerScheduler();
  const first = deferred();
  const second = deferred();
  const started: string[] = [];
  const left = defaultTargetWorkerAssignment({ targetId: "ipad-a", platform: "ios" });
  const right = defaultTargetWorkerAssignment({ targetId: "ipad-b", platform: "ios" });

  scheduler.enqueue({
    id: "ipad-a",
    ...left,
    run: async () => {
      started.push("ipad-a");
      await first.promise;
    },
  });
  scheduler.enqueue({
    id: "ipad-b",
    ...right,
    run: async () => {
      started.push("ipad-b");
      await second.promise;
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["ipad-a", "ipad-b"]);
  first.resolve();
  second.resolve();
});

test("applies an explicit host ceiling across independent target lanes", async () => {
  const scheduler = new TargetWorkerScheduler();
  const first = deferred();
  const second = deferred();
  const started: string[] = [];
  const left = defaultTargetWorkerAssignment({
    targetId: "ipad-a",
    platform: "ios",
    hostWorkerId: "mac-xcode",
    hostWorkerCapacity: 1,
  });
  const right = defaultTargetWorkerAssignment({
    targetId: "ipad-b",
    platform: "ios",
    hostWorkerId: "mac-xcode",
    hostWorkerCapacity: 1,
  });

  scheduler.enqueue({
    id: "ipad-a",
    ...left,
    run: async () => {
      started.push("ipad-a");
      await first.promise;
    },
  });
  scheduler.enqueue({
    id: "ipad-b",
    ...right,
    run: async () => {
      started.push("ipad-b");
      await second.promise;
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["ipad-a"]);
  assert.deepEqual(scheduler.statuses(), [
    {
      workerId: "local:ios:target:ipad-a",
      capacity: 1,
      active: 1,
      queued: 0,
      activeTargets: ["ipad-a"],
      queuedTargets: [],
      host: { workerId: "mac-xcode", capacity: 1, active: 1, queued: 1 },
    },
    {
      workerId: "local:ios:target:ipad-b",
      capacity: 1,
      active: 0,
      queued: 1,
      activeTargets: [],
      queuedTargets: ["ipad-b"],
      host: { workerId: "mac-xcode", capacity: 1, active: 1, queued: 1 },
    },
  ]);

  first.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["ipad-a", "ipad-b"]);
  second.resolve();
});
