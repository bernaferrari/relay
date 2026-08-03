import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppMap,
  AppMapMutationContext,
  AuthoringAction,
  AuthoringObservation,
} from "@relay/protocol";
import { commitAppMapRecording } from "./recording-operations.js";

const beforeFingerprint = "a".repeat(64);
const afterFingerprint = "b".repeat(64);

function mapFixture(): AppMap {
  return {
    schemaVersion: 2,
    id: "map-1",
    organizationId: "org-1",
    projectId: "project-1",
    name: "Store",
    revision: 0,
    notes: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function observation(id: string, fingerprint: string, evidenceId: string): AuthoringObservation {
  return {
    id,
    capturedAt: 2,
    screen: { id: `screen-${id}`, fingerprint, capturedAt: 2, source: "recording" },
    evidenceIds: [evidenceId],
    nodes: [{ role: "button", label: "Continue", enabled: true }],
  };
}

function action(id = "tap-continue"): AuthoringAction {
  return {
    id,
    source: "captured",
    recordedAt: 3,
    startedAt: 3,
    finishedAt: 4,
    steps: [{ id: `step-${id}`, kind: "tap", target: { label: "Continue" } }],
    evidenceIds: ["evidence-video"],
  };
}

function context(eventId: string, revision = 0, at = 10): AppMapMutationContext {
  return {
    expectedRevision: revision,
    eventId,
    actorId: "person-1",
    actorKind: "human",
    at,
  };
}

test("commits a recording as one immutable App Map revision", () => {
  const input = mapFixture();
  const result = commitAppMapRecording(
    input,
    {
      sessionId: "session-1",
      target: { kind: "device", platform: "android", targetId: "pixel-8" },
      takeId: "take-1",
      takeRevision: 1,
      actions: [action()],
      before: observation("before", beforeFingerprint, "evidence-before"),
      after: observation("after", afterFingerprint, "evidence-after"),
      evidenceIds: ["evidence-before", "evidence-video", "evidence-after"],
    },
    context("event-1"),
  );

  assert.equal(input.revision, 0);
  assert.equal(Object.keys(input.screens).length, 0);
  assert.equal(result.appMap.revision, 1);
  assert.equal(Object.keys(result.appMap.screens).length, 2);
  assert.equal(Object.keys(result.appMap.screenVariants).length, 2);
  assert.equal(Object.keys(result.appMap.flows).length, 1);
  const connection = result.appMap.connections[result.connectionId];
  assert.equal(connection?.state, "ready");
  assert.equal(connection?.actions[0]?.kind, "recorded");
  assert.equal(result.appMap.activity["event-1"]?.eventType, "recording.committed");
  assert.equal(result.appMap.activity["event-1"]?.subject.id, result.connectionId);
});

test("fills an existing pending connection and preserves its flow position", () => {
  const map = mapFixture();
  map.screens.start = {
    organizationId: map.organizationId,
    projectId: map.projectId,
    appMapId: map.id,
    id: "start",
    title: "Start",
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  map.screens.destination = {
    organizationId: map.organizationId,
    projectId: map.projectId,
    appMapId: map.id,
    id: "destination",
    title: "Destination",
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  map.connections.pending = {
    organizationId: map.organizationId,
    projectId: map.projectId,
    appMapId: map.id,
    id: "pending",
    fromScreenId: "start",
    destination: { kind: "screen", screenId: "destination" },
    label: "Choose plan",
    state: "draft",
    actions: [],
    createdAt: 1,
    updatedAt: 1,
  };
  map.flows.main = {
    organizationId: map.organizationId,
    projectId: map.projectId,
    appMapId: map.id,
    id: "main",
    name: "Main",
    startScreenId: "start",
    connectionIds: ["pending"],
    createdAt: 1,
    updatedAt: 1,
  };

  const result = commitAppMapRecording(
    map,
    {
      sessionId: "session-2",
      pendingConnectionId: "pending",
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      takeId: "take-2",
      takeRevision: 1,
      actions: [action("choose-plan")],
      after: observation("after", afterFingerprint, "evidence-after"),
      evidenceIds: ["evidence-after"],
    },
    context("event-2"),
  );

  assert.equal(result.connectionId, "pending");
  assert.equal(result.appMap.connections.pending?.state, "ready");
  assert.equal(result.appMap.connections.pending?.label, "Choose plan");
  assert.deepEqual(result.appMap.flows.main?.connectionIds, ["pending"]);
  assert.equal(result.appMap.screens.destination?.variantIds.length, 1);
});

test("represents an observe-only recording as a passive transition", () => {
  const result = commitAppMapRecording(
    mapFixture(),
    {
      sessionId: "session-passive",
      target: { kind: "browser", platform: "browser", targetId: "chrome" },
      takeId: "take-passive",
      takeRevision: 1,
      actions: [],
      before: observation("before", beforeFingerprint, "evidence-before"),
      destination: { kind: "end" },
      evidenceIds: ["evidence-before"],
    },
    context("event-passive"),
  );

  const connection = result.appMap.connections[result.connectionId];
  assert.equal(connection?.label, "Observe");
  assert.deepEqual(connection?.actions, [
    { id: "passive-take-passive", kind: "passive", reason: "observe-only" },
  ]);
  assert.deepEqual(connection?.destination, { kind: "end" });
});
