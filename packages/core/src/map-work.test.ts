import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapTest, Screen } from "@relay/protocol";
import { compileAppMapTest, fallbackTourStopsFromMap, preludeStepsToScreen } from "./map-work.js";

const at = 1;
const scope = { organizationId: "org", projectId: "p", appMapId: "map-1" };

function screen(id: string, title: string): Screen {
  return {
    ...scope,
    id,
    title,
    identity: { schemaVersion: 1, fingerprint: id.padEnd(64, "a") },
    variantIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

test("a tour test compiles origin identity into the walk, not a prior expect-screen", () => {
  const work: AppMapTest = {
    ...scope,
    id: "settings-tour",
    name: "Settings · depth 0",
    kind: "tour",
    rootScreenId: "settings",
    depth: 0,
    screenshotEach: true,
    createdAt: at,
    updatedAt: at,
  };
  const map = {
    schemaVersion: 1,
    id: "map-1",
    organizationId: "org",
    projectId: "p",
    name: "App",
    revision: 1,
    notes: {},
    groups: {},
    screens: { settings: screen("settings", "Settings") },
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {},
    tests: { [work.id]: work },
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  } as AppMap;
  const { root } = compileAppMapTest(map, work);
  assert.equal(root.steps.length, 1);
  assert.equal(root.steps[0]?.kind, "tour");
  if (root.steps[0]?.kind === "tour") {
    assert.equal(root.steps[0].excludeLanguageRows, true);
    assert.equal(root.steps[0].screenshot, true);
    assert.equal(root.steps[0].originScreenId, "settings");
    assert.equal(root.steps[0].originTitle, "Settings");
    assert.equal(root.steps[0].originFingerprint, "settings".padEnd(64, "a"));
    assert.equal(root.steps[0].fallbackStops, undefined);
    assert.equal(root.steps[0].preludeSteps, undefined);
  }
});

test("a tour compiles mapped exits as pixels-only fallback stops", () => {
  const work: AppMapTest = {
    ...scope,
    id: "settings-tour",
    name: "Settings · depth 0",
    kind: "tour",
    rootScreenId: "settings",
    depth: 0,
    screenshotEach: true,
    createdAt: at,
    updatedAt: at,
  };
  const map = {
    schemaVersion: 1,
    id: "map-1",
    organizationId: "org",
    projectId: "p",
    name: "App",
    revision: 1,
    notes: {},
    groups: {},
    screens: {
      settings: screen("settings", "Settings"),
      appearance: screen("appearance", "Appearance"),
    },
    screenVariants: {},
    connections: {
      "connection-appearance": {
        ...scope,
        id: "connection-appearance",
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "appearance" },
        label: "Appearance",
        state: "ready",
        actions: [
          {
            id: "tap-appearance",
            kind: "tap",
            target: { label: "Appearance", point: { x: 240, y: 422 } },
          },
        ],
        createdAt: at,
        updatedAt: at,
      },
    },
    caseStacks: {},
    variables: {},
    tests: { [work.id]: work },
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  } as AppMap;
  const { root } = compileAppMapTest(map, work);
  const tour = root.steps.find((step) => step.kind === "tour");
  assert.ok(tour && tour.kind === "tour");
  assert.deepEqual(tour.fallbackStops, [{ label: "Appearance", point: { x: 240, y: 422 } }]);
});

test("a tour unwraps recorded taps as pixels-only fallback stops", () => {
  const work: AppMapTest = {
    ...scope,
    id: "settings-tour",
    name: "Settings · depth 0",
    kind: "tour",
    rootScreenId: "settings",
    depth: 0,
    screenshotEach: true,
    createdAt: at,
    updatedAt: at,
  };
  const map = {
    schemaVersion: 1,
    id: "map-1",
    organizationId: "org",
    projectId: "p",
    name: "App",
    revision: 1,
    notes: {},
    groups: {},
    screens: {
      settings: screen("settings", "Settings"),
      appearance: screen("appearance", "Appearance"),
    },
    screenVariants: {},
    connections: {
      "connection-appearance": {
        ...scope,
        id: "connection-appearance",
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "appearance" },
        label: "Appearance",
        state: "ready",
        actions: [
          {
            id: "recording-appearance",
            kind: "recorded",
            takeId: "take-1",
            takeRevision: 1,
            evidenceIds: [],
            steps: [{ kind: "tap", target: { label: "Appearance", point: { x: 240, y: 422 } } }],
          },
        ],
        createdAt: at,
        updatedAt: at,
      },
    },
    caseStacks: {},
    variables: {},
    tests: { [work.id]: work },
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  } as AppMap;
  assert.deepEqual(fallbackTourStopsFromMap(map, "settings"), [
    { label: "Appearance", point: { x: 240, y: 422 } },
  ]);
});

test("a tour prepends mapped prelude taps from the start screen", () => {
  const work: AppMapTest = {
    ...scope,
    id: "settings-tour",
    name: "Settings · depth 0",
    kind: "tour",
    rootScreenId: "settings",
    depth: 0,
    screenshotEach: true,
    createdAt: at,
    updatedAt: at,
  };
  const map = {
    schemaVersion: 1,
    id: "map-1",
    organizationId: "org",
    projectId: "p",
    name: "App",
    revision: 1,
    notes: {},
    groups: {},
    screens: {
      home: screen("home", "Ask"),
      settings: screen("settings", "Settings"),
    },
    screenVariants: {},
    connections: {
      "connection-settings": {
        ...scope,
        id: "connection-settings",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "settings" },
        label: "Open Settings",
        state: "ready",
        actions: [
          {
            id: "recording-settings",
            kind: "recorded",
            takeId: "take-gear",
            takeRevision: 1,
            evidenceIds: [],
            steps: [{ kind: "tap", target: { identifier: "sidebar.settings.button" } }],
          },
        ],
        createdAt: at,
        updatedAt: at,
      },
    },
    caseStacks: {},
    variables: {},
    tests: { [work.id]: work },
    combines: {},
    routines: {},
    flows: {
      main: {
        ...scope,
        id: "main",
        name: "Main",
        startScreenId: "home",
        connectionIds: ["connection-settings"],
        createdAt: at,
        updatedAt: at,
      },
    },
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  } as AppMap;
  assert.deepEqual(preludeStepsToScreen(map, "settings"), [
    { kind: "tap", target: { identifier: "sidebar.settings.button" } },
  ]);
  const { root } = compileAppMapTest(map, work);
  assert.equal(root.steps.length, 1);
  assert.equal(root.steps[0]?.kind, "tour");
  if (root.steps[0]?.kind === "tour") {
    assert.deepEqual(root.steps[0].preludeSteps, [
      { kind: "tap", target: { identifier: "sidebar.settings.button" } },
    ]);
    assert.equal(root.steps[0].originTitle, "Settings");
  }
});
