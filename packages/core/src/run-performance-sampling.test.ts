import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { sampleRunPerformance } from "./run-performance-sampling.js";

test("performance probes never overlap and stopping drops an in-flight result", async () => {
  let calls = 0;
  let complete!: (value: unknown) => void;
  const retained: unknown[] = [];
  const sampler = sampleRunPerformance({
    intervalMs: 1,
    probe: () => {
      calls++;
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
    retain: (value) => retained.push(value),
    onError: (error) => {
      throw error;
    },
  });
  await delay(15);
  assert.equal(calls, 1);
  const stopped = sampler.stop();
  complete({ cpu: 1 });
  await stopped;
  await delay(5);
  assert.equal(calls, 1);
  assert.deepEqual(retained, []);
});

test("a failing performance probe ends sampling without repeated failures", async () => {
  let calls = 0;
  const errors: unknown[] = [];
  const sampler = sampleRunPerformance({
    intervalMs: 1,
    probe: async () => {
      calls++;
      throw new Error("unavailable");
    },
    retain: () => assert.fail("failed samples must not be retained"),
    onError: (error) => errors.push(error),
  });
  await delay(15);
  await sampler.stop();
  assert.equal(calls, 1);
  assert.equal(errors.length, 1);
});

test("a transient performance timeout resumes sampling after the probe settles", async () => {
  let calls = 0;
  const retained: unknown[] = [];
  const errors: unknown[] = [];
  const sampler = sampleRunPerformance({
    intervalMs: 1,
    limit: 1,
    shouldRetry: (error) =>
      error instanceof Error && error.message === "Performance sample timed out",
    probe: async () => {
      calls++;
      if (calls === 1) throw new Error("Performance sample timed out");
      return { cpu: 12 };
    },
    retain: (value) => retained.push(value),
    onError: (error) => errors.push(error),
  });
  await delay(25);
  await sampler.stop();
  assert.equal(calls, 2);
  assert.equal(errors.length, 1);
  assert.deepEqual(retained, [{ cpu: 12 }]);
});

test("repeated transient failures exhaust a bounded retry budget", async () => {
  let calls = 0;
  const sampler = sampleRunPerformance({
    intervalMs: 1,
    shouldRetry: () => true,
    probe: async () => {
      calls++;
      throw new Error("timeout");
    },
    retain: () => assert.fail("no invented samples"),
    onError: () => undefined,
  });
  await delay(40);
  await sampler.stop();
  assert.equal(calls, 3);
});
