import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppMap,
  AppMapCombine,
  AppMapScenarioTest,
  OfflineTestPreflightReport,
} from "@relay/protocol";
import {
  appMapCombineCellId,
  appMapCombineCellVariablePrefix,
  canonicalAppMapCombineCellValues,
  compareUtf8Bytewise,
} from "./app-map-combine-cell.js";
import {
  createAppMapCombineCellExecutionIntent,
  parseAppMapCombineCellExecutionIntent,
  reachableRecipeGraph,
} from "./app-map-combine-cell-intent.js";
import {
  AppMapCombineCellContractError,
  assessAppMapCombineCellBindings,
  prepareAppMapCombineCells,
} from "./app-map-combine-cell-prepare.js";
import { assessAppMapTestExecutionSource } from "./app-map-test-execution-gate.js";
import {
  composeAppMapCombineCellWrapper,
  declaredCombineCellStaticInputs,
} from "./app-map-combine-cell-wrapper.js";
import {
  pendingSelectedCombineCampaignCells,
  type StoredCombineCampaign,
} from "./combine-campaign.js";
import {
  createAppMapTestExecutionIntent,
  digestAppMapTestExecutionValue,
} from "./app-map-test-execution-intent.js";
import type { Recipe } from "./recipes.js";

test("cell IDs stay identifier-safe for punctuation and large tuples", () => {
  const values = Object.fromEntries(
    Array.from({ length: 24 }, (_, index) => [
      `var-${index}.id_x`,
      `value/${index}:ok`.replace("/", "-"),
    ]),
  );
  const cellId = appMapCombineCellId("settings-test.v2", values);
  assert.match(cellId, /^c[a-f0-9]{32}$/u);
  assert.equal(cellId.length, 33);
  assert.equal(appMapCombineCellId("settings-test.v2", { z: "1", a: "2" }).length, 33);
  const punct = appMapCombineCellId("t", { "a-b": "en-US", a_b: "pt-BR" });
  assert.equal(punct, appMapCombineCellId("t", { a_b: "pt-BR", "a-b": "en-US" }));
});

test("canonical cell values sort bytewise, not by localeCompare", () => {
  const left = "ä";
  const right = "z";
  const locale = left.localeCompare(right, "de");
  const bytewise = compareUtf8Bytewise(left, right);
  assert.notEqual(Math.sign(locale) || 0, 0);
  assert.equal(Math.sign(bytewise), 1);
  assert.deepEqual(Object.keys(canonicalAppMapCombineCellValues({ z: "1", ä: "2" })), ["z", "ä"]);
});

test("collision-prone variable IDs keep distinct wrapper prefixes", () => {
  const dashed = appMapCombineCellVariablePrefix("a-b", 0);
  const underscored = appMapCombineCellVariablePrefix("a_b", 1);
  assert.notEqual(dashed, underscored);
  assert.match(dashed, /^v0_[a-f0-9]{12}$/u);
  assert.match(underscored, /^v1_[a-f0-9]{12}$/u);
});

test("wrapper helpers for a-b and a_b cannot overwrite each other", () => {
  const child: Recipe = {
    id: "child-root",
    title: "Child",
    source: "custom",
    steps: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const composed = composeAppMapCombineCellWrapper({
    cellId: "c" + "a".repeat(32),
    childRootId: child.id,
    childGraph: { [child.id]: child },
    sets: [
      {
        id: "a-b",
        name: "Dashed",
        kind: "language",
        apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "Open" } }] },
        options: [{ id: "en", identifier: "dash.en", label: "English", text: "EN" }],
      },
      {
        id: "a_b",
        name: "Underscored",
        kind: "language",
        apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "Open" } }] },
        options: [{ id: "pt", identifier: "under.pt", label: "Português", text: "PT" }],
      },
    ],
    at: 1,
  });
  assert.notEqual(composed.prefixes["a-b"], composed.prefixes["a_b"]);
  assert.ok(composed.graph[`__opt_${composed.prefixes["a-b"]}_tap_identifier`]);
  assert.ok(composed.graph[`__opt_${composed.prefixes["a_b"]}_tap_identifier`]);
  assert.equal(composed.graph[child.id]?.steps.length, 0);
});

