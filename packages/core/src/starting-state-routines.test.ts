import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppMap,
  AppMapEntity,
  AppMapScenarioTest,
  Connection,
  Routine,
  Screen,
} from "@relay/protocol";
import {
  BROWSER_LANE_ISOLATION_NOTE,
  MUTATING_ROUTINE_PRESETS,
  STARTING_STATE_ROUTINE_PRESETS,
} from "@relay/protocol";
import { compileAppMapConnection } from "./app-map-compiler.js";
import { leftoverSkipForbidden } from "./coverage-step-outcome.js";
import { AppMapTestCompileError } from "./app-map-test-compiler.js";
import { compileAppMapCombine, compileAppMapTest } from "./map-work.js";
import {
  assessIntraTestStartingState,
  assessMutatingRoutineSharing,
  assessSequentialStartingState,
  assessTransitionDeclaredSource,
  transitionOpenerMustRun,
  UnsafeStartingStateError,
} from "./starting-state-routines.js";

const at = 1_000;
const scope = { organizationId: "org-1", projectId: "project-1", appMapId: "map-1" };

function entity(id: string): AppMapEntity {
  return { ...scope, id, createdAt: at, updatedAt: at };
}

function screen(id: string, title: string): Screen {
  return {
    ...entity(id),
    title,
    identity: { schemaVersion: 1, fingerprint: (id === "home" ? "a" : "b").repeat(64) },
    variantIds: [],
  };
}

function routine(id: string, effects: Routine["effects"]): Routine {
  return {
    ...entity(id),
    name: id,
    parameters: [],
    actions: [{ id: `${id}-wait`, kind: "wait", ms: 10 }],
    ...(effects ? { effects } : {}),
  };
}

function moduleTest(id: string, routineId: string, extra: Partial<AppMapScenarioTest> = {}): AppMapScenarioTest {
  return {
    ...entity(id),
    name: id,
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: `${id}-run`,
        intent: id,
        kind: "module",
        binding: { status: "resolved", kind: "routine", routineId },
      },
    ],
    ...extra,
  };
}

function mapWith(routines: Record<string, Routine>, tests: Record<string, AppMapScenarioTest>, connections: Record<string, Connection> = {}): AppMap {
  return {
    schemaVersion: 1,
    id: scope.appMapId,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    name: "Starting state",
    revision: 1,
    notes: {},
    groups: {},
    screens: { home: screen("home", "Home"), settings: screen("settings", "Settings") },
    screenVariants: {},
    connections,
    caseStacks: {},
    variables: {},
    tests,
    combines: {},
    routines,
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  };
}

const inspectSettings = routine("inspect-settings", MUTATING_ROUTINE_PRESETS["inspect-settings"]);
const homeChrome = routine("home-chrome", STARTING_STATE_ROUTINE_PRESETS["home-chrome"]);
const knownAccount = routine("known-account", STARTING_STATE_ROUTINE_PRESETS["known-account"]);
const signOut = routine("sign-out", MUTATING_ROUTINE_PRESETS["sign-out"]);
const deleteConversation = routine(
  "delete-conversation",
  MUTATING_ROUTINE_PRESETS["delete-conversation"],
);
const changePrefs = routine("change-prefs", MUTATING_ROUTINE_PRESETS["change-prefs"]);

function inspectThenHomeMap(cleanup = false): AppMap {
  const inspectTest = moduleTest("inspect-settings", "inspect-settings");
  if (cleanup) {
    inspectTest.steps = [
      {
        id: "open-settings",
        intent: "Inspect Settings",
        kind: "instruction",
        binding: { status: "resolved", kind: "connections", connectionIds: ["open-settings"] },
        cleanup: {
          kind: "routine",
          routineId: "home-chrome",
          terminalScreenId: "home",
          onCancel: "run-if-controllable",
        },
      },
    ];
  }
  return mapWith(
    {
      "inspect-settings": inspectSettings,
      "home-chrome": homeChrome,
      "known-account": knownAccount,
    },
    {
      "inspect-settings": inspectTest,
      "claim-home": moduleTest("claim-home", "home-chrome", {
        startingState: { requires: ["home-visible"], sourceScreenId: "home" },
      }),
    },
    {
      "open-settings": {
        ...entity("open-settings"),
        fromScreenId: "home",
        destination: { kind: "end" },
        state: "ready",
        actions: [{ id: "use-inspect", kind: "routine", routineId: "inspect-settings" }],
      },
    },
  );
}

