import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppMap,
  AppMapMutationContext,
  AuthoringAction,
  AuthoringObservation,
  TargetProfile,
} from "@relay/protocol";
import { observeScreenIdentity } from "../screen-identity.js";
import {
  commitAppMapRecording,
  commitAppMapScreenCapture,
  reviewAppMapScreenCapture,
} from "./recording-operations.js";
import { approveAppMapProposal } from "./proposal-operations.js";
import { submitAppMapProposal } from "./entity-operations.js";

const beforeFingerprint = "a".repeat(64);
const afterFingerprint = "b".repeat(64);

function mapFixture(): AppMap {
  return {
    schemaVersion: 1,
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
    variables: {},
    tests: {},
    combines: {},
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
    bounds: { width: 1112, height: 834 },
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

test("captures an entry screen without inventing a connection", () => {
  const result = commitAppMapScreenCapture(
    mapFixture(),
    {
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      targetProfile: {
        id: "device:ipad",
        targetId: "ipad",
        source: "device",
        platform: "ios",
        name: "iPad Pro",
        capabilities: ["snapshot", "screenshot"],
        observedAt: 2,
      },
      observation: observation("home", beforeFingerprint, "evidence-home"),
      evidenceUrisById: { "evidence-home": `relay-evidence://${"1".repeat(64)}` },
      evidenceKindsById: { "evidence-home": "screenshot" },
      position: { x: 80, y: 100 },
    },
    context("capture-entry"),
  );

  assert.equal(result.created, true);
  assert.equal(Object.keys(result.appMap.connections).length, 0);
  assert.equal(Object.keys(result.appMap.flows).length, 1);
  assert.equal(Object.values(result.appMap.flows)[0]?.startScreenId, result.screenId);
  assert.equal(result.appMap.screens[result.screenId]?.title, "Start");
  assert.deepEqual(result.appMap.screens[result.screenId]?.position, { x: 80, y: 100 });
  assert.equal(result.appMap.screenVariants[result.variantId]?.targetProfile.name, "iPad Pro");
  assert.deepEqual(result.appMap.screenVariants[result.variantId]?.targetProfile.viewport, {
    width: 1112,
    height: 834,
  });
  assert.equal(
    result.appMap.screenVariants[result.variantId]?.screenshotUri,
    `relay-evidence://${"1".repeat(64)}`,
  );
});

test("captures an explicitly owned handoff as a reversible test surface", () => {
  const result = commitAppMapScreenCapture(
    mapFixture(),
    {
      target: { kind: "device", platform: "android", targetId: "phone" },
      observation: observation("launcher-dialog", "c".repeat(64), "evidence-dialog"),
      title: "Add to home screen",
      handoff: { ownerApp: "bitpit.launcher", returnAction: "back" },
    },
    context("capture-handoff"),
  );

  assert.deepEqual(result.appMap.screens[result.screenId]?.handoff, {
    ownerApp: "bitpit.launcher",
    returnAction: "back",
  });
});

test("recapturing the same observed state refreshes its target variant", () => {
  const first = commitAppMapScreenCapture(
    mapFixture(),
    {
      target: { kind: "device", platform: "android", targetId: "pixel" },
      observation: observation("home-1", beforeFingerprint, "evidence-first"),
    },
    context("first"),
  );
  const second = commitAppMapScreenCapture(
    first.appMap,
    {
      target: { kind: "device", platform: "android", targetId: "pixel" },
      observation: observation("home-2", beforeFingerprint, "evidence-second"),
    },
    context("second", first.appMap.revision, 20),
  );

  assert.equal(second.created, false);
  assert.equal(second.screenId, first.screenId);
  assert.equal(second.variantId, first.variantId);
  assert.equal(Object.keys(second.appMap.screens).length, 1);
  assert.deepEqual(second.appMap.screenVariants[second.variantId]?.evidenceIds, [
    "evidence-first",
    "evidence-second",
  ]);
});

test("holds a changed target variant for comparison instead of overwriting it", () => {
  const first = commitAppMapScreenCapture(
    mapFixture(),
    {
      target: { kind: "device", platform: "android", targetId: "pixel" },
      observation: titledObservation("settings-old", beforeFingerprint, "evidence-old", "Settings"),
      evidenceUrisById: { "evidence-old": "relay-evidence://old.png" },
      evidenceKindsById: { "evidence-old": "screenshot" },
      title: "Settings",
    },
    context("capture-old"),
  );
  const review = reviewAppMapScreenCapture(
    first.appMap,
    {
      target: { kind: "device", platform: "android", targetId: "pixel" },
      observation: {
        ...titledObservation("settings-new", "c".repeat(64), "evidence-new", "Settings"),
        nodes: [
          { type: "NavigationBar", identifier: "Settings", depth: 2 },
          { type: "NavigationBar", identifier: "Settings", label: "Back", depth: 3 },
          { role: "button", label: "New setting", enabled: true },
        ],
      },
      evidenceUrisById: { "evidence-new": "relay-evidence://new.png" },
      evidenceKindsById: { "evidence-new": "screenshot" },
      title: "Settings",
    },
    context("review-new", first.appMap.revision, 20),
  );

  assert.ok(review);
  assert.equal(
    first.appMap.screenVariants[review.currentVariant.id]?.screenshotUri,
    "relay-evidence://old.png",
  );
  assert.equal(review.proposedVariant.screenshotUri, "relay-evidence://new.png");

  const submitted = submitAppMapProposal(
    first.appMap,
    review.proposal,
    context("submit-review", first.appMap.revision, 20),
  );
  const approved = approveAppMapProposal(
    submitted,
    review.proposal.id,
    context("approve-new", submitted.revision, 30),
  );
  assert.equal(
    approved.screenVariants[review.currentVariant.id]?.screenshotUri,
    "relay-evidence://new.png",
  );
});

test("keeps portrait and landscape evidence as distinct screen variants", () => {
  const portrait: TargetProfile = {
    id: "device:ipad-834x1112",
    targetId: "ipad",
    source: "device" as const,
    platform: "ios" as const,
    name: "iPad",
    capabilities: ["snapshot", "screenshot"],
    observedAt: 2,
    viewport: { width: 834, height: 1112 },
  };
  const landscape = {
    ...portrait,
    id: "device:ipad-1112x834",
    viewport: { width: 1112, height: 834 },
  };
  const first = commitAppMapScreenCapture(
    mapFixture(),
    {
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      targetProfile: portrait,
      observation: observation("settings-portrait", beforeFingerprint, "evidence-portrait"),
    },
    context("portrait"),
  );
  const second = commitAppMapScreenCapture(
    first.appMap,
    {
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      targetProfile: landscape,
      observation: observation("settings-landscape", beforeFingerprint, "evidence-landscape"),
    },
    context("landscape", first.appMap.revision),
  );

  assert.equal(second.created, false);
  assert.equal(second.screenId, first.screenId);
  assert.notEqual(second.variantId, first.variantId);
  assert.deepEqual(
    second.appMap.screens[first.screenId]?.variantIds.map(
      (id) => second.appMap.screenVariants[id]?.targetProfile.viewport,
    ),
    [
      { width: 834, height: 1112 },
      { width: 1112, height: 834 },
    ],
  );
});

test("a title never overwrites a differently observed screen", () => {
  const first = commitAppMapScreenCapture(
    mapFixture(),
    {
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      title: "Grok Settings",
      observation: observation("settings", beforeFingerprint, "evidence-settings"),
    },
    context("first"),
  );
  const second = commitAppMapScreenCapture(
    first.appMap,
    {
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      title: "Grok Settings",
      observation: observation("transient-model-sheet", afterFingerprint, "evidence-model-sheet"),
    },
    context("second", first.appMap.revision),
  );

  assert.equal(second.created, true);
  assert.notEqual(second.screenId, first.screenId);
  assert.equal(second.appMap.screens[first.screenId]?.title, "Grok Settings");
  assert.equal(second.appMap.screens[second.screenId]?.title, "Grok Settings");
  assert.equal(Object.keys(second.appMap.screens).length, 2);
});

test("a fresh semantic title merges an orientation into its named screen", () => {
  const first = commitAppMapScreenCapture(
    mapFixture(),
    {
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      title: "Settings",
      observation: titledObservation(
        "settings-landscape",
        beforeFingerprint,
        "evidence-landscape",
        "Settings",
      ),
    },
    context("landscape"),
  );
  const portraitProfile: TargetProfile = {
    id: "device:ipad-834x1112",
    targetId: "ipad",
    source: "device",
    platform: "ios",
    name: "iPad",
    capabilities: ["snapshot", "screenshot"],
    observedAt: 2,
    viewport: { width: 834, height: 1112 },
  };
  const second = commitAppMapScreenCapture(
    first.appMap,
    {
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      targetProfile: portraitProfile,
      title: "Settings",
      observation: titledObservation(
        "settings-portrait",
        afterFingerprint,
        "evidence-portrait",
        "Settings",
      ),
    },
    context("portrait", first.appMap.revision),
  );

  assert.equal(second.created, false);
  assert.equal(second.screenId, first.screenId);
  assert.equal(second.appMap.screens[first.screenId]?.variantIds.length, 2);
});

test("an accessibility-empty rotated recapture still joins its known screen", () => {
  const landscapeProfile: TargetProfile = {
    id: "device:ipad-1112x834",
    targetId: "ipad",
    source: "device",
    platform: "ios",
    name: "iPad",
    capabilities: ["snapshot", "screenshot"],
    observedAt: 2,
    viewport: { width: 1112, height: 834 },
  };
  const first = commitAppMapScreenCapture(
    mapFixture(),
    {
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      targetProfile: landscapeProfile,
      title: "Appearance",
      observation: observation("appearance-landscape", beforeFingerprint, "evidence-landscape"),
    },
    context("landscape"),
  );
  const portraitProfile: TargetProfile = {
    ...landscapeProfile,
    id: "device:ipad-834x1112",
    viewport: { width: 834, height: 1112 },
  };
  const second = commitAppMapScreenCapture(
    first.appMap,
    {
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      targetProfile: portraitProfile,
      title: "Appearance",
      observation: observation("appearance-portrait", afterFingerprint, "evidence-portrait"),
    },
    context("portrait", first.appMap.revision),
  );

  assert.equal(second.created, false);
  assert.equal(second.screenId, first.screenId);
  assert.equal(second.appMap.screens[first.screenId]?.variantIds.length, 2);
});

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
  const connection = result.appMap.connections[result.connectionId]!;
  const source = result.appMap.screens[connection.fromScreenId]!;
  assert.equal(connection.destination.kind, "screen");
  const destination =
    connection.destination.kind === "screen"
      ? result.appMap.screens[connection.destination.screenId]!
      : undefined;
  const sourceVariant = result.appMap.screenVariants[source.variantIds[0]!]!;
  const destinationVariant = result.appMap.screenVariants[destination!.variantIds[0]!]!;
  assert.deepEqual(sourceVariant.targetProfile.viewport, { width: 1112, height: 834 });
  assert.deepEqual(sourceVariant.evidenceUris, ["relay-evidence://sha256/before/screenshot"]);
  assert.deepEqual(destinationVariant.evidenceUris, ["relay-evidence://sha256/after/screenshot"]);
  assert.equal(sourceVariant.screenshotUri, "relay-evidence://sha256/before/screenshot");
  assert.equal(
    sourceVariant.observation?.fingerprint,
    observeScreenIdentity([{ role: "button", label: "Continue", enabled: true }]).fingerprint,
  );
  assert.equal(sourceVariant.observation?.nodes[0]?.role, "button");
  assert.equal(Object.keys(result.appMap.flows).length, 1);
  assert.equal(connection.state, "ready");
  assert.equal(connection.label, "Continue");
  assert.equal(connection.actions[0]?.kind, "recorded");
  assert.equal(result.appMap.activity["event-1"]?.eventType, "recording.committed");
  assert.equal(result.appMap.activity["event-1"]?.subject.id, result.connectionId);
});