function destinationLeaf(id = "data-controls-leaf"): Recipe {
  return {
    id,
    title: "Leaf",
    source: "custom",
    steps: [
      {
        kind: "expect-screen",
        id: "data-controls",
        screenId: "data-controls",
        screenTitle: "Data Controls",
        fingerprint: "a".repeat(64),
        recovery: { strategy: "back" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
}

test("appLocale Combine stays when a module-rooted Test names a destination", () => {
  const leaf = destinationLeaf();
  const compiled: Recipe = {
    id: "child-root",
    title: "Child",
    source: "custom",
    steps: [{ kind: "module", recipeId: leaf.id }],
    createdAt: 1,
    updatedAt: 1,
  };
  const stay = composeAppMapCombineCellWrapper({
    cellId: "c" + "c".repeat(32),
    childRootId: compiled.id,
    childGraph: { [compiled.id]: compiled, [leaf.id]: leaf },
    sets: [
      {
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "com.example" },
        options: [{ id: "he" }],
        restoreId: "en",
      },
    ],
    at: 1,
  });
  assert.equal(
    stay.root.steps.some((step) => step.kind === "app" && step.action === "open"),
    false,
  );
  assert.deepEqual(
    stay.root.steps.filter((step) => step.kind === "app" || step.kind === "expect-screen"),
    [
      {
        kind: "app",
        action: "set-locale",
        app: "com.example",
        locale: `{{${stay.prefixes.language}}}`,
      },
      {
        kind: "expect-screen",
        id: "data-controls-stay",
        screenId: "data-controls",
        screenTitle: "Data Controls",
        fingerprint: "a".repeat(64),
      },
      { kind: "app", action: "set-locale", app: "com.example", locale: "en" },
    ],
  );
});

test("appLocale Combine relaunches when the child Test has no destination identity", () => {
  const noIdentity: Recipe = {
    id: "child-root",
    title: "Child",
    source: "custom",
    steps: [{ kind: "screenshot", caption: "body" }],
    createdAt: 1,
    updatedAt: 1,
  };
  const relaunch = composeAppMapCombineCellWrapper({
    cellId: "c" + "d".repeat(32),
    childRootId: noIdentity.id,
    childGraph: { [noIdentity.id]: noIdentity },
    sets: [
      {
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "com.example" },
        options: [{ id: "he" }],
        restoreId: "en",
      },
    ],
    at: 1,
  });
  assert.deepEqual(
    relaunch.root.steps.filter((step) => step.kind === "app"),
    [
      {
        kind: "app",
        action: "set-locale",
        app: "com.example",
        locale: `{{${relaunch.prefixes.language}}}`,
      },
      { kind: "app", action: "open", app: "com.example", relaunch: true },
      { kind: "app", action: "set-locale", app: "com.example", locale: "en" },
      { kind: "app", action: "open", app: "com.example", relaunch: true },
    ],
  );
  assert.equal(
    relaunch.root.steps.some((step) => step.kind === "expect-screen"),
    false,
  );
});

test("appLocale Combine relaunches when apply.relaunch is explicit true", () => {
  const leaf = destinationLeaf();
  const compiled: Recipe = {
    id: "child-root",
    title: "Child",
    source: "custom",
    steps: [{ kind: "module", recipeId: leaf.id }],
    createdAt: 1,
    updatedAt: 1,
  };
  const relaunch = composeAppMapCombineCellWrapper({
    cellId: "c" + "e".repeat(32),
    childRootId: compiled.id,
    childGraph: { [compiled.id]: compiled, [leaf.id]: leaf },
    sets: [
      {
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "com.example", relaunch: true },
        options: [{ id: "he" }],
        restoreId: "en",
      },
    ],
    at: 1,
  });
  assert.ok(
    relaunch.root.steps.some(
      (step) => step.kind === "app" && step.action === "open" && step.relaunch === true,
    ),
  );
  assert.equal(
    relaunch.root.steps.some((step) => step.kind === "expect-screen"),
    false,
  );
});

test("explicit stay fail-closes without inventing a destination identity", () => {
  const destination: Recipe = {
    id: "child-root",
    title: "Child",
    source: "custom",
    steps: [
      {
        kind: "expect-screen",
        id: "data-controls",
        screenId: "data-controls",
        screenTitle: "Data Controls",
        fingerprint: "a".repeat(64),
        recovery: { strategy: "back" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const stay = composeAppMapCombineCellWrapper({
    cellId: "c" + "f".repeat(32),
    childRootId: destination.id,
    childGraph: { [destination.id]: destination },
    sets: [
      {
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "com.example", relaunch: false },
        options: [{ id: "he" }],
        restoreId: "en",
      },
    ],
    at: 1,
  });
  assert.deepEqual(
    stay.root.steps.filter((step) => step.kind === "app" || step.kind === "expect-screen"),
    [
      {
        kind: "app",
        action: "set-locale",
        app: "com.example",
        locale: `{{${stay.prefixes.language}}}`,
      },
      {
        kind: "expect-screen",
        id: "data-controls-stay",
        screenId: "data-controls",
        screenTitle: "Data Controls",
        fingerprint: "a".repeat(64),
      },
      { kind: "app", action: "set-locale", app: "com.example", locale: "en" },
    ],
  );

  const noIdentity: Recipe = {
    ...destination,
    steps: [{ kind: "screenshot", caption: "body" }],
  };
  const stayWithoutIdentity = composeAppMapCombineCellWrapper({
    cellId: "c" + "a".repeat(32),
    childRootId: noIdentity.id,
    childGraph: { [noIdentity.id]: noIdentity },
    sets: [
      {
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "com.example", relaunch: false },
        options: [{ id: "he" }],
      },
    ],
    at: 1,
  });
  assert.equal(
    stayWithoutIdentity.root.steps.some((step) => step.kind === "expect-screen"),
    false,
  );
  assert.equal(
    stayWithoutIdentity.root.steps.some((step) => step.kind === "app" && step.action === "open"),
    false,
  );
});

test("wrapper reachable child graph must match the frozen child recipes exactly", () => {
  const childRoot: Recipe = {
    id: "child-root",
    title: "Child",
    source: "custom",
    steps: [{ kind: "module", recipeId: "leaf" }],
    createdAt: 1,
    updatedAt: 1,
  };
  const leaf: Recipe = {
    id: "leaf",
    title: "Leaf",
    source: "custom",
    steps: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const composed = composeAppMapCombineCellWrapper({
    cellId: "c" + "b".repeat(32),
    childRootId: childRoot.id,
    childGraph: { [childRoot.id]: childRoot, [leaf.id]: leaf },
    sets: [
      {
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "Open" } }] },
        options: [{ id: "en", identifier: "lang.en" }],
      },
    ],
    at: 1,
  });
  const reachable = reachableRecipeGraph(composed.graph, childRoot.id);
  assert.deepEqual(Object.keys(reachable ?? {}).sort(), ["child-root", "leaf"]);
  const substituted = structuredClone(composed.graph);
  substituted.leaf = { ...leaf, title: "Impostor" };
  const impostorReachable = reachableRecipeGraph(substituted, childRoot.id);
  assert.notEqual(
    digestAppMapTestExecutionValue(impostorReachable),
    digestAppMapTestExecutionValue({ [childRoot.id]: childRoot, [leaf.id]: leaf }),
  );
});

