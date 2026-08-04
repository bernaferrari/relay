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
    groups: {},
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

function titledObservation(
  id: string,
  fingerprint: string,
  evidenceId: string,
  title: string,
): AuthoringObservation {
  return {
    ...observation(id, fingerprint, evidenceId),
    nodes: [
      { type: "NavigationBar", identifier: "Settings", depth: 2 },
      { type: "NavigationBar", identifier: title, label: "Back", depth: 3 },
    ],
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

function mapScope(map: AppMap) {
  return { organizationId: map.organizationId, projectId: map.projectId, appMapId: map.id };
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
      evidenceUrisById: {
        "evidence-before": "relay-evidence://sha256/before/screenshot",
        "evidence-video": "relay-evidence://sha256/video/video",
        "evidence-after": "relay-evidence://sha256/after/screenshot",
      },
      evidenceKindsById: {
        "evidence-before": "screenshot",
        "evidence-video": "video",
        "evidence-after": "screenshot",
      },
    },
    context("event-1"),
  );

  assert.equal(input.revision, 0);
  assert.equal(Object.keys(input.screens).length, 0);
  assert.equal(result.appMap.revision, 1);
  assert.equal(Object.keys(result.appMap.screens).length, 2);
  assert.equal(Object.keys(result.appMap.screenVariants).length, 2);
  const variants = Object.values(result.appMap.screenVariants);
  assert.deepEqual(
    variants.find((variant) => variant.observation?.fingerprint === beforeFingerprint)
      ?.evidenceUris,
    ["relay-evidence://sha256/before/screenshot"],
  );
  assert.deepEqual(
    variants.find((variant) => variant.observation?.fingerprint === afterFingerprint)?.evidenceUris,
    ["relay-evidence://sha256/after/screenshot"],
  );
  assert.equal(
    variants.find((variant) => variant.observation?.fingerprint === beforeFingerprint)
      ?.screenshotUri,
    "relay-evidence://sha256/before/screenshot",
  );
  assert.equal(Object.keys(result.appMap.flows).length, 1);
  const connection = result.appMap.connections[result.connectionId];
  assert.equal(connection?.state, "ready");
  assert.equal(connection?.actions[0]?.kind, "recorded");
  assert.equal(result.appMap.activity["event-1"]?.eventType, "recording.committed");
  assert.equal(result.appMap.activity["event-1"]?.subject.id, result.connectionId);
});

test("names a captured destination from its deepest observed navigation title", () => {
  const result = commitAppMapRecording(
    mapFixture(),
    {
      sessionId: "session-titled-destination",
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      takeId: "take-titled-destination",
      takeRevision: 1,
      actions: [
        {
          ...action("date-time"),
          steps: [{ id: "tap-date-time", kind: "tap", target: { label: "Date & Time" } }],
        },
      ],
      before: observation("before", beforeFingerprint, "evidence-before"),
      after: titledObservation("after", afterFingerprint, "evidence-after", "Date & Time"),
      destination: { kind: "new-screen" },
      evidenceIds: ["evidence-before", "evidence-after"],
    },
    context("event-titled-destination"),
  );

  const connection = result.appMap.connections[result.connectionId];
  const destination =
    connection?.destination.kind === "screen"
      ? result.appMap.screens[connection.destination.screenId]
      : undefined;
  assert.equal(destination?.title, "Date & Time");
});

test("falls back to the recorded tap label when the destination has no navigation title", () => {
  const result = commitAppMapRecording(
    mapFixture(),
    {
      sessionId: "session-action-title",
      target: { kind: "device", platform: "android", targetId: "pixel" },
      takeId: "take-action-title",
      takeRevision: 1,
      actions: [
        {
          ...action("privacy"),
          steps: [{ id: "tap-privacy", kind: "tap", target: { label: "Privacy" } }],
        },
      ],
      before: observation("before", beforeFingerprint, "evidence-before"),
      after: observation("after", afterFingerprint, "evidence-after"),
      destination: { kind: "new-screen" },
      evidenceIds: ["evidence-before", "evidence-after"],
    },
    context("event-action-title"),
  );

  const connection = result.appMap.connections[result.connectionId];
  const destination =
    connection?.destination.kind === "screen"
      ? result.appMap.screens[connection.destination.screenId]
      : undefined;
  assert.equal(destination?.title, "Privacy");
});

test("keeps a newly captured destination in its source screen Group", () => {
  const map = mapFixture();
  map.screens.start = {
    ...mapScope(map),
    id: "start",
    title: "General",
    identity: { schemaVersion: 1, fingerprint: beforeFingerprint },
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  map.groups.settings = {
    ...mapScope(map),
    id: "settings",
    name: "Settings",
    screenIds: ["start"],
    createdAt: 1,
    updatedAt: 1,
  };

  const result = commitAppMapRecording(
    map,
    {
      sessionId: "session-grouped-destination",
      sourceScreenId: "start",
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      takeId: "take-grouped-destination",
      takeRevision: 1,
      actions: [action("language-region")],
      before: observation("before", beforeFingerprint, "evidence-before"),
      after: titledObservation("after", afterFingerprint, "evidence-after", "Language & Region"),
      destination: { kind: "new-screen" },
      evidenceIds: ["evidence-before", "evidence-after"],
    },
    context("event-grouped-destination"),
  );

  const connection = result.appMap.connections[result.connectionId];
  assert.equal(connection?.destination.kind, "screen");
  assert.deepEqual(result.appMap.groups.settings?.screenIds, [
    "start",
    connection?.destination.kind === "screen" ? connection.destination.screenId : "",
  ]);
  assert.equal(result.appMap.groups.settings?.updatedAt, 10);
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

test("new branch flows retain the complete path from the map entry", () => {
  const map = mapFixture();
  map.screens.start = {
    ...mapScope(map),
    id: "start",
    title: "Start",
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  map.screens.middle = {
    ...mapScope(map),
    id: "middle",
    title: "Middle",
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  map.screens.finish = {
    ...mapScope(map),
    id: "finish",
    title: "Finish",
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  map.connections.enter = {
    ...mapScope(map),
    id: "enter",
    fromScreenId: "start",
    destination: { kind: "screen", screenId: "middle" },
    state: "ready",
    actions: [{ id: "enter-action", kind: "back" }],
    createdAt: 1,
    updatedAt: 1,
  };
  map.connections.finish = {
    ...mapScope(map),
    id: "finish",
    fromScreenId: "middle",
    destination: { kind: "screen", screenId: "finish" },
    state: "ready",
    actions: [{ id: "finish-action", kind: "back" }],
    createdAt: 1,
    updatedAt: 1,
  };
  map.flows.main = {
    ...mapScope(map),
    id: "main",
    name: "Main",
    startScreenId: "start",
    connectionIds: ["enter", "finish"],
    createdAt: 1,
    updatedAt: 1,
  };

  const result = commitAppMapRecording(
    map,
    {
      sessionId: "branch-session",
      sourceScreenId: "middle",
      target: { kind: "device", platform: "android", targetId: "pixel" },
      takeId: "branch-take",
      takeRevision: 1,
      actions: [action("branch")],
      after: observation("branch-after", afterFingerprint, "branch-evidence"),
      evidenceIds: ["branch-evidence"],
    },
    context("branch-event"),
  );

  const branch = Object.values(result.appMap.flows).find((flow) => flow.id !== "main");
  assert.equal(branch?.startScreenId, "start");
  assert.deepEqual(branch?.connectionIds, ["enter", result.connectionId]);
});
