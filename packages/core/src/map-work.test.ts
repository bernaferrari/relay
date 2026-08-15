import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapTest, Screen } from "@relay/protocol";
import {
  compileAppMapCombine,
  compileAppMapTest,
  fallbackTourStopsFromMap,
  preludeStepsToScreen,
} from "./map-work.js";

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
    assert.equal(root.steps[0].returnAfterLast, false);
  }
});

test("a screen tour runs its explicit setup Flow once before starting at its root", () => {
  const work: AppMapTest = {
    ...scope,
    id: "settings-tour",
    name: "Settings coverage",
    kind: "tour",
    rootScreenId: "settings",
    setupFlowId: "open-settings",
    depth: 0,
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
      home: {
        ...screen("home", "Home"),
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
      },
      settings: {
        ...screen("settings", "Settings"),
        identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
      },
    },
    screenVariants: {},
    connections: {
      "open-settings": {
        ...scope,
        id: "open-settings",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "settings" },
        label: "Settings",
        state: "ready",
        actions: [{ id: "tap-settings", kind: "tap", target: { identifier: "settings" } }],
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
      "open-settings": {
        ...scope,
        id: "open-settings",
        name: "Open settings",
        startScreenId: "home",
        connectionIds: ["open-settings"],
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

  const { root, graph } = compileAppMapTest(map, work);
  const setupRecipeId = "app-map:map-1:flow:open-settings:r1";
  assert.deepEqual(root.steps[0], { kind: "module", recipeId: setupRecipeId });
  assert.equal(root.steps[1]?.kind, "tour");
  assert.ok(graph[setupRecipeId]);
  const tour = root.steps[1];
  assert.ok(tour?.kind === "tour");
  if (tour?.kind === "tour") {
    assert.equal(tour.preludeSteps, undefined);
    assert.equal(tour.originVerifiedBySetup, true);
  }
});

test("a combined tour returns only to its shared root instead of Home", () => {
  const work = {
    ...scope,
    id: "settings-tour",
    name: "Settings coverage",
    kind: "tour" as const,
    rootScreenId: "settings",
    setupFlowId: "open-settings",
    depth: 0,
    createdAt: at,
    updatedAt: at,
  };
  const second = {
    ...work,
    id: "middle-tour",
    name: "Settings middle pass",
    kind: "path" as const,
    flowId: "open-settings-middle",
    rootScreenId: undefined,
    setupFlowId: undefined,
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
      home: {
        ...screen("home", "Home"),
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
      },
      settings: {
        ...screen("settings", "Settings"),
        identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
      },
      middle: {
        ...screen("middle", "Settings middle"),
        identity: { schemaVersion: 1, fingerprint: "c".repeat(64) },
      },
    },
    screenVariants: {},
    connections: {
      "open-settings": {
        ...scope,
        id: "open-settings",
        fromScreenId: "home",
        destination: { kind: "screen" as const, screenId: "settings" },
        label: "Settings",
        state: "ready" as const,
        actions: [{ id: "tap-settings", kind: "tap" as const, target: { identifier: "settings" } }],
        createdAt: at,
        updatedAt: at,
      },
      "scroll-settings": {
        ...scope,
        id: "scroll-settings",
        fromScreenId: "settings",
        destination: { kind: "screen" as const, screenId: "middle" },
        label: "Scroll settings",
        state: "ready" as const,
        actions: [
          {
            id: "scroll-middle",
            kind: "gesture" as const,
            gesture: { kind: "scroll" as const, direction: "down" as const },
          },
        ],
        createdAt: at,
        updatedAt: at,
      },
    },
    caseStacks: {},
    variables: {},
    tests: { [work.id]: work, [second.id]: second },
    combines: {},
    routines: {},
    flows: {
      "open-settings": {
        ...scope,
        id: "open-settings",
        name: "Open settings",
        startScreenId: "home",
        connectionIds: ["open-settings"],
        createdAt: at,
        updatedAt: at,
      },
      "open-settings-middle": {
        ...scope,
        id: "open-settings-middle",
        name: "Open settings middle",
        startScreenId: "home",
        connectionIds: ["open-settings", "scroll-settings"],
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
  const combine = {
    ...scope,
    id: "combined",
    name: "Combined",
    variableIds: [],
    testIds: [work.id, second.id],
    createdAt: at,
    updatedAt: at,
  };
  const compiled = compileAppMapCombine(map, combine);
  assert.deepEqual(
    compiled.root.steps.map((step) => step.check),
    [
      { id: work.id, title: work.name },
      { id: second.id, title: second.name },
    ],
  );
  const setup = compiled.graph["app-map:map-1:flow:open-settings-middle:r1"]!;
  // The Path captures its two verified checkpoints, but the executable
  // navigation is only shared Settings recovery → one remaining scroll.
  assert.equal(setup.steps.length, 5);
  const source = setup.steps[0];
  assert.equal(source?.kind, "expect-screen");
  assert.equal(source?.kind === "expect-screen" ? source.screenId : undefined, "settings");
  assert.deepEqual(source?.kind === "expect-screen" ? source.recovery : undefined, {
    strategy: "back",
    maxAttempts: 8,
    restoreParentViewport: true,
  });
  assert.equal(setup.steps[2]?.kind, "scroll");
  assert.equal(
    setup.steps[3]?.kind === "expect-screen" ? setup.steps[3].screenId : undefined,
    "middle",
  );
});

test("a combined itinerary reuses the previous tour's final child", () => {
  const first = {
    ...scope,
    id: "memory-tour",
    name: "Memory coverage",
    kind: "tour" as const,
    rootScreenId: "memory",
    setupFlowId: "open-memory",
    screenIds: ["memory", "import"],
    capture: { mode: "every-screen" as const },
    depth: 0,
    createdAt: at,
    updatedAt: at,
  };
  const second = {
    ...scope,
    id: "import-tour",
    name: "Import coverage",
    kind: "tour" as const,
    rootScreenId: "import",
    setupFlowId: "open-import",
    screenIds: ["import"],
    capture: { mode: "every-screen" as const },
    depth: 0,
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
      home: {
        ...screen("home", "Home"),
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
      },
      memory: {
        ...screen("memory", "Memory"),
        identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
      },
      import: {
        ...screen("import", "Import"),
        identity: { schemaVersion: 1, fingerprint: "c".repeat(64) },
      },
    },
    screenVariants: {},
    connections: {
      "open-memory": {
        ...scope,
        id: "open-memory",
        fromScreenId: "home",
        destination: { kind: "screen" as const, screenId: "memory" },
        label: "Memory",
        state: "ready" as const,
        actions: [{ id: "tap-memory", kind: "tap" as const, target: { label: "Memory" } }],
        createdAt: at,
        updatedAt: at,
      },
      "open-import": {
        ...scope,
        id: "open-import",
        fromScreenId: "memory",
        destination: { kind: "screen" as const, screenId: "import" },
        label: "Import memory",
        state: "ready" as const,
        actions: [{ id: "tap-import", kind: "tap" as const, target: { label: "Import memory" } }],
        createdAt: at,
        updatedAt: at,
      },
    },
    caseStacks: {},
    variables: {},
    tests: { [first.id]: first, [second.id]: second },
    combines: {},
    routines: {},
    flows: {
      "open-memory": {
        ...scope,
        id: "open-memory",
        name: "Open memory",
        startScreenId: "home",
        connectionIds: ["open-memory"],
        createdAt: at,
        updatedAt: at,
      },
      "open-import": {
        ...scope,
        id: "open-import",
        name: "Open import",
        startScreenId: "home",
        connectionIds: ["open-memory", "open-import"],
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

  const compiled = compileAppMapCombine(map, {
    ...scope,
    id: "memory-matrix",
    name: "Memory matrix",
    variableIds: [],
    testIds: [first.id, second.id],
    createdAt: at,
    updatedAt: at,
  });
  const secondSetup = compiled.graph["app-map:map-1:flow:open-import:r1"]!;
  assert.deepEqual(
    secondSetup.steps.map((step) =>
      step.kind === "expect-screen" ? `expect:${step.screenId}` : step.kind,
    ),
    ["expect:import"],
  );
});

test("a screen tour compiles account-state branches as optional semantic stops", () => {
  const work: AppMapTest = {
    ...scope,
    id: "usage-tour",
    name: "Usage coverage",
    kind: "tour",
    rootScreenId: "usage",
    screenIds: ["usage", "buy-more"],
    optionalScreenIds: ["buy-more"],
    capture: { mode: "every-screen" },
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
    screens: { usage: screen("usage", "Usage"), "buy-more": screen("buy-more", "Buy More") },
    screenVariants: {},
    connections: {
      "open-buy-more": {
        ...scope,
        id: "open-buy-more",
        fromScreenId: "usage",
        destination: { kind: "screen", screenId: "buy-more" },
        label: "Buy More",
        state: "ready",
        actions: [{ id: "tap-buy-more", kind: "tap", target: { label: "Buy More" } }],
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
  assert.ok(tour?.kind === "tour");
  if (tour?.kind === "tour") {
    assert.deepEqual(tour.fallbackStops, [{ label: "Buy More", optional: true }]);
  }
});

test("a path test captures every verified screen in its reusable flow", () => {
  const work: AppMapTest = {
    ...scope,
    id: "settings-path",
    name: "Open settings",
    kind: "path",
    flowId: "open-settings",
    capture: { mode: "every-screen" },
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
      home: {
        ...screen("home", "Home"),
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
      },
      settings: {
        ...screen("settings", "Settings"),
        identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
      },
    },
    screenVariants: {},
    connections: {
      "open-settings": {
        ...scope,
        id: "open-settings",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "settings" },
        label: "Settings",
        state: "ready",
        actions: [{ id: "tap-settings", kind: "tap", target: { identifier: "settings" } }],
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
      "open-settings": {
        ...scope,
        id: "open-settings",
        name: "Open settings",
        startScreenId: "home",
        connectionIds: ["open-settings"],
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

  const { root } = compileAppMapTest(map, work);
  assert.deepEqual(
    root.steps.filter((step) => step.kind === "screenshot").map((step) => step.caption),
    ["screen:Home", "screen:Settings"],
  );
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

test("a tour rehydrates a recorded source anchor when accessibility lost the tap point", () => {
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
      settings: { ...screen("settings", "Settings"), variantIds: ["settings-android"] },
      customize: screen("customize", "Customize Grok"),
    },
    screenVariants: {
      "settings-android": {
        ...scope,
        id: "settings-android",
        screenId: "settings",
        targetProfile: {
          id: "device:android",
          targetId: "android",
          source: "device",
          platform: "android",
          name: "Android",
          viewport: { width: 1080, height: 2340 },
          capabilities: [],
          observedAt: at,
        },
        evidenceIds: [],
        createdAt: at,
        updatedAt: at,
      },
    },
    connections: {
      customize: {
        ...scope,
        id: "customize",
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "customize" },
        label: "Customize Grok",
        state: "ready",
        actions: [{ id: "tap-customize", kind: "tap", target: { label: "Customize Grok" } }],
        sourceAnchor: { point: { x: 0.335, y: 0.19 } },
        createdAt: at,
        updatedAt: at,
      },
    },
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
    createdAt: at,
    updatedAt: at,
  } as AppMap;

  assert.deepEqual(fallbackTourStopsFromMap(map, "settings"), [
    { label: "Customize Grok", point: { x: 362, y: 445 } },
  ]);
});

test("a tour rehydrates an anchor against the source orientation shared by its destination", () => {
  const portrait = {
    id: "device:ipad-834x1112",
    targetId: "ipad",
    source: "device",
    platform: "ios",
    name: "iPad portrait",
    viewport: { width: 834, height: 1112 },
    capabilities: [],
    observedAt: at,
  };
  const landscape = {
    id: "device:ipad-1112x834",
    targetId: "ipad",
    source: "device",
    platform: "ios",
    name: "iPad landscape",
    viewport: { width: 1112, height: 834 },
    capabilities: [],
    observedAt: at,
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
    // Portrait deliberately comes first: source anchor replay must not depend
    // on array order when the recorded transition landed in landscape.
    screens: {
      settings: {
        ...screen("settings", "Settings"),
        variantIds: ["settings-portrait", "settings-landscape"],
      },
      customize: { ...screen("customize", "Customize Grok"), variantIds: ["customize-landscape"] },
    },
    screenVariants: {
      "settings-portrait": {
        ...scope,
        id: "settings-portrait",
        screenId: "settings",
        targetProfile: portrait,
        evidenceIds: [],
        createdAt: at,
        updatedAt: at,
      },
      "settings-landscape": {
        ...scope,
        id: "settings-landscape",
        screenId: "settings",
        targetProfile: landscape,
        evidenceIds: [],
        createdAt: at,
        updatedAt: at,
      },
      "customize-landscape": {
        ...scope,
        id: "customize-landscape",
        screenId: "customize",
        targetProfile: landscape,
        evidenceIds: [],
        createdAt: at,
        updatedAt: at,
      },
    },
    connections: {
      customize: {
        ...scope,
        id: "customize",
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "customize" },
        label: "Customize Grok",
        state: "ready",
        actions: [{ id: "tap-customize", kind: "tap", target: { label: "Customize Grok" } }],
        sourceAnchor: { point: { x: 0.5, y: 0.25 } },
        createdAt: at,
        updatedAt: at,
      },
    },
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
    createdAt: at,
    updatedAt: at,
  } as AppMap;

  assert.deepEqual(fallbackTourStopsFromMap(map, "settings"), [
    { label: "Customize Grok", point: { x: 556, y: 209 } },
  ]);

  // If a connection has no source-viewport evidence, a pixel fallback is
  // unsafe. Keep its semantic target rather than guessing portrait or landscape.
  const ambiguous = structuredClone(map);
  ambiguous.screens.customize!.variantIds = [];
  assert.deepEqual(fallbackTourStopsFromMap(ambiguous, "settings"), [{ label: "Customize Grok" }]);
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
            when: {
              target: { identifier: "sidebar.open.button" },
              condition: "present",
            },
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
    {
      kind: "tap",
      target: { identifier: "sidebar.settings.button" },
      when: { target: { identifier: "sidebar.open.button" }, condition: "present" },
    },
  ]);
  const { root } = compileAppMapTest(map, work);
  assert.equal(root.steps.length, 1);
  assert.equal(root.steps[0]?.kind, "tour");
  if (root.steps[0]?.kind === "tour") {
    assert.deepEqual(root.steps[0].preludeSteps, [
      {
        kind: "tap",
        target: { identifier: "sidebar.settings.button" },
        when: { target: { identifier: "sidebar.open.button" }, condition: "present" },
      },
    ]);
    assert.equal(root.steps[0].originTitle, "Settings");
  }
});

test("tour preludes preserve mapped scroll gestures", () => {
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
      home: screen("home", "Home"),
      settings: screen("settings", "Settings"),
      middle: screen("middle", "Settings middle"),
    },
    screenVariants: {},
    connections: {
      settings: {
        ...scope,
        id: "settings",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "settings" },
        label: "Settings",
        state: "ready",
        actions: [{ id: "open-settings", kind: "tap", target: { identifier: "settings" } }],
        createdAt: at,
        updatedAt: at,
      },
      scroll: {
        ...scope,
        id: "scroll",
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "middle" },
        label: "Scroll settings",
        state: "ready",
        actions: [
          {
            id: "scroll-settings",
            kind: "gesture",
            gesture: { kind: "swipe", from: { x: 500, y: 1600 }, to: { x: 500, y: 600 } },
          },
        ],
        createdAt: at,
        updatedAt: at,
      },
    },
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {
      main: {
        ...scope,
        id: "main",
        name: "Main",
        startScreenId: "home",
        connectionIds: ["settings", "scroll"],
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

  assert.deepEqual(preludeStepsToScreen(map, "middle"), [
    { kind: "tap", target: { identifier: "settings" } },
    { kind: "swipe", from: { x: 500, y: 1600 }, to: { x: 500, y: 600 } },
  ]);
  const { root } = compileAppMapTest(map, {
    ...scope,
    id: "middle-coverage",
    name: "Middle coverage",
    kind: "tour",
    rootScreenId: "middle",
    screenIds: ["middle"],
    capture: { mode: "every-screen" },
    createdAt: at,
    updatedAt: at,
  });
  const tour = root.steps.find((step) => step.kind === "tour");
  assert.ok(tour?.kind === "tour");
  assert.deepEqual(tour.preludeSteps, [
    { kind: "tap", target: { identifier: "settings" } },
    { kind: "swipe", from: { x: 500, y: 1600 }, to: { x: 500, y: 600 } },
  ]);
  assert.equal(tour.captureOrigin, true);
});

test("tour stops exclude mapped scroll checkpoints", () => {
  const map = {
    schemaVersion: 1,
    id: "map-1",
    organizationId: "org",
    projectId: "p",
    name: "App",
    revision: 1,
    notes: {},
    groups: {},
    screens: { settings: screen("settings", "Settings"), middle: screen("middle", "Middle") },
    screenVariants: {},
    connections: {
      scroll: {
        ...scope,
        id: "scroll",
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "middle" },
        label: "Scroll settings",
        state: "ready",
        actions: [
          {
            id: "scroll-settings",
            kind: "gesture",
            gesture: { kind: "scroll", direction: "down", amount: 0.7 },
          },
        ],
        createdAt: at,
        updatedAt: at,
      },
    },
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
    createdAt: at,
    updatedAt: at,
  } as AppMap;

  assert.deepEqual(fallbackTourStopsFromMap(map, "settings"), []);
});

test("tour stops keep duplicate labels when their mapped tap targets differ", () => {
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
      voicePicker: screen("voice-picker", "Voice picker"),
      voiceLibrary: screen("voice-library", "Voice library"),
    },
    screenVariants: {},
    connections: {
      picker: {
        ...scope,
        id: "picker",
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "voice-picker" },
        label: "Voice",
        state: "ready",
        actions: [
          { id: "picker-tap", kind: "tap", target: { label: "Voice", point: { x: 220, y: 420 } } },
        ],
        createdAt: at,
        updatedAt: at,
      },
      library: {
        ...scope,
        id: "library",
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "voice-library" },
        label: "Voice",
        state: "ready",
        actions: [
          { id: "library-tap", kind: "tap", target: { label: "Voice", point: { x: 220, y: 680 } } },
        ],
        createdAt: at,
        updatedAt: at,
      },
    },
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
    createdAt: at,
    updatedAt: at,
  } as AppMap;

  assert.deepEqual(fallbackTourStopsFromMap(map, "settings"), [
    { label: "Voice", point: { x: 220, y: 420 } },
    { label: "Voice", point: { x: 220, y: 680 } },
  ]);
});

test("mapped tour rows follow their recorded on-screen order, not exploration order", () => {
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
      first: screen("first", "First"),
      second: screen("second", "Second"),
    },
    screenVariants: {},
    connections: {
      exploredSecond: {
        ...scope,
        id: "exploredSecond",
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "second" },
        label: "Second",
        state: "ready",
        actions: [
          { id: "tap-second", kind: "tap", target: { label: "Second", point: { x: 300, y: 800 } } },
        ],
        sourceAnchor: { point: { x: 0.3, y: 0.8 } },
        createdAt: at,
        updatedAt: at,
      },
      exploredFirst: {
        ...scope,
        id: "exploredFirst",
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "first" },
        label: "First",
        state: "ready",
        actions: [
          { id: "tap-first", kind: "tap", target: { label: "First", point: { x: 300, y: 420 } } },
        ],
        sourceAnchor: { point: { x: 0.3, y: 0.42 } },
        createdAt: at,
        updatedAt: at,
      },
    },
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
    createdAt: at,
    updatedAt: at,
  } as AppMap;

  assert.deepEqual(fallbackTourStopsFromMap(map, "settings"), [
    { label: "First", point: { x: 300, y: 420 } },
    { label: "Second", point: { x: 300, y: 800 } },
  ]);
});

