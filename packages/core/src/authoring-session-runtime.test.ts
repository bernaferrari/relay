import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AuthoringSession, Screen } from "@relay/protocol";
import { authoringReplaySourceSteps } from "./authoring-session-runtime.js";

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
