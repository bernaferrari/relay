import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, Connection, TargetResultReference } from "@relay/protocol";
import { connectionRouteCost, selectEquivalentDirectConnection } from "./app-map-route-cost.js";
import { connectionObservationsFromPersistedRun } from "./app-map-run-history.js";
import type { PersistedRun } from "./runs.js";

function connection(id: string): Connection {
  return {
    organizationId: "local",
    projectId: "project",
    appMapId: "map",
    id,
    fromScreenId: "child",
    destination: { kind: "screen", screenId: "settings" },
    state: "ready",
    actions: [{ id: "back", kind: "back" }],
    createdAt: 1,
    updatedAt: 1,
  };
}

function result(
  id: string,
  connectionId: string,
  outcome: "passed" | "failed",
  durationMs: number,
): TargetResultReference {
  return {
    organizationId: "local",
    projectId: "project",
    appMapId: "map",
    id,
    runId: `run-${id}`,
    targetProfile: {
      id: "android:device",
      targetId: "device",
      source: "device",
      platform: "android",
      name: "Android",
      capabilities: [],
      observedAt: 1,
    },
    outcome: outcome === "passed" ? "passed" : "product-failure",
    connectionObservations: [{ connectionId, outcome, durationMs, observedAt: 10 }],
    evidenceIds: [`run:${id}`],
    createdAt: 1,
    updatedAt: 10,
  };
}

function map(): AppMap {
  const slow = connection("slow");
  const fast = { ...connection("fast"), actions: structuredClone(slow.actions) };
  return {
    schemaVersion: 1,
    id: "map",
    organizationId: "local",
    projectId: "project",
    name: "Map",
    revision: 1,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: { slow, fast },
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {
      "slow-1": result("slow-1", "slow", "passed", 900),
      "slow-2": result("slow-2", "slow", "passed", 1_100),
      "fast-1": result("fast-1", "fast", "passed", 250),
      "fast-2": result("fast-2", "fast", "passed", 350),
    },
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 10,
  };
}

test("costs ready routes from persisted success and p50, then selects an equivalent edge", () => {
  const input = map();
  assert.deepEqual(connectionRouteCost(input, ["fast"]), {
    connectionIds: ["fast"],
    proof: "ready",
    attempts: 2,
    successes: 2,
    estimatedSuccess: 0.75,
    p50DurationMs: 300,
  });
  assert.equal(
    selectEquivalentDirectConnection(input, [input.connections.slow!, input.connections.fast!])?.id,
    "fast",
  );
});

test("different reviewed behaviors remain ambiguous regardless of observed speed", () => {
  const input = map();
  input.connections.fast!.actions = [{ id: "dismiss", kind: "tap", target: { label: "Done" } }];
  assert.equal(
    selectEquivalentDirectConnection(input, [input.connections.slow!, input.connections.fast!]),
    null,
  );
});

test("projects only direct terminal check timings from immutable run artifacts", () => {
  const run = {
    artifacts: [
      {
        kind: "campaign-check-result",
        capturedAt: 140,
        data: {
          id: "direct",
          status: "passed",
          startedAt: 100,
          finishedAt: 140,
          transitionDependencies: [
            { connectionId: "fast", originScreenId: "child", destination: { kind: "screen" } },
          ],
        },
      },
      {
        kind: "campaign-check-result",
        capturedAt: 200,
        data: {
          id: "multi",
          status: "passed",
          startedAt: 150,
          finishedAt: 200,
          transitionDependencies: [{ connectionId: "parent" }, { connectionId: "leaf" }],
        },
      },
    ],
  } as PersistedRun;
  assert.deepEqual(connectionObservationsFromPersistedRun(run), [
    { connectionId: "fast", outcome: "passed", durationMs: 40, observedAt: 140 },
  ]);
});
