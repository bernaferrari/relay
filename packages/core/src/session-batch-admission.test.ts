import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  durableWorkerAssignmentStore,
  resetDurableWorkerAssignmentStoreForTests,
} from "./durable-worker-assignments.js";
import {
  prepareSessionJobBatch,
  scheduledSessionJob,
  type SessionBatchAdmissionDependencies,
  type SessionBatchInput,
} from "./session-batch-admission.js";
import type { EnqueueJobInput, TestJob } from "./session-contract.js";
import { TargetWorkerScheduler, type TargetWorkerStagedBatch } from "./target-worker.js";

function job(id: string): TestJob {
  return {
    id,
    projectId: "project-batch-admission",
    targetContext: { kind: "device", serial: `device-${id}`, platform: "android" },
    executionTarget: {
      schemaVersion: 1,
      kind: "local-device",
      provider: { key: "relay.local.agent-device", scope: "local" },
      targetId: `device-${id}`,
      platform: "android",
      identity: { kind: "device-serial", value: `device-${id}` },
    },
    action: "recipe:batch-admission",
    recipeId: "recipe:batch-admission",
    serial: `device-${id}`,
    platform: "android",
    targetKind: "device",
    workerId: `local:android:target:device-${id}`,
    workerCapacity: 1,
    status: "queued",
    queuedAt: 1_000,
    logs: [],
    attempts: 1,
    steps: [],
    frames: [],
    glyphs: ["ai"],
    kind: "Replay",
    tone: "acc",
    title: id,
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
}

function input(id: string): SessionBatchInput {
  return {
    input: { recipe: "recipe:batch-admission", serial: `device-${id}`, platform: "android" },
  };
}

function stagedBatch(calls: { dispatch: number; rollback: number }): TargetWorkerStagedBatch {
  return {
    dispatch() {
      calls.dispatch += 1;
    },
    rollback() {
      calls.rollback += 1;
    },
  };
}

function dependencies(
  inputJobs: readonly TestJob[],
  overrides: Partial<SessionBatchAdmissionDependencies>,
) {
  let cursor = 0;
  return {
    createJob(_input: EnqueueJobInput) {
      return inputJobs[cursor++]!;
    },
    validateJob() {},
    registerCompletion() {},
    forgetCompletion() {},
    linkRetry() {},
    unlinkRetry() {},
    remember() {},
    forgetUnstarted() {},
    reserveTargetControl() {},
    releaseTargetControl() {},
    scheduler: { stageBatch: () => stagedBatch({ dispatch: 0, rollback: 0 }) },
    schedule(current: TestJob) {
      return {
        id: current.id,
        workerId: current.workerId!,
        targetId:
          current.targetContext.kind === "device" ? current.targetContext.serial : "browser",
        capacity: current.workerCapacity!,
        run: async () => undefined,
      };
    },
    ...overrides,
  } satisfies SessionBatchAdmissionDependencies;
}

async function withStateRoot(operation: () => Promise<void> | void): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-session-batch-admission-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetDurableWorkerAssignmentStoreForTests();
  try {
    await operation();
  } finally {
    resetDurableWorkerAssignmentStoreForTests();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("a scheduler staging rejection writes no durable partial batch", async () => {
  await withStateRoot(() => {
    assert.throws(
      () =>
        prepareSessionJobBatch(
          [input("scheduler-rejected")],
          dependencies([job("scheduler-rejected")], {
            scheduler: {
              stageBatch() {
                throw new Error("scheduler policy changed");
              },
            },
          }),
        ),
      /scheduler policy changed/u,
    );
    assert.equal(durableWorkerAssignmentStore().list().length, 0);
  });
});

test("a pre-dispatch commit failure compensates registrations, reservations, and durable records", async () => {
  await withStateRoot(() => {
    const calls = {
      dispatch: 0,
      rollback: 0,
      completionsForgotten: [] as string[],
      rememberedForgotten: [] as string[],
      reservationsReleased: [] as string[],
    };
    const jobs = [job("first"), job("second")];
    const batch = prepareSessionJobBatch(
      [input("first"), input("second")],
      dependencies(jobs, {
        scheduler: { stageBatch: () => stagedBatch(calls) },
        forgetCompletion(current) {
          calls.completionsForgotten.push(current.id);
        },
        remember(current) {
          if (current.id === "second") throw new Error("injected registry failure");
        },
        forgetUnstarted(current) {
          calls.rememberedForgotten.push(current.id);
        },
        reserveTargetControl() {},
        releaseTargetControl(current) {
          calls.reservationsReleased.push(current.id);
        },
      }),
    );

    assert.throws(() => batch.commit(), /injected registry failure/u);
    assert.equal(calls.dispatch, 0);
    assert.equal(calls.rollback, 1);
    assert.deepEqual(calls.completionsForgotten, ["second", "first"]);
    assert.deepEqual(calls.rememberedForgotten, ["first"]);
    assert.deepEqual(calls.reservationsReleased, ["first"]);
    assert.equal(durableWorkerAssignmentStore().get("first")?.status, "cancelled");
    assert.equal(durableWorkerAssignmentStore().get("second")?.status, "cancelled");
    assert.doesNotThrow(() => batch.rollback());
  });
});

function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve,
  };
}

