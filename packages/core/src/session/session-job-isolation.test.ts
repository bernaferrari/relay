import assert from "node:assert/strict";
import test from "node:test";
import { compileBrowserEnvironment } from "@relay/protocol";
import { createSessionJob } from "./session-job-factory.js";
import { scheduledSessionJob } from "./session-batch-admission.js";
import { jobSchedulingTargetId } from "../browser/browser-account-lane.js";
import { executionTargetRefForJob } from "../target/target-driver.js";
import { TargetWorkerScheduler } from "../target/target-worker.js";
import type { EnqueueJobInput, TestJob } from "./session-contract.js";

function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve,
  };
}

function makeJob(input: EnqueueJobInput): TestJob {
  return createSessionJob(input, {
    findJob: () => undefined,
    toTransport: (job) => job,
  });
}

function browserInput(input: Partial<EnqueueJobInput> = {}): EnqueueJobInput {
  return {
    recipe: "recipe:web-proof",
    targetKind: "browser",
    browserTargetId: "shop-web",
    browserCaseProfile: compileBrowserEnvironment({ engine: "chromium" }),
    ...input,
  };
}

function schedulingTargetId(job: TestJob): string {
  return jobSchedulingTargetId({
    executionTarget: executionTargetRefForJob(job),
    browserCaseProfile: job.browserCaseProfile,
    unsignedLaneId: job.unsignedLaneId,
  });
}

test("independent classified unsigned browser jobs receive per-run lanes and fan out", async () => {
  const jobs = ["a", "b", "c"].map((name) =>
    makeJob(browserInput({ title: name, browserIsolation: "independent" })),
  );
  // Every run owns a distinct per-run unsigned lane identity, so neither the
  // scheduler lane nor the Playwright session key can collide.
  assert.equal(new Set(jobs.map((job) => job.unsignedLaneId)).size, 3);
  for (const job of jobs) {
    assert.match(job.unsignedLaneId!, /^unsigned-run:/u);
    assert.equal(job.browserIsolation, "independent");
    assert.equal(job.laneId, undefined, "a synthetic lane is not user-invoked provenance");
    assert.notEqual(schedulingTargetId(job), "shop-web#signed-out");
  }

  const scheduler = new TargetWorkerScheduler();
  const gates = jobs.map(() => deferred());
  const started: string[] = [];
  const finished: string[] = [];
  const startedAt = new Map<string, number>();
  const endedAt = new Map<string, number>();
  for (const [index, job] of jobs.entries()) {
    scheduler.enqueue(
      scheduledSessionJob({
        job,
        run: async () => {
          started.push(job.id);
          startedAt.set(job.id, performance.now());
          await gates[index]!.promise;
          endedAt.set(job.id, performance.now());
          finished.push(job.id);
        },
      }),
    );
  }
  await new Promise((resolve) => setImmediate(resolve));
  // All three overlap in execution: every run started before any finished.
  assert.deepEqual(started.length, 3);
  assert.deepEqual(finished, []);
  for (const gate of gates) gate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished.length, 3);
  for (const job of jobs) {
    assert.ok(startedAt.get(job.id)! < [...endedAt.values()].reduce((a, b) => Math.max(a, b)));
  }
});

test("unclassified unsigned browser jobs keep the legacy shared lane and serialize", async () => {
  const jobs = ["a", "b"].map((name) => makeJob(browserInput({ title: name })));
  for (const job of jobs) {
    assert.equal(job.unsignedLaneId, undefined);
    assert.equal(job.browserIsolation, undefined);
    assert.equal(schedulingTargetId(job), "shop-web#signed-out");
  }
  const scheduler = new TargetWorkerScheduler();
  const gates = [deferred(), deferred()];
  const started: string[] = [];
  for (const [index, job] of jobs.entries()) {
    scheduler.enqueue(
      scheduledSessionJob({
        job,
        run: async () => {
          started.push(job.id);
          await gates[index]!.promise;
        },
      }),
    );
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 1, "the shared unsigned lane is still one-at-a-time");
  gates[0]!.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 2);
  gates[1]!.resolve();
});

