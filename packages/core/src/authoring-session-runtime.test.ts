import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AuthoringSession, Screen } from "@relay/protocol";
import {
  authoringOriginApplication,
  authoringReplaySourceSteps,
} from "./authoring-session-runtime.js";

function session(): AuthoringSession {
  return {
    target: { kind: "device", platform: "android", targetId: "phone" },
    take: {
      currentRevision: 1,
      revisions: [
        {
          revision: 1,
          before: {
            foregroundApp: "test.app",
            proof: {
              schemaVersion: 1,
              captureOrder: "concurrent",
              pixels: { status: "captured" },
              semantics: { status: "current" },
            },
          },
        },
      ],
    },
  } as AuthoringSession;
}

test("current-screen recording reopens its evidenced app, but stale or missing trees cannot choose an app", () => {
  const recorded = session();
  assert.deepEqual(authoringReplaySourceSteps(recorded), [
    { kind: "app", action: "open", app: "test.app", relaunch: true },
  ]);
  recorded.take!.revisions[0]!.before!.proof!.semantics.status = "stale";
  assert.deepEqual(authoringReplaySourceSteps(recorded), []);
  recorded.originApplication = "saved.app";
  assert.equal((authoringReplaySourceSteps(recorded)[0] as { app: string }).app, "saved.app");
});

function ipadSession(): AuthoringSession {
  const recorded = session();
  recorded.target = { kind: "device", platform: "ios", targetId: "ipad" };
  const before = recorded.take!.revisions[0]!.before!;
  before.capturedAt = 3;
  before.screen = {
    id: "source",
    fingerprint: "pixels",
    capturedAt: 1,
    source: "recording",
    deviceId: "ipad",
  };
  before.proof!.captureOrder = "pixels-ax-pixels";
  before.proof!.pixels = {
    status: "captured",
    capturedAt: 1,
    bracket: { status: "coherent", afterCapturedAt: 3 },
  };
  before.proof!.semantics = { status: "current", capturedAt: 2 };
  before.nodes = [
    {
      type: "Application",
      depth: 0,
      label: "Grok",
      logicalCoordinates: true,
      rect: { x: 0, y: 0, width: 834, height: 1112 },
    },
  ];
  return recorded;
}

test("an iPad current-screen commit derives its origin from the owned source Application root", () => {
  const recorded = ipadSession();
  recorded.take!.revisions[0]!.before!.foregroundApp = "com.example.remembered-app";
  assert.equal(authoringOriginApplication(recorded), "ai.x.GrokApp");
  assert.equal(
    recorded.originApplication,
    undefined,
    "Begin's frozen requested identity remains unchanged",
  );
  const other = ipadSession();
  other.actorId = "another-actor";
  other.target.targetId = "another-ipad";
  const source = other.take!.revisions[0]!.before!;
  source.screen.deviceId = "another-ipad";
  source.nodes = [{ ...source.nodes![0], label: "com.example.another-app" }];
  assert.equal(authoringOriginApplication(other), "com.example.another-app");
  assert.equal(authoringOriginApplication(recorded), "ai.x.GrokApp");
});

test("stale, missing, ambiguous, foreign, and another target's iPad roots cannot supply a commit origin", () => {
  const mutations: Array<(recorded: AuthoringSession) => void> = [
    (value) => {
      value.take!.revisions[0]!.before!.proof!.semantics.status = "stale";
    },
    (value) => {
      value.take!.revisions[0]!.before!.proof!.pixels.bracket!.status = "changed";
    },
    (value) => {
      value.take!.revisions[0]!.before!.proof!.semantics.capturedAt = 4;
    },
    (value) => {
      value.take!.revisions[0]!.before!.proof!.pixels.capturedAt = undefined;
    },
    (value) => {
      value.take!.revisions[0]!.before!.nodes = [];
    },
    (value) => {
      const before = value.take!.revisions[0]!.before!;
      before.nodes!.push({ ...before.nodes![0] });
    },
    (value) => {
      value.take!.revisions[0]!.before!.nodes!.push({
        type: "Button",
        bundleId: "com.apple.SafariViewService",
      });
    },
    (value) => {
      value.take!.revisions[0]!.before!.nodes![0]!.logicalCoordinates = false;
    },
    (value) => {
      value.take!.revisions[0]!.before!.nodes![0]!.label = "Unknown app";
    },
    (value) => {
      value.take!.revisions[0]!.before!.screen.deviceId = "another-ipad";
    },
  ];
  for (const mutate of mutations) {
    const recorded = ipadSession();
    mutate(recorded);
    assert.equal(authoringOriginApplication(recorded), undefined);
  }
});

test("opening a nested source uses only ready mapped inbound actions and verifies the destination", () => {
  const scope = { organizationId: "org", projectId: "project", appMapId: "map" };
  const screen = (id: string): Screen => ({
    ...scope,
    id,
    title: id,
    variantIds: [],
    identity: { schemaVersion: 1, fingerprint: id === "home" ? "a".repeat(64) : "b".repeat(64) },
    createdAt: 1,
    updatedAt: 1,
  });
  const map: AppMap = {
    schemaVersion: 1,
    id: "map",
    name: "Map",
    ...scope,
    revision: 1,
    screens: { home: screen("home"), settings: screen("settings") },
    screenVariants: {},
    connections: {
      settings: {
        ...scope,
        id: "settings",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "settings" },
        state: "ready",
        actions: [{ id: "open", kind: "tap", target: { identifier: "settings-button" } }],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    routines: {},
    notes: {},
    groups: {},
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    createdAt: 1,
    updatedAt: 1,
  };
  const recorded = session();
  recorded.sourceScreenId = "settings";
  const steps = authoringReplaySourceSteps(recorded, map);
  assert.equal(steps.length, 2);
  assert.equal(steps[1]!.kind, "expect-screen");
  assert.equal((steps[1] as { screenId: string }).screenId, "settings");
  assert.deepEqual((steps[1] as unknown as { preludeSteps: unknown[] }).preludeSteps, [
    { kind: "tap", target: { identifier: "settings-button" } },
  ]);
  map.connections.settings!.state = "draft";
  assert.equal("preludeSteps" in authoringReplaySourceSteps(recorded, map)[1]!, false);
});