function browserFixtureJob(id: string, fixture: string): TestJob {
  return {
    id,
    projectId: "project-batch-admission",
    targetContext: { kind: "browser", targetId: "grok-com", platform: "browser" },
    executionTarget: {
      schemaVersion: 1,
      kind: "local-browser",
      provider: { key: "relay.local.browser", scope: "local" },
      targetId: "grok-com",
      platform: "browser",
      identity: { kind: "browser-target", value: "grok-com" },
    },
    browserCaseProfile: { engine: "chromium", authenticationFixtureId: fixture },
    action: "recipe:batch-admission",
    recipeId: "recipe:batch-admission",
    targetKind: "browser",
    browserTargetId: "grok-com",
    platform: "android",
    workerId: `local:browser:target:grok-com%23${encodeURIComponent(fixture)}`,
    workerCapacity: 1,
    hostWorkerId: "local:browser:host",
    hostWorkerCapacity: 8,
    status: "queued",
    queuedAt: 1_000,
    logs: [],
    attempts: 1,
    steps: [],
    frames: [],
    glyphs: ["ai"],
    kind: "Replay",
    tone: "acc",
    title: id,
    artifacts: [],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
}

test("scheduled browser fixture jobs use distinct lanes and start concurrently", async () => {
  const fixtures = ["authfx:a:1", "authfx:b:1", "authfx:c:1"] as const;
  const jobs = fixtures.map((fixture, index) => browserFixtureJob(`job-${index}`, fixture));
  const scheduled = jobs.map((job) => scheduledSessionJob({ job, run: async () => undefined }));
  assert.deepEqual(
    scheduled.map((work) => work.targetId),
    ["grok-com#authfx:a:1", "grok-com#authfx:b:1", "grok-com#authfx:c:1"],
  );
  assert.equal(new Set(scheduled.map((work) => work.workerId)).size, 3);

  const scheduler = new TargetWorkerScheduler();
  const gates = [deferred(), deferred(), deferred()];
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
  assert.deepEqual(started, ["job-0", "job-1", "job-2"]);
  for (const gate of gates) gate.resolve();
});

function browserUnsignedJob(id: string, laneId: string): TestJob {
  const schedulingKey = `grok-com#signed-out:${laneId}`;
  return {
    ...browserFixtureJob(id, "authfx:unused:1"),
    browserCaseProfile: { engine: "chromium" } as TestJob["browserCaseProfile"],
    unsignedLaneId: laneId,
    workerId: `local:browser:target:${encodeURIComponent(schedulingKey)}`,
  };
}

test("scheduled unsigned Lane jobs use distinct signed-out identities and start concurrently", async () => {
  const jobs = [
    browserUnsignedJob("job-daily", "grok-daily"),
    browserUnsignedJob("job-daily-b", "grok-daily-b"),
  ];
  const scheduled = jobs.map((job) => scheduledSessionJob({ job, run: async () => undefined }));
  assert.deepEqual(
    scheduled.map((work) => work.targetId),
    ["grok-com#signed-out:grok-daily", "grok-com#signed-out:grok-daily-b"],
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
  assert.deepEqual(started, ["job-daily", "job-daily-b"]);
  for (const gate of gates) gate.resolve();
});

test("four unsigned Lane jobs start concurrently on distinct signed-out identities", async () => {
  const laneIds = ["grok-daily", "grok-daily-b", "grok-daily-c", "grok-daily-d"] as const;
  const jobs = laneIds.map((laneId) => browserUnsignedJob(laneId, laneId));
  assert.deepEqual(
    jobs.map((job) => scheduledSessionJob({ job, run: async () => undefined }).targetId),
    laneIds.map((laneId) => `grok-com#signed-out:${laneId}`),
  );

  const scheduler = new TargetWorkerScheduler();
  const gates = laneIds.map(() => deferred());
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
  assert.deepEqual(started, [...laneIds]);
  for (const gate of gates) gate.resolve();
});

test("two jobs on the same unsigned Lane still serialize", async () => {
  const jobs = [
    browserUnsignedJob("job-a", "grok-daily"),
    browserUnsignedJob("job-b", "grok-daily"),
  ];
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
  assert.deepEqual(started, ["job-a"]);
  gates[0]!.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["job-a", "job-b"]);
  gates[1]!.resolve();
});
