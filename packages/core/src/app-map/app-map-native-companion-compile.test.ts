import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest, TargetProfile } from "@relay/protocol";
import {
  AppMapTargetProfileError,
  compileAppMapTestForTargetProfile,
  resolveAppMapTestForTargetProfile,
} from "./app-map-native-companion-compile.js";
import { registerNativeRouteCompanionResolver } from "./app-map-extension-policy.js";
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
    id: "browser:shop-com",
    targetId: "shop-com",
    source: "browser",
    platform: "browser",
    name: "Shop Example",
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
  const scope = { organizationId: "org", projectId: "project", appMapId: "shop-web" };
  return {
    ...scope,
    id: "test-shop-web-signed-in-home",
    name: "Open shop.example signed-in",
    kind: "scenario",
    intentSchemaVersion: 1,
    originApplication: "https://shop.example",
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

function shopWeb(test: AppMapScenarioTest): AppMap {
  const scope = { organizationId: "org", projectId: "project", appMapId: "shop-web" };
  const profile = browserProfile();
  return emptyMap("shop-web", {
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

test("android alias run resolves the companion Test and Galaxy profile, not an unknown shop-web profile", async () => {
  const android = destEndMap({
    id: "shop-android",
    profile: androidProfile(),
    testId: "test-shop-android-home-chrome",
    originApplication: "com.example.shop.android",
    label: "Ask Shop",
  });
  const test = webHomeTest([
    { platform: "android", appMapId: "shop-android", testId: "test-shop-android-home-chrome" },
  ]);
  const resolved = await resolveAppMapTestForTargetProfile({
    map: shopWeb(test),
    test,
    targetProfileId: "android",
    readAppMap: async (id) => (id === "shop-android" ? android : null),
  });
  assert.equal(resolved.map.id, "shop-android");
  assert.equal(resolved.test.id, "test-shop-android-home-chrome");
  assert.equal(resolved.runtimeTargetProfile?.id, androidProfile().id);
  assert.deepEqual(resolved.nativeCompanion?.requestedFrom, {
    appMapId: "shop-web",
    testId: "test-shop-web-signed-in-home",
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
      requested: { kind: "browser", platform: "browser", targetId: "shop-com" },
      profile: resolved.runtimeTargetProfile,
      nativeCompanion: resolved.nativeCompanion,
    }),
    { kind: "device", platform: "android", targetId: androidProfile().targetId },
  );
});

test("ios and android aliases compile linked companion Tests, not disabled Web steps", async () => {
  const android = destEndMap({
    id: "shop-android",
    profile: androidProfile(),
    testId: "test-shop-android-home-chrome",
    originApplication: "com.example.shop.android",
    label: "Ask Shop",
  });
  const ios = destEndMap({
    id: "shop-ios",
    profile: iosProfile(),
    testId: "test-shop-ios-home-chrome",
    originApplication: "com.example.shop.ios",
    label: "Ask Anything",
  });
  const test = webHomeTest([
    { platform: "android", appMapId: "shop-android", testId: "test-shop-android-home-chrome" },
    { platform: "ios", appMapId: "shop-ios", testId: "test-shop-ios-home-chrome" },
  ]);
  const maps = { "shop-android": android, "shop-ios": ios };
  const web = shopWeb(test);
  const readAppMap = async (id: string) => maps[id as keyof typeof maps] ?? null;

  const androidCompile = await compileAppMapTestForTargetProfile({
    map: web,
    test,
    targetProfileId: "android",
    readAppMap,
  });
  assert.equal(androidCompile.plan.appMapId, "shop-android");
  assert.equal(androidCompile.plan.test.id, "test-shop-android-home-chrome");
  assert.ok((androidCompile.plan.performance.executableOperations ?? 0) >= 1);
  assert.equal(androidCompile.plan.omittedSteps?.length ?? 0, 0);
  assert.deepEqual(androidCompile.nativeCompanion, {
    platform: "android",
    appMapId: "shop-android",
    testId: "test-shop-android-home-chrome",
    requestedFrom: { appMapId: "shop-web", testId: "test-shop-web-signed-in-home" },
  });
  assert.equal(androidCompile.plan.runtimeTargetProfile?.id, androidProfile().id);

  const iosCompile = await compileAppMapTestForTargetProfile({
    map: web,
    test,
    targetProfileId: "ios",
    readAppMap,
  });
  assert.equal(iosCompile.plan.appMapId, "shop-ios");
  assert.equal(iosCompile.plan.test.id, "test-shop-ios-home-chrome");
  assert.ok((iosCompile.plan.performance.executableOperations ?? 0) >= 1);
  assert.equal(iosCompile.nativeCompanion?.platform, "ios");
  assert.equal(iosCompile.plan.runtimeTargetProfile?.id, iosProfile().id);

  const bySavedId = await compileAppMapTestForTargetProfile({
    map: web,
    test,
    targetProfileId: iosProfile().id,
    readAppMap,
  });
  assert.equal(bySavedId.plan.appMapId, "shop-ios");
  assert.equal(bySavedId.nativeCompanion?.testId, "test-shop-ios-home-chrome");
});

test("Search-like Tests without an iOS companion stay unrecorded, not invented routes", async () => {
  const android = destEndMap({
    id: "shop-android",
    profile: androidProfile(),
    testId: "test-shop-android-search",
    originApplication: "com.example.shop.android",
    label: "Search",
  });
  const test = webHomeTest([
    { platform: "android", appMapId: "shop-android", testId: "test-shop-android-search" },
  ]);
  test.id = "test-shop-web-signed-in-search";
  const compiled = await compileAppMapTestForTargetProfile({
    map: shopWeb(test),
    test,
    targetProfileId: "ios",
    readAppMap: async (id) => (id === "shop-android" ? android : null),
  });
  assert.equal(compiled.plan.appMapId, "shop-web");
  assert.ok((compiled.plan.omittedSteps?.length ?? 0) >= 1);
  assert.match(compiled.plan.omittedSteps?.[0]?.reason ?? "", /unrecorded navigation/u);
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
      /unrecorded navigation/u.test(error.message),
  );
});

test("unknown targetProfileId still fail-closes instead of inventing a native route", async () => {
  const test = webHomeTest([
    { platform: "android", appMapId: "shop-android", testId: "test-shop-android-home-chrome" },
  ]);
  await assert.rejects(
    () =>
      compileAppMapTestForTargetProfile({
        map: shopWeb(test),
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
    map: shopWeb(test),
    test,
    targetProfileId: "browser:shop-com",
    readAppMap: async () => null,
  });
  assert.equal(compiled.plan.appMapId, "shop-web");
  assert.equal(compiled.nativeCompanion, undefined);
  assert.ok((compiled.plan.performance.executableOperations ?? 0) >= 1);
});

test("shop-web table companions compile even when the saved Test omitted the field", async () => {
  const android = destEndMap({
    id: "shop-android",
    profile: androidProfile(),
    testId: "test-shop-android-home-chrome",
    originApplication: "com.example.shop.android",
    label: "Ask Shop",
  });
  const ios = destEndMap({
    id: "shop-ios",
    profile: iosProfile(),
    testId: "test-shop-ios-home-chrome",
    originApplication: "com.example.shop.ios",
    label: "Ask Anything",
  });
  const test = webHomeTest(undefined);
  const unregister = registerNativeRouteCompanionResolver(({ map, test: candidate }) =>
    map.id === "shop-web" && candidate.id === test.id
      ? [
          {
            platform: "android",
            appMapId: "shop-android",
            testId: "test-shop-android-home-chrome",
          },
          { platform: "ios", appMapId: "shop-ios", testId: "test-shop-ios-home-chrome" },
        ]
      : undefined,
  );
  let compiled;
  try {
    compiled = await compileAppMapTestForTargetProfile({
      map: shopWeb(test),
      test,
      targetProfileId: "ios",
      readAppMap: async (id) => (id === "shop-ios" ? ios : id === "shop-android" ? android : null),
    });
  } finally {
    unregister();
  }
  assert.equal(compiled.plan.appMapId, "shop-ios");
  assert.equal(compiled.nativeCompanion?.testId, "test-shop-ios-home-chrome");
  assert.equal(compiled.plan.omittedSteps?.length ?? 0, 0);
});