test("persists the recorded source control as normalized connection evidence", () => {
  const before = observation("before", beforeFingerprint, "evidence-before");
  before.bounds = { width: 1000, height: 2000 };
  before.nodes = [
    {
      role: "button",
      identifier: "settings.connectors",
      label: "Connectors",
      rect: { x: 120, y: 640, width: 760, height: 112 },
    },
  ];
  const result = commitAppMapRecording(
    mapFixture(),
    {
      sessionId: "session-source-anchor",
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      takeId: "take-source-anchor",
      takeRevision: 1,
      actions: [
        {
          ...action("open-connectors"),
          steps: [
            {
              id: "tap-connectors",
              kind: "tap",
              target: {
                identifier: "settings.connectors",
                point: {
                  x: 500,
                  y: 696,
                  referenceBounds: { width: 1000, height: 2000 },
                },
              },
            },
          ],
        },
      ],
      before,
      after: observation("after", afterFingerprint, "evidence-after"),
      evidenceIds: ["evidence-before", "evidence-after"],
    },
    context("event-source-anchor"),
  );

  assert.deepEqual(result.appMap.connections[result.connectionId]?.sourceAnchor, {
    point: { x: 0.5, y: 0.348 },
    rect: { x: 0.12, y: 0.32, width: 0.76, height: 0.056 },
  });
});