test("an exact screen tour compiles one capture per named screen", () => {
  const work: AppMapTest = {
    ...scope,
    id: "settings-coverage",
    name: "Settings coverage",
    kind: "tour",
    rootScreenId: "settings",
    screenIds: ["ask", "sidebar", "settings", "appearance", "haptics"],
    screenshotEach: true,
    createdAt: at,
    updatedAt: at,
  };
  const connection = (
    id: string,
    fromScreenId: string,
    destinationId: string,
    label: string,
  ): AppMap["connections"][string] => ({
    ...scope,
    id,
    fromScreenId,
    destination: { kind: "screen", screenId: destinationId },
    label,
    state: "ready",
    actions: [{ id: `tap-${id}`, kind: "tap", target: { label } }],
    createdAt: at,
    updatedAt: at,
  });
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
      ask: screen("ask", "Ask"),
      sidebar: screen("sidebar", "Sidebar"),
      settings: screen("settings", "Settings"),
      appearance: screen("appearance", "Appearance"),
      haptics: screen("haptics", "Haptics"),
      advanced: screen("advanced", "Advanced"),
    },
    screenVariants: {},
    connections: {
      menu: connection("menu", "ask", "sidebar", "Menu"),
      settings: connection("settings-path", "sidebar", "settings", "Settings"),
      appearance: connection("appearance-path", "settings", "appearance", "Appearance"),
      haptics: connection("haptics-path", "settings", "haptics", "Haptics"),
      advanced: connection("advanced-path", "settings", "advanced", "Advanced"),
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
        startScreenId: "ask",
        connectionIds: ["menu", "settings-path"],
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

  const { root } = compileAppMapTest(map, work);
  assert.deepEqual(
    root.steps.filter((step) => step.kind === "screenshot").map((step) => step.caption),
    ["screen:Ask", "screen:Sidebar", "screen:Settings"],
  );
  const tour = root.steps.find((step) => step.kind === "tour");
  assert.ok(tour && tour.kind === "tour");
  assert.equal(tour.preludeSteps, undefined);
  assert.equal(tour.mappedStopsOnly, true);
  assert.deepEqual(
    tour.fallbackStops?.map((stop) => stop.label),
    ["Appearance", "Haptics"],
  );
  assert.equal(
    root.steps.filter((step) => step.kind === "screenshot").length +
      (tour.fallbackStops?.length ?? 0),
    work.screenIds?.length,
  );

  const checkpoints = compileAppMapTest(map, {
    ...work,
    capture: { mode: "checkpoints", screenIds: ["sidebar", "haptics"] },
  }).root;
  assert.deepEqual(
    checkpoints.steps.filter((step) => step.kind === "screenshot").map((step) => step.caption),
    ["screen:Sidebar"],
  );
  const checkpointTour = checkpoints.steps.find((step) => step.kind === "tour");
  assert.ok(checkpointTour?.kind === "tour");
  assert.deepEqual(
    checkpointTour.fallbackStops?.map((stop) => [stop.label, stop.capture]),
    [
      ["Appearance", false],
      ["Haptics", true],
    ],
  );

  const finalOnly = compileAppMapTest(map, {
    ...work,
    capture: { mode: "final-screen" },
  }).root;
  assert.deepEqual(
    finalOnly.steps.filter((step) => step.kind === "screenshot").map((step) => step.caption),
    ["final:Settings coverage"],
  );
  assert.equal(
    finalOnly.steps.find((step) => step.kind === "tour")?.kind === "tour" &&
      finalOnly.steps.find((step) => step.kind === "tour")?.screenshot,
    false,
  );

  const noScreenshots = compileAppMapTest(map, {
    ...work,
    capture: { mode: "none" },
  }).root;
  assert.equal(
    noScreenshots.steps.some((step) => step.kind === "screenshot"),
    false,
  );

  const combine = {
    ...scope,
    id: "matrix",
    name: "Fast smoke",
    variableIds: ["language"],
    testIds: [work.id],
    captures: { [work.id]: { mode: "none" as const } },
    createdAt: at,
    updatedAt: at,
  };
  const matrix = compileAppMapCombine({ ...map, combines: { matrix: combine } }, combine);
  assert.equal(
    matrix.root.steps.some((step) => step.kind === "screenshot"),
    false,
  );
});

test("an exact screen tour accepts and captures its start root", () => {
  const work: AppMapTest = {
    ...scope,
    id: "settings-root",
    name: "Settings root",
    kind: "tour",
    rootScreenId: "settings",
    screenIds: ["settings", "appearance"],
    capture: { mode: "every-screen" },
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
      appearance: {
        ...scope,
        id: "appearance",
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "appearance" },
        label: "Appearance",
        state: "ready",
        actions: [{ id: "tap-appearance", kind: "tap", target: { label: "Appearance" } }],
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
  assert.equal(
    root.steps.some((step) => step.kind === "screenshot"),
    false,
  );
  const tour = root.steps.find((step) => step.kind === "tour");
  assert.equal(tour?.kind === "tour" && tour.captureOrigin, true);
});