test("inspect Settings leftover cannot leave the next Test claiming Home without cleanup", () => {
  const dirty = inspectThenHomeMap(false);
  const issues = assessSequentialStartingState(dirty, ["inspect-settings", "claim-home"]);
  assert.equal(issues[0]?.code, "leftover-home-claim");
  assert.match(issues[0]?.message ?? "", /claims Home/u);
  assert.equal(issues[0]?.testId, "claim-home");
  assert.equal(issues[0]?.previousTestId, "inspect-settings");

  const cleaned = inspectThenHomeMap(true);
  assert.deepEqual(assessSequentialStartingState(cleaned, ["inspect-settings", "claim-home"]), []);

  const intra = mapWith(
    { "inspect-settings": inspectSettings, "home-chrome": homeChrome },
    {
      mixed: {
        ...entity("mixed"),
        name: "mixed",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            id: "inspect",
            intent: "Inspect Settings",
            kind: "module",
            binding: { status: "resolved", kind: "routine", routineId: "inspect-settings" },
          },
          {
            id: "claim",
            intent: "Claim Home",
            kind: "module",
            binding: { status: "resolved", kind: "routine", routineId: "claim-home" },
          },
        ],
      },
    },
  );
  intra.routines["claim-home"] = routine("claim-home", { requires: ["home-visible"] });
  const intraIssues = assessIntraTestStartingState(intra, intra.tests.mixed!);
  assert.equal(intraIssues[0]?.code, "leftover-home-claim");

  assert.throws(
    () => compileAppMapCombine(dirty, { ...entity("pack"), name: "pack", variableIds: [], testIds: ["inspect-settings", "claim-home"] }),
    (error: unknown) =>
      error instanceof UnsafeStartingStateError && error.issueCode === "leftover-home-claim",
  );
  assert.doesNotThrow(() => compileAppMapTest(dirty, dirty.tests["inspect-settings"]!));
});

test("coverage:transition opener still must run from the declared source", () => {
  const transition: Connection = {
    ...entity("open-settings"),
    fromScreenId: "home",
    destination: { kind: "end" },
    coverage: "transition",
    state: "ready",
    actions: [
      {
        id: "open-settings",
        kind: "steps",
        coverage: "transition",
        steps: [
          { kind: "wait-for", target: { identifier: "composer" }, timeoutMs: 8_000 },
          { kind: "tap", target: { identifier: "sidebar.settings" }, coverage: "transition" },
          { kind: "wait-for", target: { identifier: "settings.account" }, timeoutMs: 8_000 },
        ],
      },
    ],
  };
  const map = mapWith({}, {}, { "open-settings": transition });
  const compiled = compileAppMapConnection(map, "open-settings");
  const opener = compiled.recipes[compiled.rootRecipeId]!.steps.find((step) => step.kind === "tap");
  assert.equal(opener?.coverage, "transition");
  assert.equal(opener?.when, undefined);
  assert.equal(transitionOpenerMustRun(opener!), true);
  assert.equal(
    leftoverSkipForbidden({
      ...opener!,
      when: { target: { identifier: "settings.account" }, condition: "absent" },
    }),
    true,
  );

  const aligned: AppMapScenarioTest = {
    ...entity("open-from-home"),
    name: "Open from Home",
    kind: "scenario",
    intentSchemaVersion: 1,
    startingState: { sourceScreenId: "home" },
    steps: [
      {
        id: "open",
        intent: "Open Settings",
        kind: "instruction",
        binding: { status: "resolved", kind: "connections", connectionIds: ["open-settings"] },
      },
    ],
  };
  assert.deepEqual(assessTransitionDeclaredSource(map, aligned), []);

  const leftoverSource: AppMapScenarioTest = {
    ...aligned,
    id: "open-from-settings",
    startingState: { sourceScreenId: "home" },
  };
  const mismatched = structuredClone(map);
  mismatched.connections["open-settings"] = { ...transition, fromScreenId: "settings" };
  const mismatch = assessTransitionDeclaredSource(mismatched, leftoverSource);
  assert.equal(mismatch[0]?.code, "transition-source-mismatch");
  assert.match(mismatch[0]?.message ?? "", /declared source home/u);

  mismatched.tests["open-from-settings"] = leftoverSource;
  assert.throws(
    () => compileAppMapTest(mismatched, leftoverSource),
    (error: unknown) =>
      error instanceof AppMapTestCompileError && error.code === "unsafe-starting-state",
  );
});