test("static companions freeze identifier/label/text for the selected row", () => {
  const sets = [
    {
      id: "language",
      name: "Language",
      kind: "language" as const,
      apply: {
        kind: "list" as const,
        entryPath: [{ kind: "tap" as const, target: { label: "Open" } }],
      },
      options: [
        { id: "en", identifier: "lang.en", label: "English", text: "EN" },
        { id: "en-dup", identifier: "lang.en2", label: "English", text: "English" },
      ],
    },
  ];
  const frozen = declaredCombineCellStaticInputs(sets, { language: "en" });
  assert.deepEqual(frozen.companions.language, {
    identifier: "lang.en",
    label: "English",
    text: "EN",
  });
  const other = declaredCombineCellStaticInputs(sets, { language: "en-dup" });
  assert.notEqual(other.companions.language?.identifier, frozen.companions.language?.identifier);
});

test("binding assessment rejects zero, duplicate, foreign, and missing coverage", () => {
  const cells = [
    {
      cellId: appMapCombineCellId("settings", { language: "en" }),
      testId: "settings",
      testName: "Settings",
      values: { language: "en" },
      worldLabel: "English",
    },
    {
      cellId: appMapCombineCellId("settings", { language: "it" }),
      testId: "settings",
      testName: "Settings",
      values: { language: "it" },
      worldLabel: "Italian",
    },
  ];
  const zero = assessAppMapCombineCellBindings({ cells, bindings: [] });
  assert.ok(zero.issues.some((item) => item.code === "zero-bindings"));
  const missing = assessAppMapCombineCellBindings({
    cells,
    bindings: [{ testId: "settings", values: { language: "en" }, targetProfileId: "pixel-en" }],
    knownTests: new Set(["settings"]),
    knownValues: { language: new Set(["en", "it"]) },
  });
  assert.ok(
    missing.issues.some(
      (item) => item.code === "missing-binding" && item.values?.language === "it",
    ),
  );
  const duplicate = assessAppMapCombineCellBindings({
    cells,
    bindings: [
      { testId: "settings", values: { language: "en" }, targetProfileId: "pixel-en" },
      { testId: "settings", values: { language: "en" }, targetProfileId: "pixel-en-2" },
      { testId: "settings", values: { language: "it" }, targetProfileId: "pixel-it" },
    ],
    knownTests: new Set(["settings"]),
    knownValues: { language: new Set(["en", "it"]) },
  });
  assert.ok(duplicate.issues.some((item) => item.code === "duplicate-binding"));
  const foreign = assessAppMapCombineCellBindings({
    cells,
    bindings: [
      { testId: "settings", values: { language: "en" }, targetProfileId: "pixel-en" },
      { testId: "settings", values: { language: "it" }, targetProfileId: "pixel-it" },
      { testId: "other", values: { language: "en" }, targetProfileId: "pixel-en" },
    ],
    knownTests: new Set(["settings"]),
    knownValues: { language: new Set(["en", "it"]) },
  });
  assert.ok(foreign.issues.some((item) => item.code === "foreign-binding"));
});

