import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, Connection } from "@relay/protocol";
import { proposeAppMapTestExecutionSchedule } from "./app-map-test-schedule.js";
import type { Recipe } from "./recipes.js";

const at = 1;
const scope = { organizationId: "org", projectId: "project", appMapId: "settings-map" };

function screen(id: string, options: { external?: boolean } = {}) {
  return {
    ...scope,
    id,
    title: id,
    identity: { schemaVersion: 1 as const, fingerprint: id.padEnd(64, id[0] ?? "x").slice(0, 64) },
    ...(options.external
      ? { handoff: { ownerApp: "com.apple.Preferences", returnAction: "back" as const } }
      : {}),
    variantIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

function mapWithSettingsSurface(): AppMap {
  const settings = screen("settings");
  const screens = {
    settings,
    appearance: screen("appearance"),
    privacy: screen("privacy"),
    help: screen("help"),
    system: screen("system", { external: true }),
    unknown: screen("unknown"),
    cold: screen("cold"),
  };
  return {
    schemaVersion: 1,
    id: scope.appMapId,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    name: "Settings",
    revision: 1,
    notes: {},
    groups: {},
    screens,
    screenVariants: {
      "settings-en": {
        ...scope,
        id: "settings-en",
        screenId: "settings",
        targetProfile: {
          id: "ios-en",
          targetId: "tablet",
          source: "device",
          platform: "ios",
          name: "Tablet",
          capabilities: [],
          observedAt: at,
        },
        evidenceIds: [],
        scrollSurfaces: [
          {
            id: "settings-surface",
            captureId: "settings-capture",
            capturedAt: at,
            semanticIndex: {
              schemaVersion: 1,
              documentHeight: 2_000,
              viewportHeight: 600,
              anchors: [
                { order: 0, documentY: 180, target: { label: "Privacy" }, label: "Privacy" },
                {
                  order: 1,
                  documentY: 420,
                  target: { label: "Appearance" },
                  label: "Appearance",
                },
                { order: 2, documentY: 900, target: { label: "Help" }, label: "Help" },
                {
                  order: 3,
                  documentY: 1_100,
                  target: { label: "System" },
                  label: "System",
                },
                {
                  order: 4,
                  documentY: 1_300,
                  target: { label: "Unknown" },
                  label: "Unknown",
                },
                { order: 5, documentY: 1_500, target: { label: "Cold" }, label: "Cold" },
              ],
            },
          },
        ],
        createdAt: at,
        updatedAt: at,
      } as unknown as AppMap["screenVariants"][string],
    },
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
    createdAt: at,
    updatedAt: at,
  };
}

function leaf(
  map: AppMap,
  id: string,
  destinationScreenId: string,
  options: { returnable?: boolean } = {},
): Connection {
  const result: Connection = {
    ...scope,
    id,
    fromScreenId: "settings",
    destination: { kind: "screen", screenId: destinationScreenId },
    state: "ready",
    actions: [
      { id: `tap-${id}`, kind: "tap", target: { label: id[0]!.toUpperCase() + id.slice(1) } },
    ],
    navigation: {
      targetAlternatives: [{ kind: "accessibility", label: id[0]!.toUpperCase() + id.slice(1) }],
      expectedDestination: {
        screenId: destinationScreenId,
        identity: structuredClone(map.screens[destinationScreenId]!.identity!),
        evidenceIds: [],
      },
    },
    createdAt: at,
    updatedAt: at,
  };
  if (options.returnable !== false) {
    result.return = {
      kind: "back",
      expectedDestination: {
        screenId: "settings",
        identity: structuredClone(map.screens.settings!.identity!),
        evidenceIds: [],
      },
    };
  }
  return result;
}

function root(checks: Array<Record<string, unknown>>): Record<string, Recipe> {
  return {
    root: {
      id: "root",
      title: "Settings checks",
      source: "custom",
      steps: checks as Recipe["steps"],
      createdAt: at,
      updatedAt: at,
    },
  };
}

function check(
  id: string,
  options: { warmSourceScreenId?: string; recovery?: Record<string, unknown> } = {},
) {
  return {
    kind: "module",
    recipeId: id,
    check: {
      id,
      title: id,
      ...(options.warmSourceScreenId ? { warmSourceScreenId: options.warmSourceScreenId } : {}),
      transitionDependencies: [
        {
          connectionId: id,
          originScreenId: "settings",
          destination: { kind: "screen", screenId: id },
        },
      ],
      ...(options.recovery ? { recovery: options.recovery } : {}),
    },
  };
}

test("reorders only return-equivalent Settings leaves by frozen semantic order", () => {
  const map = mapWithSettingsSurface();
  map.connections.appearance = leaf(map, "appearance", "appearance");
  map.connections.privacy = leaf(map, "privacy", "privacy");
  map.connections.help = leaf(map, "help", "help");
  const graph = root([
    check("appearance"),
    check("help", { warmSourceScreenId: "appearance" }),
    check("privacy", { warmSourceScreenId: "help" }),
  ]);

  const first = proposeAppMapTestExecutionSchedule(map, "root", graph);
  const reversedInput: AppMap = {
    ...structuredClone(map),
    connections: Object.fromEntries(Object.entries(map.connections).reverse()),
    screenVariants: Object.fromEntries(Object.entries(map.screenVariants).reverse()),
  };
  const second = proposeAppMapTestExecutionSchedule(reversedInput, "root", structuredClone(graph));

  assert.deepEqual(second, first, "map object insertion order cannot change a proposed run");
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.mode, "review-required");
  assert.deepEqual(
    first.checks.map((entry) => [entry.checkId, entry.authoredIndex, entry.proposedIndex]),
    [
      ["privacy", 2, 0],
      ["appearance", 0, 1],
      ["help", 1, 2],
    ],
  );
  assert.deepEqual(
    first.checks.map((entry) => entry.semanticDocumentOrder),
    [0, 1, 2],
  );
  assert.ok(
    first.checks.every(
      (entry) =>
        entry.disposition === "scheduled" &&
        entry.reason === "reviewed-return-equivalence" &&
        entry.returnToSource?.sourceScreenId === "settings" &&
        entry.returnToSource.kind === "back",
    ),
  );
});

test("uses one explicit inverse edge but never invents a return", () => {
  const map = mapWithSettingsSurface();
  map.connections.appearance = leaf(map, "appearance", "appearance", { returnable: false });
  map.connections["appearance-to-settings"] = {
    ...leaf(map, "appearance-to-settings", "settings", { returnable: false }),
    fromScreenId: "appearance",
    destination: { kind: "screen", screenId: "settings" },
    actions: [{ id: "dismiss-appearance", kind: "tap", target: { label: "Done" } }],
    navigation: {
      targetAlternatives: [{ kind: "accessibility", label: "Done" }],
      expectedDestination: {
        screenId: "settings",
        identity: structuredClone(map.screens.settings!.identity!),
        evidenceIds: [],
      },
    },
  };
  const scheduled = proposeAppMapTestExecutionSchedule(map, "root", root([check("appearance")]));
  assert.deepEqual(scheduled.checks[0]?.returnToSource, {
    sourceScreenId: "settings",
    terminalScreenId: "appearance",
    kind: "connection",
    connectionIds: ["appearance-to-settings"],
  });

  delete map.connections["appearance-to-settings"];
  const fixed = proposeAppMapTestExecutionSchedule(map, "root", root([check("appearance")]));
  assert.deepEqual(fixed.checks[0], {
    checkId: "appearance",
    recipeId: "appearance",
    authoredIndex: 0,
    proposedIndex: 0,
    sourceScreenId: "settings",
    disposition: "fixed",
    reason: "missing-reviewed-return",
  });
});

test("defers unknown, external, and reset branches while retaining cold fallback review", () => {
  const map = mapWithSettingsSurface();
  map.connections.system = leaf(map, "system", "system");
  map.connections.unknown = leaf(map, "unknown", "unknown");
  map.connections.cold = leaf(map, "cold", "cold");
  const graph: Record<string, Recipe> = {
    ...root([
      check("system"),
      check("unknown", { warmSourceScreenId: "not-proven" }),
      check("cold", {
        warmSourceScreenId: "unknown",
        recovery: {
          groupId: "cold",
          recipeId: "cold-warm",
          coldRecipeId: "cold-review-only",
        },
      }),
    ]),
    cold: {
      id: "cold",
      title: "Cold branch",
      source: "custom" as const,
      steps: [{ kind: "app", action: "open", app: "ai.x.GrokApp", relaunch: true }],
      createdAt: at,
      updatedAt: at,
    },
  };
  const schedule = proposeAppMapTestExecutionSchedule(map, "root", graph);

  assert.deepEqual(
    schedule.checks.map((entry) => [entry.checkId, entry.disposition, entry.reason]),
    [
      ["system", "deferred", "external-handoff"],
      ["unknown", "deferred", "unknown-cursor"],
      ["cold", "deferred", "cold-reset-branch"],
    ],
  );
  assert.deepEqual(schedule.deferredBranches, [
    { checkId: "cold", recipeId: "cold-review-only", reason: "cold-reset-branch" },
  ]);
  assert.equal(schedule.mode, "review-required");

  const invalidInitialCursor = proposeAppMapTestExecutionSchedule(
    map,
    "root",
    root([check("cold", { warmSourceScreenId: "not-proven" })]),
  );
  assert.deepEqual(
    [invalidInitialCursor.checks[0]?.disposition, invalidInitialCursor.checks[0]?.reason],
    ["deferred", "unknown-cursor"],
  );
});

test("defers conflicting semantic order and keeps multi-edge prerequisites authored", () => {
  const map = mapWithSettingsSurface();
  map.connections.privacy = leaf(map, "privacy", "privacy");
  map.screenVariants["settings-fr"] = {
    ...structuredClone(map.screenVariants["settings-en"]!),
    id: "settings-fr",
    scrollSurfaces: [
      {
        ...structuredClone(map.screenVariants["settings-en"]!.scrollSurfaces![0]!),
        id: "settings-surface-fr",
        captureId: "settings-capture-fr",
        semanticIndex: {
          ...structuredClone(map.screenVariants["settings-en"]!.scrollSurfaces![0]!.semanticIndex!),
          anchors: [{ order: 3, documentY: 300, target: { label: "Privacy" }, label: "Privacy" }],
        },
      },
    ],
  };
  const conflict = proposeAppMapTestExecutionSchedule(map, "root", root([check("privacy")]));
  assert.deepEqual(
    [conflict.checks[0]?.disposition, conflict.checks[0]?.reason],
    ["deferred", "conflicting-document-order"],
  );

  delete map.screenVariants["settings-fr"];
  const prerequisite = {
    kind: "module",
    recipeId: "privacy",
    check: {
      id: "privacy",
      title: "privacy",
      transitionDependencies: [
        {
          connectionId: "privacy",
          originScreenId: "settings",
          destination: { kind: "screen", screenId: "privacy" },
        },
        {
          connectionId: "privacy",
          originScreenId: "settings",
          destination: { kind: "screen", screenId: "privacy" },
        },
      ],
    },
  };
  const fixed = proposeAppMapTestExecutionSchedule(map, "root", root([prerequisite]));
  assert.deepEqual(
    [fixed.checks[0]?.disposition, fixed.checks[0]?.reason],
    ["fixed", "prerequisite-boundary"],
  );
});