test("batched cells never receive per-run isolation even when classified", () => {
  const job = makeJob(
    browserInput({ browserIsolation: "independent", batchId: "batch-1", caseIndex: 0 }),
  );
  assert.equal(job.unsignedLaneId, undefined);
  assert.equal(job.browserIsolation, undefined);
  assert.equal(schedulingTargetId(job), "shop-web#signed-out");
});

test("fixture accounts keep their account lane instead of per-run isolation", () => {
  const job = makeJob(
    browserInput({
      browserIsolation: "independent",
      browserCaseProfile: compileBrowserEnvironment({
        engine: "chromium",
        authenticationFixtureId: "authfx:member:1",
      }),
    }),
  );
  assert.equal(job.unsignedLaneId, undefined);
  assert.equal(job.browserIsolation, undefined);
  assert.equal(schedulingTargetId(job), "shop-web#authfx:member:1");
});

test("two independent jobs sharing one account fixture still serialize", async () => {
  const fixtureProfile = compileBrowserEnvironment({
    engine: "chromium",
    authenticationFixtureId: "authfx:member:1",
  });
  const jobs = ["a", "b"].map((name) =>
    makeJob(browserInput({ title: name, browserCaseProfile: fixtureProfile })),
  );
  const scheduler = new TargetWorkerScheduler();
  const gates = [deferred(), deferred()];
  const started: string[] = [];
  for (const [index, job] of jobs.entries()) {
    scheduler.enqueue(
      scheduledSessionJob({
        job,
        run: async () => {
          started.push(job.id);
          await gates[index]!.promise;
        },
      }),
    );
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 1, "one server-side account remains one-at-a-time");
  gates[0]!.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 2);
  gates[1]!.resolve();
});

test("invoked lanes keep their lane identity instead of per-run isolation", () => {
  const job = makeJob(browserInput({ browserIsolation: "independent", laneId: "nightly-a" }));
  assert.equal(job.unsignedLaneId, "nightly-a");
  assert.equal(job.browserIsolation, undefined);
  assert.equal(schedulingTargetId(job), "shop-web#signed-out:nightly-a");
});

test("independent lanes respect the browser host ceiling", async () => {
  const scheduler = new TargetWorkerScheduler();
  const count = 10;
  const jobs = Array.from({ length: count }, (_, index) =>
    makeJob(browserInput({ title: `job-${index}`, browserIsolation: "independent" })),
  );
  const gates = jobs.map(() => deferred());
  let active = 0;
  let maxActive = 0;
  for (const [index, job] of jobs.entries()) {
    scheduler.enqueue(
      scheduledSessionJob({
        job,
        run: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await gates[index]!.promise;
          active -= 1;
        },
      }),
    );
  }
  await new Promise((resolve) => setImmediate(resolve));
  // The default browser host ceiling admits 8 isolated runs at once; the rest
  // queue behind the ceiling rather than behind one another.
  assert.equal(maxActive, 8);
  for (const gate of gates.slice(0, 8)) gate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(maxActive <= 8);
  for (const gate of gates) gate.resolve();
});

test("a retry of an independent run earns a fresh per-run lane, not the parent's", () => {
  const parent = makeJob(browserInput({ browserIsolation: "independent" }));
  assert.match(parent.unsignedLaneId!, /^unsigned-run:/u);
  const retry = createSessionJob(
    browserInput({ browserIsolation: "independent", retryOf: parent.id }),
    { findJob: () => parent, toTransport: (job) => job },
  );
  assert.equal(retry.browserIsolation, "independent");
  assert.match(retry.unsignedLaneId!, /^unsigned-run:/u);
  assert.notEqual(retry.unsignedLaneId, parent.unsignedLaneId);
});

test("a retry of a Lane-bound run keeps the user-invoked lane", () => {
  const parent = makeJob(browserInput({ laneId: "nightly-a" }));
  const retry = createSessionJob(browserInput({ retryOf: parent.id }), {
    findJob: () => parent,
    toTransport: (job) => job,
  });
  assert.equal(retry.unsignedLaneId, "nightly-a");
  assert.equal(retry.browserIsolation, undefined);
});
