import assert from "node:assert/strict";
import test from "node:test";
import type { TargetProfile } from "@relay/protocol";
import type { AppMap, Flow } from "../app-map.js";
import { recordAppMapRun } from "./run-operations.js";

const at = 1_000;
const scope = { organizationId: "local", projectId: "default", appMapId: "map" };

function fixture(): AppMap {
  const flow: Flow = {
    ...scope,
    id: "main",
    name: "Main",
    startScreenId: "start",
    connectionIds: [],
    createdAt: at,
    updatedAt: at,
  };
  return {
    schemaVersion: 2,
    id: "map",
    organizationId: "local",
    projectId: "default",
    name: "Map",
    revision: 1,
    notes: {},
    groups: {},
    screens: {
      start: {
        ...scope,
        id: "start",
        title: "Start",
        variantIds: [],
        createdAt: at,
        updatedAt: at,
      },
    },
    screenVariants: {},
    connections: {},
    caseStacks: {},
    routines: {},
    flows: { main: flow },
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  };
}

test("projects one completed target execution with actor-visible activity", () => {
  const profile: TargetProfile = {
    id: "device:ipad",
    targetId: "ipad",
    source: "device",
    platform: "ios",
    name: "iPad Pro",
    capabilities: ["clipboard"],
    observedAt: at,
  };
  const result = recordAppMapRun(
    fixture(),
    {
      runId: "run-1",
      flowId: "main",
      appMapRevision: 1,
      targetProfile: profile,
      outcome: "passed",
      startedAt: at + 10,
      finishedAt: at + 20,
      evidenceIds: ["run:run-1"],
    },
    {
      expectedRevision: 1,
      eventId: "run-finished-run-1",
      actorId: "agent:dogfood",
      actorKind: "agent",
      at: at + 20,
    },
  );

  assert.deepEqual(result.runs["run-1"]?.targetResultIds, ["run-1-target"]);
  assert.deepEqual(result.targetResults["run-1-target"], {
    ...scope,
    id: "run-1-target",
    createdAt: at + 10,
    updatedAt: at + 20,
    runId: "run-1",
    targetProfile: profile,
    outcome: "passed",
    evidenceIds: ["run:run-1"],
    finishedAt: at + 20,
  });
  assert.deepEqual(result.activity["run-finished-run-1"], {
    ...scope,
    id: "run-finished-run-1",
    actorId: "agent:dogfood",
    actorKind: "agent",
    eventType: "run.finished",
    subject: { kind: "run", id: "run-1" },
    summary: "Main passed on iPad Pro",
    at: at + 20,
    beforeRevision: 1,
    afterRevision: 2,
  });
});
