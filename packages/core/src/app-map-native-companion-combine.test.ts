import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapCombine, AppMapScenarioTest, TargetProfile } from "@relay/protocol";
import { AppMapTargetProfileError } from "./app-map-native-companion-compile.js";
import {
  bindCompanionCombineCells,
  resolveCombineCellCompanion,
} from "./app-map-native-companion-combine.js";
import { prepareAppMapCombineCells } from "./app-map-combine-cell-prepare.js";
import { preflightAppMapCombine } from "./app-map-combine-preflight.js";
import { localExecutionTargetRef } from "./app-map-combine-cell-target-binding.js";
import { stagePreparedAppMapCombineCells } from "./app-map-combine-cell-run.js";
import { runSummaryLineage } from "./run-matrix-case.js";
import { runWithOperationContext } from "./operation-context.js";

const at = 1;

function androidProfile(): TargetProfile {
  return {
    id: "device:RQCY104BG8X-1080x2340",
    targetId: "RQCY104BG8X",
    source: "device",
    platform: "android",
    name: "Pixel",
    capabilities: ["screenshot", "tap"],
    observedAt: at,
  };
}

function browserProfile(): TargetProfile {
  return {
    id: "browser:grok-com",
    targetId: "grok-com",
    source: "browser",
    platform: "browser",
    name: "Grok.com",
    capabilities: ["screenshot", "tap"],
    observedAt: at,
  };
}

function emptyMap(id: string, extras: Partial<AppMap> = {}): AppMap {
  return {
    schemaVersion: 1,
    id,
    organizationId: "org",
    projectId: "project",
    name: id,
    revision: 1,
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
    createdAt: at,
    updatedAt: at,
    ...extras,
  };
}

function destEndMap(input: {
  id: string;
  profile: TargetProfile;
  testId: string;
  originApplication: string;
  label: string;
}): AppMap {
  const scope = { organizationId: "org", projectId: "project", appMapId: input.id };
  const variantId = `${input.id}-home`;
  return emptyMap(input.id, {
    screens: {
      home: {
        ...scope,
        id: "home",
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        variantIds: [variantId],
        createdAt: at,
        updatedAt: at,
      },
    },
    screenVariants: {
      [variantId]: {
        ...scope,
        id: variantId,
        screenId: "home",
        targetProfile: input.profile,
        evidenceIds: [],
        createdAt: at,
        updatedAt: at,
      },
    },
    connections: {
      chrome: {
        ...scope,
        id: "chrome",
        fromScreenId: "home",
        destination: { kind: "end" },
        label: input.label,
        state: "ready",
        actions: [
          {
            id: "chrome-steps",
            kind: "steps",
            steps: [{ kind: "wait-for", target: { label: input.label }, timeoutMs: 8_000 }],
          },
        ],
        createdAt: at,
        updatedAt: at,
      },
    },
    tests: {
      [input.testId]: {
        ...scope,
        id: input.testId,
        name: input.label,
        kind: "scenario",
        intentSchemaVersion: 1,
        originApplication: input.originApplication,
        steps: [
          {
            id: "step-action",
            kind: "instruction",
            intent: input.label,
            binding: { status: "resolved", kind: "connections", connectionIds: ["chrome"] },
          },
        ],
        createdAt: at,
        updatedAt: at,
      },
    },
  });
}

