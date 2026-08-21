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
  type SessionBatchAdmissionDependencies,
  type SessionBatchInput,
} from "./session-batch-admission.js";
import type { EnqueueJobInput, TestJob } from "./session-contract.js";
import type { TargetWorkerStagedBatch } from "./target-worker.js";

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