function childFixture() {
  const root: Recipe = {
    id: "settings:smoke:root",
    title: "Smoke",
    source: "custom",
    steps: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const plan = {
    schemaVersion: 1 as const,
    appMapId: "settings",
    appMapRevision: 7,
    test: {
      id: "smoke",
      name: "Smoke",
      kind: "scenario" as const,
      intentSchemaVersion: 1 as const,
    },
    runtimeTargetProfile: { id: "ipad-en", targetId: "ipad-1", platform: "ios" as const },
    rootRecipeId: root.id,
    recipes: { [root.id]: { id: root.id, title: root.title, parameters: [], steps: [] } },
    stepProvenance: [],
    performance: {
      executableOperations: 0,
      moduleCalls: 0,
      operationCounts: {},
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "cold" as const },
  };
  const recipeGraph = { [root.id]: root };
  const preflight: OfflineTestPreflightReport = {
    schemaVersion: 1,
    mode: "offline-test-preflight",
    appMapId: plan.appMapId,
    appMapRevision: plan.appMapRevision,
    testId: plan.test.id,
    planDigest: digestAppMapTestExecutionValue(plan),
    summary: {
      recipes: 1,
      checkedSelectors: 0,
      resolvedSelectors: 0,
      unknownCursorTransitions: 0,
      reviewRequiredReturns: 0,
      blockers: 0,
      warnings: 0,
    },
    selectors: [],
    cursorTimeline: [],
    returns: [],
    findings: [],
  };
  const child = createAppMapTestExecutionIntent({ plan, recipeGraph, preflight });
  return { child, root, recipeGraph };
}

test("outer Combine cell intent recomputes cellId and rejects a substituted child graph", () => {
  const { child, root } = childFixture();
  const wrapper = composeAppMapCombineCellWrapper({
    cellId: appMapCombineCellId("smoke", { language: "en" }),
    childRootId: root.id,
    childGraph: child.recipeGraph,
    sets: [
      {
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "Open" } }] },
        options: [{ id: "en", identifier: "lang.en", label: "English" }],
      },
    ],
    at: 1,
  });
  const intent = createAppMapCombineCellExecutionIntent({
    cellId: appMapCombineCellId("smoke", { language: "en" }),
    testId: "smoke",
    values: { language: "en" },
    selectedRuntimeTargetProfile: child.selectedRuntimeTargetProfile!,
    child,
    wrapperRoot: wrapper.root,
    recipeGraph: wrapper.graph,
    staticInputs: declaredCombineCellStaticInputs(
      [
        {
          id: "language",
          name: "Language",
          kind: "language",
          apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "Open" } }] },
          options: [{ id: "en", identifier: "lang.en", label: "English" }],
        },
      ],
      { language: "en" },
    ),
  });
  assert.equal(parseAppMapCombineCellExecutionIntent(intent)?.cell.cellId, intent.cell.cellId);
  const tampered = structuredClone(intent);
  tampered.cell.values = { language: "it" };
  assert.equal(parseAppMapCombineCellExecutionIntent(tampered), undefined);
  const swapped = structuredClone(intent);
  swapped.recipeGraph[root.id] = { ...root, title: "Swapped" };
  assert.equal(parseAppMapCombineCellExecutionIntent(swapped), undefined);
});