function webTest(
  testId: string,
  companions: AppMapScenarioTest["nativeRouteCompanions"],
): AppMapScenarioTest {
  const scope = { organizationId: "org", projectId: "project", appMapId: "grok-web" };
  return {
    ...scope,
    id: testId,
    name: testId,
    kind: "scenario",
    intentSchemaVersion: 1,
    originApplication: "https://grok.com",
    ...(companions ? { nativeRouteCompanions: companions } : {}),
    steps: [
      {
        id: "step-action",
        kind: "instruction",
        intent: "Open signed-in home",
        binding: { status: "resolved", kind: "connections", connectionIds: ["web-home"] },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
}

function grokWeb(test: AppMapScenarioTest): AppMap {
  const scope = { organizationId: "org", projectId: "project", appMapId: "grok-web" };
  const profile = browserProfile();
  return emptyMap("grok-web", {
    screens: {
      home: {
        ...scope,
        id: "home",
        title: "Signed-in home",
        identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
        variantIds: ["web-home"],
        createdAt: at,
        updatedAt: at,
      },
    },
    screenVariants: {
      "web-home": {
        ...scope,
        id: "web-home",
        screenId: "home",
        targetProfile: profile,
        evidenceIds: [],
        createdAt: at,
        updatedAt: at,
      },
    },
    connections: {
      "web-home": {
        ...scope,
        id: "web-home",
        fromScreenId: "home",
        destination: { kind: "end" },
        label: "Home",
        state: "ready",
        actions: [
          {
            id: "web-home-steps",
            kind: "steps",
            steps: [{ kind: "wait-for", target: { label: "What should we explore?" } }],
          },
        ],
        createdAt: at,
        updatedAt: at,
      },
    },
    tests: { [test.id]: test },
  });
}

function adHocCombine(testId: string): AppMapCombine {
  return {
    id: "ad-hoc",
    organizationId: "org",
    projectId: "project",
    appMapId: "grok-web",
    name: testId,
    variableIds: [],
    testIds: [testId],
    selected: {},
    createdAt: at,
    updatedAt: at,
  };
}

test("combine resolve switches grok-web android onto the Galaxy companion", async () => {
  const android = destEndMap({
    id: "grok-android",
    profile: androidProfile(),
    testId: "test-grok-android-home-chrome",
    originApplication: "ai.x.grok",
    label: "Ask Grok",
  });
  const test = webTest("test-grok-web-signed-in-home", [
    { platform: "android", appMapId: "grok-android", testId: "test-grok-android-home-chrome" },
  ]);
  const resolved = await resolveCombineCellCompanion({
    map: grokWeb(test),
    test,
    requestedProfileId: "android",
    requestedTarget: localExecutionTargetRef({ targetId: "grok-com", platform: "browser" }),
    readAppMap: async (id) => (id === "grok-android" ? android : null),
  });
  assert.equal(resolved?.map.id, "grok-android");
  assert.equal(resolved?.test.id, "test-grok-android-home-chrome");
  assert.equal(resolved?.runtimeTargetProfile.id, androidProfile().id);
  assert.equal(resolved?.executionTarget.targetId, "RQCY104BG8X");
  assert.equal(resolved?.executionTarget.platform, "android");
  assert.deepEqual(resolved?.nativeCompanion.requestedFrom, {
    appMapId: "grok-web",
    testId: "test-grok-web-signed-in-home",
  });
});

test("combine prepare of grok-web home × android compiles the companion, not an unknown grok-web profile", async () => {
  const android = destEndMap({
    id: "grok-android",
    profile: androidProfile(),
    testId: "test-grok-android-home-chrome",
    originApplication: "ai.x.grok",
    label: "Ask Grok",
  });
  const test = webTest("test-grok-web-signed-in-home", [
    { platform: "android", appMapId: "grok-android", testId: "test-grok-android-home-chrome" },
  ]);
  const map = grokWeb(test);
  const prepared = await prepareAppMapCombineCells({
    map,
    combine: adHocCombine(test.id),
    target: { targetId: "grok-com", platform: "browser" },
    defaultTargetProfileId: "android",
    readAppMap: async (id) => (id === "grok-android" ? android : null),
  });
  const cell = prepared.cells[0]!;
  assert.equal(cell.testId, "test-grok-web-signed-in-home");
  assert.equal(cell.plan.appMapId, "grok-android");
  assert.equal(cell.plan.test.id, "test-grok-android-home-chrome");
  assert.equal(cell.targetProfileId, androidProfile().id);
  assert.equal(cell.executionTarget.targetId, "RQCY104BG8X");
  assert.deepEqual(cell.nativeCompanion?.requestedFrom, {
    appMapId: "grok-web",
    testId: "test-grok-web-signed-in-home",
  });
  assert.ok(!/not saved in this App Map/u.test(JSON.stringify(cell)));
  const staged = runWithOperationContext(
    {
      schemaVersion: 1,
      actorId: "human:planner",
      actorKind: "human",
      organizationId: "org",
      projectId: "project",
      operationId: "job.combine.start",
      requestId: "companion-lineage-staging",
      idempotencyKey: "companion-lineage-staging",
      issuedAt: 1,
    },
    () =>
      stagePreparedAppMapCombineCells({
        cells: prepared.cells,
        combineId: "parent-plan",
        targetForCell: (item) => item.executionTarget,
        queuedTargetProfile: () => androidProfile(),
        projectId: "project",
        ownerId: "human:planner",
      }),
  );
  try {
    const job = staged.jobs[0]!;
    const frozen = job.artifacts.find((item) => item.kind === "frozen-inputs")!.data as Record<
      string,
      unknown
    >;
    assert.equal(frozen.appMapId, "grok-web");
    assert.equal(frozen.testId, test.id);
    assert.equal(cell.childIntent.sourcePlan.appMapId, "grok-android");
    assert.equal(cell.childIntent.sourcePlan.testId, "test-grok-android-home-chrome");
    const lineage = runSummaryLineage(job);
    assert.deepEqual(lineage.sourceTest, { appMapId: "grok-web", testId: test.id });
    assert.equal(lineage.matrixCase!.appMapId, "grok-web");
    assert.equal(lineage.matrixCase!.testId, test.id);
    assert.equal(lineage.matrixCase!.combineId, "parent-plan");
  } finally {
    staged.rollback();
  }
});

test("Search × iOS combine prepare fail-closes instead of inventing a companion", async () => {
  const test = webTest("test-grok-web-signed-in-search", undefined);
  await assert.rejects(
    () =>
      prepareAppMapCombineCells({
        map: grokWeb(test),
        combine: adHocCombine(test.id),
        target: { targetId: "grok-com", platform: "browser" },
        defaultTargetProfileId: "ios",
        readAppMap: async () => null,
      }),
    (error: unknown) =>
      error instanceof AppMapTargetProfileError &&
      error.code === "COMPANION_TEST_MISSING" &&
      /Grok Settings/u.test(error.message) &&
      !/not saved in this App Map/u.test(error.message),
  );
});

test("combine preflight android binds the companion profile, not an unknown grok-web id", async () => {
  const android = destEndMap({
    id: "grok-android",
    profile: androidProfile(),
    testId: "test-grok-android-home-chrome",
    originApplication: "ai.x.grok",
    label: "Ask Grok",
  });
  const test = webTest("test-grok-web-signed-in-home", [
    { platform: "android", appMapId: "grok-android", testId: "test-grok-android-home-chrome" },
  ]);
  const map = grokWeb(test);
  map.variables.language = {
    organizationId: "org",
    projectId: "project",
    appMapId: "grok-web",
    id: "language",
    name: "Language",
    kind: "language",
    apply: { kind: "appLocale", app: "ai.x.grok" },
    options: [{ id: "en", label: "English" }],
    createdAt: at,
    updatedAt: at,
  };
  const combine: AppMapCombine = {
    ...adHocCombine(test.id),
    variableIds: ["language"],
    selected: { language: ["en"] },
  };
  const preflight = await preflightAppMapCombine(map, combine, {
    target: { targetId: "grok-com", platform: "browser" },
    defaultTargetProfileId: "android",
    readAppMap: async (id) => (id === "grok-android" ? android : null),
  });
  assert.ok(!preflight.blockers.some((item) => /not saved in this App Map/u.test(item.message)));
  assert.equal(preflight.cells[0]?.targetProfileId, androidProfile().id);
});

test("combine preflight Search × iOS is companion-missing, not unknown grok-web profile", async () => {
  const test = webTest("test-grok-web-signed-in-search", undefined);
  const bound = await bindCompanionCombineCells({
    map: grokWeb(test),
    cells: [{ testId: test.id, values: {} }],
    requestedProfileId: "ios",
    requestedTarget: { targetId: "grok-com", platform: "browser" },
    readAppMap: async () => null,
  });
  assert.equal(bound.bindings.length, 0);
  assert.equal(bound.issues[0]?.message.includes("not saved in this App Map"), false);
  assert.match(bound.issues[0]?.message ?? "", /Grok Settings/u);
});