test("labels a recorded message transition from its meaningful action", () => {
  const result = commitAppMapRecording(
    mapFixture(),
    {
      sessionId: "session-send-message",
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      takeId: "take-send-message",
      takeRevision: 1,
      actions: [
        {
          ...action("type-message"),
          steps: [
            { id: "type-message", kind: "type", text: "hello" },
            {
              id: "send-message",
              kind: "tap",
              target: { identifier: "ask.toolbar.send.button" },
            },
          ],
        },
      ],
      before: observation("before", beforeFingerprint, "evidence-before"),
      after: observation("after", afterFingerprint, "evidence-after"),
      evidenceIds: ["evidence-before", "evidence-after"],
    },
    context("event-send-message"),
  );

  assert.equal(result.appMap.connections[result.connectionId]?.label, "Send message");
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

test("new-screen does not merge a sheet into the still-visible source screen", () => {
  const map = mapFixture();
  map.screens.sidebar = {
    ...mapScope(map),
    id: "sidebar",
    title: "Sidebar",
    identity: { schemaVersion: 1, fingerprint: afterFingerprint },
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };

  const result = commitAppMapRecording(
    map,
    {
      sessionId: "session-settings-sheet",
      sourceScreenId: "sidebar",
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      takeId: "take-settings-sheet",
      takeRevision: 1,
      actions: [
        {
          ...action("settings"),
          steps: [
            { id: "tap-settings", kind: "tap", target: { identifier: "sidebar.settings.button" } },
          ],
        },
      ],
      before: observation("before", beforeFingerprint, "evidence-before"),
      after: observation("after", afterFingerprint, "evidence-after"),
      destination: { kind: "new-screen", title: "Settings" },
      evidenceIds: ["evidence-before", "evidence-after"],
    },
    context("event-settings-sheet"),
  );

  const connection = result.appMap.connections[result.connectionId];
  assert.equal(connection?.fromScreenId, "sidebar");
  assert.equal(connection?.destination.kind, "screen");
  const destinationId =
    connection?.destination.kind === "screen" ? connection.destination.screenId : undefined;
  assert.notEqual(destinationId, "sidebar");
  assert.equal(result.appMap.screens[destinationId!]?.title, "Settings");
  assert.equal(result.appMap.screens.sidebar?.identity?.fingerprint, afterFingerprint);
  assert.equal(result.appMap.screens[destinationId!]?.identity, undefined);

  const sidebarVariants = [...(result.appMap.screens.sidebar?.variantIds ?? [])];
  const recapture = commitAppMapScreenCapture(
    result.appMap,
    {
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      observation: observation("after", afterFingerprint, "evidence-after"),
      title: "Settings",
    },
    context("event-settings-recapture", 1, 11),
  );
  assert.equal(recapture.screenId, destinationId);
  assert.equal(recapture.appMap.screens.sidebar?.title, "Sidebar");
  assert.equal(recapture.appMap.screens.sidebar?.identity?.fingerprint, afterFingerprint);
  assert.deepEqual(recapture.appMap.screens.sidebar?.variantIds, sidebarVariants);
  assert.equal(recapture.appMap.screens[destinationId!]?.title, "Settings");
  assert.ok(recapture.appMap.screens[destinationId!]?.variantIds.includes(recapture.variantId));
});

test("new-screen does not adopt a fingerprint another screen already aliases", () => {
  const map = mapFixture();
  map.screens.sidebar = {
    ...mapScope(map),
    id: "sidebar",
    title: "Sidebar",
    identity: {
      schemaVersion: 1,
      fingerprint: beforeFingerprint,
      aliases: [afterFingerprint],
    },
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };

  const result = commitAppMapRecording(
    map,
    {
      sessionId: "session-alias-collision",
      sourceScreenId: "sidebar",
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      takeId: "take-alias-collision",
      takeRevision: 1,
      actions: [action("settings")],
      before: observation("before", beforeFingerprint, "evidence-before"),
      after: observation("after", afterFingerprint, "evidence-after"),
      destination: { kind: "new-screen", title: "Settings" },
      evidenceIds: ["evidence-before", "evidence-after"],
    },
    context("event-alias-collision"),
  );

  const connection = result.appMap.connections[result.connectionId];
  const destinationId =
    connection?.destination.kind === "screen" ? connection.destination.screenId : undefined;
  assert.notEqual(destinationId, "sidebar");
  assert.equal(result.appMap.screens[destinationId!]?.identity, undefined);
  assert.ok(result.appMap.screens.sidebar?.identity?.aliases?.includes(afterFingerprint));
});

test("omitted destination still merges a recording into the observed screen", () => {
  const map = mapFixture();
  map.screens.sidebar = {
    ...mapScope(map),
    id: "sidebar",
    title: "Sidebar",
    identity: { schemaVersion: 1, fingerprint: afterFingerprint },
    variantIds: [],
    createdAt: 1,
    updatedAt: 1,
  };

  const result = commitAppMapRecording(
    map,
    {
      sessionId: "session-identity-merge",
      sourceScreenId: "sidebar",
      target: { kind: "device", platform: "ios", targetId: "ipad" },
      takeId: "take-identity-merge",
      takeRevision: 1,
      actions: [
        {
          ...action("settings"),
          steps: [
            { id: "tap-settings", kind: "tap", target: { identifier: "sidebar.settings.button" } },
          ],
        },
      ],
      before: observation("before", beforeFingerprint, "evidence-before"),
      after: observation("after", afterFingerprint, "evidence-after"),
      evidenceIds: ["evidence-before", "evidence-after"],
    },
    context("event-identity-merge"),
  );

  const connection = result.appMap.connections[result.connectionId];
  assert.deepEqual(connection?.destination, { kind: "screen", screenId: "sidebar" });
  assert.equal(Object.keys(result.appMap.screens).length, 1);
});

test("keeps a tour setup flow at its root when recording a new root branch", () => {
  const map = mapFixture();
  for (const id of ["start", "middle", "branch"]) {
    map.screens[id] = {
      ...mapScope(map),
      id,
      title: id,
      variantIds: [],
      createdAt: 1,
      updatedAt: 1,
    };
  }
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
  map.flows.setup = {
    ...mapScope(map),
    id: "setup",
    name: "Reach middle",
    startScreenId: "start",
    connectionIds: ["enter"],
    createdAt: 1,
    updatedAt: 1,
  };
  map.tests.middleTour = {
    ...mapScope(map),
    id: "middleTour",
    name: "Middle tour",
    kind: "tour",
    rootScreenId: "middle",
    setupFlowId: "setup",
    screenIds: ["middle"],
    createdAt: 1,
    updatedAt: 1,
  };

  const result = commitAppMapRecording(
    map,
    {
      sessionId: "record-branch-from-tour-root",
      sourceScreenId: "middle",
      target: { kind: "device", platform: "android", targetId: "pixel" },
      takeId: "take-branch-from-tour-root",
      takeRevision: 1,
      actions: [action("open-branch")],
      before: observation("middle-before", beforeFingerprint, "middle-evidence"),
      after: observation("branch-after", afterFingerprint, "branch-evidence"),
      destination: { kind: "screen", screenId: "branch" },
      evidenceIds: ["middle-evidence", "branch-evidence"],
    },
    context("record-branch-from-tour-root"),
  );

  assert.deepEqual(result.appMap.flows.setup?.connectionIds, ["enter"]);
  const branch = Object.values(result.appMap.flows).find((flow) => flow.id !== "setup");
  assert.equal(branch?.startScreenId, "start");
  assert.deepEqual(branch?.connectionIds, ["enter", result.connectionId]);
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