test("resume selects pending cells by status and persisted selected IDs", () => {
  const selected = "c" + "b".repeat(32);
  const unselected = "c" + "d".repeat(32);
  const campaign = {
    schemaVersion: 1 as const,
    id: "campaign-1",
    projectId: "p",
    appMapId: "settings",
    combineId: "languages",
    sourceRevision: 1,
    latestRevision: 1,
    target: { kind: "device" as const, id: "android-1", platform: "android" as const },
    status: "ready-to-resume" as const,
    createdAt: 1,
    updatedAt: 1,
    cases: [
      {
        index: 0,
        cellId: "c" + "a".repeat(32),
        testId: "settings",
        world: "English",
        values: { language: "en" },
        targetProfileId: "pixel-en",
        childIntentDigest: "a".repeat(64),
        outerIntentDigest: "b".repeat(64),
        wrapperGraphDigest: "c".repeat(64),
        staticInputDigest: "d".repeat(64),
        phase: "pilot" as const,
        status: "passed" as const,
      },
      {
        index: 1,
        cellId: selected,
        testId: "settings",
        world: "Italian",
        values: { language: "it" },
        targetProfileId: "pixel-it",
        childIntentDigest: "e".repeat(64),
        outerIntentDigest: "f".repeat(64),
        wrapperGraphDigest: "1".repeat(64),
        staticInputDigest: "2".repeat(64),
        phase: "coverage" as const,
        status: "pending" as const,
      },
      {
        index: 2,
        cellId: unselected,
        testId: "settings",
        world: "French",
        values: { language: "fr" },
        targetProfileId: "pixel-fr",
        childIntentDigest: "3".repeat(64),
        outerIntentDigest: "4".repeat(64),
        wrapperGraphDigest: "5".repeat(64),
        staticInputDigest: "6".repeat(64),
        phase: "coverage" as const,
        status: "pending" as const,
      },
    ],
    lineage: [],
    execution: {
      selectedCellIds: ["c" + "a".repeat(32), selected],
      seed: 1,
    },
  } satisfies StoredCombineCampaign;
  const pending = pendingSelectedCombineCampaignCells(campaign);
  assert.deepEqual(
    pending.map((item) => item.cellId),
    [selected],
  );
});

function scope(id: string) {
  return { organizationId: "org", projectId: "project", appMapId: "settings", id };
}

