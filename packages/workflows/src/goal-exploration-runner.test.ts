import assert from "node:assert/strict";
import test from "node:test";
import type { GoalExplorationRecord, GoalSessionResult } from "@relay/protocol";
import { GOAL_EXPLORATION_SCHEMA_VERSION } from "@relay/protocol";
import {
  createGoalExplorationRunner,
  type GoalExplorationStore,
} from "./goal-exploration-runner.js";
import type { GoalSessionRunner } from "./goal-runner.js";

function result(sessionId: string, status: GoalSessionResult["status"] = "completed") {
  return {
    schemaVersion: 1 as const,
    sessionId,
    goal: "Reach the goal",
    target: { targetId: `target-${sessionId}`, platform: "browser" as const },
    status,
    step: 1,
    budget: { maxSteps: 2, maxDurationMs: 10_000 },
    actions: [],
    observations: [],
  } satisfies GoalSessionResult;
}

function memoryStore(initial: GoalExplorationRecord[] = []): GoalExplorationStore {
  const values = new Map(initial.map((record) => [record.id, structuredClone(record)]));
  return {
    async load(id) {
      const record = values.get(id);
      return record ? structuredClone(record) : null;
    },
    async save(record) {
      values.set(record.id, structuredClone(record));
    },
  };
}

function fakeSessions(options: { delayMs?: number } = {}): {
  runner: GoalSessionRunner;
  started: string[];
  resumed: string[];
  maxConcurrent: () => number;
} {
  const started: string[] = [];
  const resumed: string[] = [];
  let active = 0;
  let maximum = 0;
  const settle = async (sessionId: string) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 2));
    active -= 1;
    return result(sessionId);
  };
  return {
    started,
    resumed,
    maxConcurrent: () => maximum,
    runner: {
      start: async (input) => {
        started.push(input.sessionId!);
        return settle(input.sessionId!);
      },
      resume: async (sessionId) => {
        resumed.push(sessionId);
        return settle(sessionId);
      },
      reproduce: async (sessionId) => settle(sessionId),
      inspect: async () => {
        throw new Error("not needed");
      },
    },
  };
}

test("goal exploration starts four independent bounded workers concurrently", async () => {
  const sessions = fakeSessions();
  const exploration = createGoalExplorationRunner({
    sessions: sessions.runner,
    store: memoryStore(),
    id: () => "explore-test",
  });
  const record = await exploration.start({
    goal: "Reach the goal",
    startUrl: "https://example.test",
    agents: 4,
  });
  assert.equal(record.schemaVersion, GOAL_EXPLORATION_SCHEMA_VERSION);
  assert.equal(record.status, "completed");
  assert.deepEqual(record.summary, {
    workers: 4,
    completed: 4,
    partial: 0,
    blocked: 0,
    uncertain: 0,
  });
  assert.equal(new Set(sessions.started).size, 4);
  assert.equal(sessions.maxConcurrent(), 4);
});

test("exploration refuses shared target or account bindings for multiple workers", async () => {
  const make = () =>
    createGoalExplorationRunner({
      sessions: fakeSessions().runner,
      store: memoryStore(),
      id: () => "explore-rejected",
    });
  await assert.rejects(
    make().start({ goal: "Reach the goal", targetId: "browser-1", agents: 2 }),
    /isolated browser targets/u,
  );
  await assert.rejects(
    make().start({
      goal: "Reach the goal",
      startUrl: "https://example.test",
      laneId: "lane-1",
      agents: 2,
    }),
    /share one Lane/u,
  );
});

test("exploration resume continues persisted workers without creating new worker identities", async () => {
  const sessions = fakeSessions();
  const record: GoalExplorationRecord = {
    schemaVersion: GOAL_EXPLORATION_SCHEMA_VERSION,
    id: "explore-resume",
    goal: "Reach the goal",
    agents: 2,
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    workers: [1, 2].map((index) => ({
      id: `worker-${index}`,
      index,
      sessionId: `explore-resume-${index}`,
      status: "pending" as const,
    })),
    summary: { workers: 2, completed: 0, partial: 0, blocked: 0, uncertain: 0 },
  };
  const exploration = createGoalExplorationRunner({
    sessions: sessions.runner,
    store: memoryStore([record]),
  });
  const resumed = await exploration.resume("explore-resume");
  assert.equal(resumed.status, "completed");
  assert.deepEqual(sessions.started, []);
  assert.deepEqual(sessions.resumed.sort(), ["explore-resume-1", "explore-resume-2"]);
});
