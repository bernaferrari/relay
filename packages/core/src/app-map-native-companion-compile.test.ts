import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest, TargetProfile } from "@relay/protocol";
import {
  AppMapTargetProfileError,
  compileAppMapTestForTargetProfile,
  resolveAppMapTestForTargetProfile,
} from "./app-map-native-companion-compile.js";
import {
  assertRecordedCompanionForRun,
  companionExecutionTarget,
} from "./app-map-native-companion-run.js";

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

function iosProfile(): TargetProfile {
  return {
    id: "device:db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
    targetId: "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
    source: "device",
    platform: "ios",
    name: "iPad",
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

function webHomeTest(companions: AppMapScenarioTest["nativeRouteCompanions"]): AppMapScenarioTest {
  const scope = { organizationId: "org", projectId: "project", appMapId: "grok-web" };
  return {
    ...scope,
    id: "test-grok-web-signed-in-home",
    name: "Open grok.com signed-in",
    kind: "scenario",
    intentSchemaVersion: 1,
    originApplication: "https://grok.com",
    nativeRouteCompanions: companions,
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

test("android alias run resolves the companion Test and Galaxy profile, not an unknown grok-web profile", async () => {
  const android = destEndMap({
    id: "grok-android",
    profile: androidProfile(),
    testId: "test-grok-android-home-chrome",
    originApplication: "ai.x.grok",
    label: "Ask Grok",
  });
  const test = webHomeTest([
    { platform: "android", appMapId: "grok-android", testId: "test-grok-android-home-chrome" },
  ]);
  const resolved = await resolveAppMapTestForTargetProfile({
    map: grokWeb(test),
    test,
    targetProfileId: "android",
    readAppMap: async (id) => (id === "grok-android" ? android : null),
  });
  assert.equal(resolved.map.id, "grok-android");
  assert.equal(resolved.test.id, "test-grok-android-home-chrome");
  assert.equal(resolved.runtimeTargetProfile?.id, androidProfile().id);
  assert.deepEqual(resolved.nativeCompanion?.requestedFrom, {
    appMapId: "grok-web",
    testId: "test-grok-web-signed-in-home",
  });
  assert.doesNotThrow(() =>
    assertRecordedCompanionForRun({
      testId: test.id,
      targetProfileId: "android",
      nativeCompanion: resolved.nativeCompanion,
    }),
  );
  assert.deepEqual(
    companionExecutionTarget({
      requested: { kind: "browser", platform: "browser", targetId: "grok-com" },
      profile: resolved.runtimeTargetProfile,
      nativeCompanion: resolved.nativeCompanion,
    }),
    { kind: "device", platform: "android", targetId: androidProfile().targetId },
  );
});

test("ios and android aliases compile linked companion Tests, not disabled Web steps", async () => {
  const android = destEndMap({
    id: "grok-android",
    profile: androidProfile(),
    testId: "test-grok-android-home-chrome",
    originApplication: "ai.x.grok",
    label: "Ask Grok",
  });
  const ios = destEndMap({
    id: "grok-ios",
    profile: iosProfile(),
    testId: "test-grok-ios-home-chrome",
    originApplication: "ai.x.GrokApp",
    label: "Ask Anything",
  });
  const test = webHomeTest([
    { platform: "android", appMapId: "grok-android", testId: "test-grok-android-home-chrome" },
    { platform: "ios", appMapId: "grok-ios", testId: "test-grok-ios-home-chrome" },
  ]);
  const maps = { "grok-android": android, "grok-ios": ios };
  const web = grokWeb(test);
  const readAppMap = async (id: string) => maps[id as keyof typeof maps] ?? null;

  const androidCompile = await compileAppMapTestForTargetProfile({
    map: web,
    test,
    targetProfileId: "android",
    readAppMap,
  });
  assert.equal(androidCompile.plan.appMapId, "grok-android");
  assert.equal(androidCompile.plan.test.id, "test-grok-android-home-chrome");
  assert.ok((androidCompile.plan.performance.executableOperations ?? 0) >= 1);
  assert.equal(androidCompile.plan.omittedSteps?.length ?? 0, 0);
  assert.deepEqual(androidCompile.nativeCompanion, {
    platform: "android",
    appMapId: "grok-android",
    testId: "test-grok-android-home-chrome",
    requestedFrom: { appMapId: "grok-web", testId: "test-grok-web-signed-in-home" },
  });
  assert.equal(androidCompile.plan.runtimeTargetProfile?.id, androidProfile().id);

  const iosCompile = await compileAppMapTestForTargetProfile({
    map: web,
    test,
    targetProfileId: "ios",
    readAppMap,
  });
  assert.equal(iosCompile.plan.appMapId, "grok-ios");
  assert.equal(iosCompile.plan.test.id, "test-grok-ios-home-chrome");
  assert.ok((iosCompile.plan.performance.executableOperations ?? 0) >= 1);
  assert.equal(iosCompile.nativeCompanion?.platform, "ios");
  assert.equal(iosCompile.plan.runtimeTargetProfile?.id, iosProfile().id);

  const bySavedId = await compileAppMapTestForTargetProfile({
    map: web,
    test,
    targetProfileId: iosProfile().id,
    readAppMap,
  });
  assert.equal(bySavedId.plan.appMapId, "grok-ios");
  assert.equal(bySavedId.nativeCompanion?.testId, "test-grok-ios-home-chrome");
});

test("Search-like Tests without an iOS companion stay unrecorded, not invented routes", async () => {
  const android = destEndMap({
    id: "grok-android",
    profile: androidProfile(),
    testId: "test-grok-android-search",
    originApplication: "ai.x.grok",
    label: "Search",
  });
  const test = webHomeTest([
    { platform: "android", appMapId: "grok-android", testId: "test-grok-android-search" },
  ]);
  test.id = "test-grok-web-signed-in-search";
  const compiled = await compileAppMapTestForTargetProfile({
    map: grokWeb(test),
    test,
    targetProfileId: "ios",
    readAppMap: async (id) => (id === "grok-android" ? android : null),
  });
  assert.equal(compiled.plan.appMapId, "grok-web");
  assert.ok((compiled.plan.omittedSteps?.length ?? 0) >= 1);
  assert.match(compiled.plan.omittedSteps?.[0]?.reason ?? "", /Grok Settings/u);
  assert.equal(compiled.plan.performance.executableOperations, 0);
  assert.equal(compiled.nativeCompanion, undefined);
  assert.throws(
    () =>
      assertRecordedCompanionForRun({
        testId: test.id,
        targetProfileId: "ios",
        nativeCompanion: compiled.nativeCompanion,
      }),
    (error: unknown) =>
      error instanceof AppMapTargetProfileError &&
      error.code === "COMPANION_TEST_MISSING" &&
      /Grok Settings/u.test(error.message),
  );
});

test("unknown targetProfileId still fail-closes instead of inventing a native route", async () => {
  const test = webHomeTest([
    { platform: "android", appMapId: "grok-android", testId: "test-grok-android-home-chrome" },
  ]);
  await assert.rejects(
    () =>
      compileAppMapTestForTargetProfile({
        map: grokWeb(test),
        test,
        targetProfileId: "missing-profile",
        readAppMap: async () => null,
      }),
    (error: unknown) =>
      error instanceof AppMapTargetProfileError &&
      error.code === "TARGET_PROFILE_NOT_SAVED" &&
      /missing-profile/u.test(error.message),
  );
});

test("saved browser profile still compiles this App Map", async () => {
  const test = webHomeTest(undefined);
  const compiled = await compileAppMapTestForTargetProfile({
    map: grokWeb(test),
    test,
    targetProfileId: "browser:grok-com",
    readAppMap: async () => null,
  });
  assert.equal(compiled.plan.appMapId, "grok-web");
  assert.equal(compiled.nativeCompanion, undefined);
  assert.ok((compiled.plan.performance.executableOperations ?? 0) >= 1);
});

test("grok-web table companions compile even when the saved Test omitted the field", async () => {
  const android = destEndMap({
    id: "grok-android",
    profile: androidProfile(),
    testId: "test-grok-android-home-chrome",
    originApplication: "ai.x.grok",
    label: "Ask Grok",
  });
  const ios = destEndMap({
    id: "grok-ios",
    profile: iosProfile(),
    testId: "test-grok-ios-home-chrome",
    originApplication: "ai.x.GrokApp",
    label: "Ask Anything",
  });
  const test = webHomeTest(undefined);
  const compiled = await compileAppMapTestForTargetProfile({
    map: grokWeb(test),
    test,
    targetProfileId: "ios",
    readAppMap: async (id) => (id === "grok-ios" ? ios : id === "grok-android" ? android : null),
  });
  assert.equal(compiled.plan.appMapId, "grok-ios");
  assert.equal(compiled.nativeCompanion?.testId, "test-grok-ios-home-chrome");
  assert.equal(compiled.plan.omittedSteps?.length ?? 0, 0);
});