function scriptTest(): AppMapScenarioTest {
  return {
    ...scope("script-only"),
    name: "Prepare once",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "prepare",
        kind: "script",
        intent: "Prepare without a selector",
        binding: { status: "resolved", kind: "script", source: "return true" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
}

function localeMap(): AppMap {
  const test = scriptTest();
  const combine: AppMapCombine = {
    ...scope("locales"),
    name: "Language × Prepare",
    variableIds: ["language"],
    testIds: [test.id],
    selected: { language: ["en", "it"] },
    cellRuntimeProfiles: [
      { testId: test.id, values: { language: "en" }, targetProfileId: "pixel-en" },
      { testId: test.id, values: { language: "it" }, targetProfileId: "pixel-it" },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    schemaVersion: 1,
    id: "settings",
    organizationId: "org",
    projectId: "project",
    name: "Settings",
    revision: 3,
    notes: {},
    groups: {},
    screens: {
      home: {
        ...scope("home"),
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        variantIds: ["home-en", "home-it"],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    screenVariants: {
      "home-en": {
        ...scope("home-en"),
        screenId: "home",
        targetProfile: {
          id: "pixel-en",
          targetId: "pixel-1",
          source: "device",
          platform: "android",
          name: "Pixel · English",
          capabilities: ["snapshot"],
          observedAt: 1,
        },
        observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
        evidenceIds: [],
        evidenceUris: [],
        createdAt: 1,
        updatedAt: 1,
      },
      "home-it": {
        ...scope("home-it"),
        screenId: "home",
        targetProfile: {
          id: "pixel-it",
          targetId: "pixel-1",
          source: "device",
          platform: "android",
          name: "Pixel · Italian",
          capabilities: ["snapshot"],
          observedAt: 1,
        },
        observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
        evidenceIds: [],
        evidenceUris: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    connections: {},
    caseStacks: {},
    variables: {
      language: {
        ...scope("language"),
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "com.example" },
        options: [
          { id: "en", label: "English" },
          { id: "it", label: "Italiano" },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    tests: { [test.id]: test },
    combines: { [combine.id]: combine },
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

test("prepares a locale matrix and a selector-free Test before any target control", async () => {
  const map = localeMap();
  const prepared = await prepareAppMapCombineCells({
    map,
    combine: map.combines.locales!,
    target: { targetId: "pixel-1", platform: "android" },
    selectedCellIds: [
      appMapCombineCellId("script-only", { language: "en" }),
      appMapCombineCellId("script-only", { language: "it" }),
    ],
  });
  assert.equal(prepared.cells.length, 2);
  assert.equal(prepared.selectedCells.length, 2);
  assert.ok(
    prepared.cells.every((cell) => cell.outerIntent.child.sourcePlan.testId === "script-only"),
  );
  assert.equal(prepared.cells[0]?.targetProfileId, "pixel-en");
  assert.equal(prepared.cells[1]?.targetProfileId, "pixel-it");
  const again = await prepareAppMapCombineCells({
    map,
    combine: map.combines.locales!,
    target: { targetId: "pixel-1", platform: "android" },
    selectedCellIds: prepared.selectedCellIds,
  });
  assert.deepEqual(
    again.cells.map((cell) => cell.outerIntent.digest),
    prepared.cells.map((cell) => cell.outerIntent.digest),
  );
  assert.deepEqual(
    again.cells.map((cell) => cell.outerIntent.wrapper.recipeGraphDigest),
    prepared.cells.map((cell) => cell.outerIntent.wrapper.recipeGraphDigest),
  );
});

test("execution gate accepts a wrapper job from an outer Combine cell intent", () => {
  const { child, root } = childFixture();
  const cellId = appMapCombineCellId("smoke", { language: "en" });
  const wrapper = composeAppMapCombineCellWrapper({
    cellId,
    childRootId: root.id,
    childGraph: child.recipeGraph,
    sets: [
      {
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "Open" } }] },
        options: [{ id: "en", identifier: "lang.en", label: "English" }],
      },
    ],
    at: 1,
  });
  const outer = createAppMapCombineCellExecutionIntent({
    cellId,
    testId: "smoke",
    values: { language: "en" },
    selectedRuntimeTargetProfile: child.selectedRuntimeTargetProfile!,
    child,
    wrapperRoot: wrapper.root,
    recipeGraph: wrapper.graph,
    staticInputs: declaredCombineCellStaticInputs(
      [
        {
          id: "language",
          name: "Language",
          kind: "language",
          apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "Open" } }] },
          options: [{ id: "en", identifier: "lang.en", label: "English" }],
        },
      ],
      { language: "en" },
    ),
  });
  const assessment = assessAppMapTestExecutionSource({
    artifacts: [{ kind: "app-map-combine-cell-execution-intent", data: outer }],
    action: wrapper.root.id,
    recipeId: wrapper.root.id,
    recipeSnapshot: wrapper.root,
    recipeGraph: wrapper.graph,
    target: { targetId: "ipad-1", platform: "ios" },
    targetProfile: {
      id: "ipad-en",
      targetId: "ipad-1",
      source: "device",
      platform: "ios",
      name: "iPad",
      capabilities: ["snapshot"],
      observedAt: 1,
    },
  });
  assert.equal(assessment.status, "valid");
  if (assessment.status === "valid") {
    assert.equal(assessment.intent.sourcePlan.testId, "smoke");
    assert.equal(assessment.combineCell?.cell.cellId, cellId);
  }
});

test("prepare fails closed without queueing when a cell has no binding and no default target", async () => {
  const map = localeMap();
  map.combines.locales!.cellRuntimeProfiles = [
    { testId: "script-only", values: { language: "en" }, targetProfileId: "pixel-en" },
  ];
  await assert.rejects(
    () =>
      prepareAppMapCombineCells({
        map,
        combine: map.combines.locales!,
      }),
    (error: unknown) =>
      error instanceof AppMapCombineCellContractError &&
      error.issues.some((item) => item.code === "missing-binding"),
  );
});
