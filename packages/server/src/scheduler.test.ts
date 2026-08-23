import assert from "node:assert/strict";
import test from "node:test";
import type { LocalSchedule } from "@relay/core";
import { runDueSchedules, startScheduler, type SchedulerRuntime } from "./scheduler.js";

const dueSchedule: LocalSchedule = {
  id: "scheduled-combine",
  recipeId: "settings-test",
  targetKind: "device",
  targetId: "device-1",
  platform: "android",
  intervalMinutes: 60,
  repetitions: 2,
  enabled: true,
  projectId: "project-a",
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: 1_000,
};

const recipe = {
  id: "settings-test",
  title: "Settings Test",
  source: "builtin" as const,
  steps: [],
  createdAt: 1,
  updatedAt: 1,
};

function fakeRuntime(overrides: Partial<SchedulerRuntime> = {}): SchedulerRuntime {
  return {
    listSchedules: async () => [dueSchedule],
    listDevices: async () => [],
    listTargets: async () => [],
    readRecipe: async () => recipe,
    freezeRecipeGraph: async () => ({ [recipe.id]: recipe }),
    readProjectVariables: async () => ({ revision: 0, value: [], updatedAt: 1 }),
    prepareRunMatrix: async (input) => ({
      id: "scheduled-matrix",
      createdAt: 1_000,
      seed: input.seed ?? 0,
      strategy: "repeat",
      cases: [0, 1].map((index) => ({
        id: `case-${index}`,
        name: `Case ${index + 1}`,
        index,
        values: {},
        provenance: [],
      })),
    }),
    prepareJobBatch: (() => {
      throw new Error("prepareJobBatch test stub was not configured");
    }) as SchedulerRuntime["prepareJobBatch"],
    markScheduleRun: async () => undefined,
    markScheduleFailure: async () => undefined,
    ...overrides,
  };
}

test("scheduler close waits for an in-flight poll before session shutdown can begin", async () => {
  let started!: () => void;
  let release!: () => void;
  const polling = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let polls = 0;
  const scheduler = startScheduler(1, async () => {
    polls += 1;
    started();
    await held;
  });

  await polling;
  let closed = false;
  const closing = scheduler.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  assert.equal(closed, false);
  release();
  await closing;
  assert.equal(polls, 1);
});

test("scheduled Combine admission stages every case and rolls back without partial dispatch", async () => {
  let receivedCases = 0;
  let activated = 0;
  let dispatched = 0;
  let rolledBack = 0;
  const failures: string[] = [];
  const runtime = fakeRuntime({
    prepareJobBatch: ((inputs: readonly unknown[]) => {
      receivedCases = inputs.length;
      return {
        jobs: [],
        activate() {
          activated += 1;
          throw new Error("durable admission failed on the second case");
        },
        dispatch() {
          dispatched += 1;
          return [];
        },
        commit() {
          return [];
        },
        rollback() {
          rolledBack += 1;
        },
      };
    }) as SchedulerRuntime["prepareJobBatch"],
    markScheduleFailure: async (_id, error) => {
      failures.push(error);
    },
  });

  await runDueSchedules(2_000, runtime);

  assert.equal(receivedCases, 2);
  assert.equal(activated, 1);
  assert.equal(dispatched, 0, "no scheduled prefix may reach a target");
  assert.equal(rolledBack, 1);
  assert.match(failures[0] ?? "", /second case/u);
});

test("schedule advancement failure compensates the visible batch before dispatch", async () => {
  const order: string[] = [];
  const failures: string[] = [];
  const runtime = fakeRuntime({
    prepareJobBatch: (() => ({
      jobs: [],
      activate() {
        order.push("activate");
        return [];
      },
      dispatch() {
        order.push("dispatch");
        return [];
      },
      commit() {
        return [];
      },
      rollback() {
        order.push("rollback");
      },
    })) as SchedulerRuntime["prepareJobBatch"],
    markScheduleRun: async () => {
      order.push("advance");
      throw new Error("schedule store unavailable");
    },
    markScheduleFailure: async (_id, error) => {
      failures.push(error);
    },
  });

  await runDueSchedules(2_000, runtime);

  assert.deepEqual(order, ["activate", "advance", "rollback"]);
  assert.match(failures[0] ?? "", /schedule store unavailable/u);
});

test("concurrent polls admit one idempotent occurrence", async () => {
  let releaseRecipe!: () => void;
  let recipeReads = 0;
  let admissions = 0;
  const held = new Promise<void>((resolve) => {
    releaseRecipe = resolve;
  });
  const runtime = fakeRuntime({
    readRecipe: async () => {
      recipeReads += 1;
      await held;
      return recipe;
    },
    prepareJobBatch: (() => {
      admissions += 1;
      return {
        jobs: [],
        activate: () => [],
        dispatch: () => [],
        commit: () => [],
        rollback: () => undefined,
      };
    }) as SchedulerRuntime["prepareJobBatch"],
  });

  const first = runDueSchedules(2_000, runtime);
  while (recipeReads === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  const duplicate = runDueSchedules(2_000, runtime);
  await duplicate;
  releaseRecipe();
  await first;

  assert.equal(recipeReads, 1);
  assert.equal(admissions, 1);
});