test("sign-out / delete / pref-change declare effects that block unsafe sharing", () => {
  const map = mapWith(
    {
      "sign-out": signOut,
      "delete-conversation": deleteConversation,
      "change-prefs": changePrefs,
      "home-chrome": homeChrome,
      "owned-conversation": routine(
        "owned-conversation",
        STARTING_STATE_ROUTINE_PRESETS["owned-conversation"],
      ),
      "language-theme": routine("language-theme", STARTING_STATE_ROUTINE_PRESETS["language-theme"]),
    },
    {
      "sign-out": moduleTest("sign-out", "sign-out"),
      "delete-conversation": moduleTest("delete-conversation", "delete-conversation"),
      "change-prefs": moduleTest("change-prefs", "change-prefs"),
      home: moduleTest("home", "home-chrome", {
        startingState: { requires: ["known-account", "home-visible"] },
      }),
      history: moduleTest("history", "owned-conversation", {
        startingState: { requires: ["owned-conversation-available"] },
      }),
      appearance: moduleTest("appearance", "language-theme", {
        startingState: { requires: ["language-theme-established"] },
      }),
    },
  );
  const following: Record<"sign-out" | "delete-conversation" | "change-prefs", string> = {
    "sign-out": "home",
    "delete-conversation": "history",
    "change-prefs": "appearance",
  };
  for (const mutating of ["sign-out", "delete-conversation", "change-prefs"] as const) {
    const sequential = assessSequentialStartingState(map, [mutating, following[mutating]]);
    assert.ok(sequential.length, mutating);
    const sharing = assessMutatingRoutineSharing(map, [
      { testId: mutating, accountId: "grok-lab", laneId: "grok-lab" },
      { testId: following[mutating], accountId: "grok-lab", laneId: "grok-lab" },
    ]);
    assert.equal(sharing[0]?.code, "unsafe-sharing");
    map.routines[mutating] = {
      ...map.routines[mutating]!,
      effects: { ...MUTATING_ROUTINE_PRESETS[mutating], sharing: "isolated-account" },
    };
    const allowed = assessMutatingRoutineSharing(map, [
      { testId: mutating, accountId: "grok-lab", laneId: "grok-lab" },
      { testId: following[mutating], accountId: "disposable-b", laneId: "grok-lab" },
    ]);
    assert.deepEqual(allowed, [], mutating);
    map.routines[mutating] = {
      ...map.routines[mutating]!,
      effects: MUTATING_ROUTINE_PRESETS[mutating],
    };
  }
});

test("browser Lane isolation is not server-side account isolation", () => {
  const map = mapWith(
    { "sign-out": signOut, "home-chrome": homeChrome },
    {
      "sign-out": moduleTest("sign-out", "sign-out"),
      home: moduleTest("home", "home-chrome"),
    },
  );
  const acrossLanes = assessMutatingRoutineSharing(map, [
    { testId: "sign-out", accountId: "grok-lab", laneId: "grok-lab" },
    { testId: "home", accountId: "grok-lab", laneId: "grok-daily-b" },
  ]);
  assert.equal(acrossLanes[0]?.code, "lane-is-not-account");
  assert.match(acrossLanes[0]?.message ?? "", /not server-side account isolation/u);
  assert.match(MUTATING_ROUTINE_PRESETS["sign-out"].accountIsolationNote, /Playwright/u);
  assert.equal(MUTATING_ROUTINE_PRESETS["sign-out"].accountIsolationNote, BROWSER_LANE_ISOLATION_NOTE);

  const laneOnly = {
    ...signOut,
    effects: { ...MUTATING_ROUTINE_PRESETS["sign-out"], sharing: "isolated-lane" as const },
  };
  map.routines["sign-out"] = laneOnly;
  const stillBlocked = assessMutatingRoutineSharing(map, [
    { testId: "sign-out", accountId: "grok-lab", laneId: "grok-lab" },
    { testId: "home", accountId: "grok-lab", laneId: "grok-daily-b" },
  ]);
  assert.equal(stillBlocked[0]?.code, "lane-is-not-account");
});

test("Tests without declared effects still pack in graph order", () => {
  const map = mapWith(
    { "home-chrome": homeChrome },
    {
      a: moduleTest("a", "home-chrome"),
      b: moduleTest("b", "home-chrome"),
    },
  );
  assert.deepEqual(assessSequentialStartingState(map, ["a", "b"]), []);
  assert.doesNotThrow(() =>
    compileAppMapCombine(map, { ...entity("pack"), name: "pack", variableIds: [], testIds: ["a", "b"] }),
  );
});
