import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest, TargetProfile } from "@relay/protocol";
import {
  ROUTE_VARIANT_CONFIGURATION_ASSUMPTION,
  captureReviewSlotId,
  routeVariantQuotesShareATestAcrossPlatforms,
} from "@relay/protocol";
import { compileAppMapTest } from "./map-work.js";
import { preflightAppMapCombine } from "./app-map-combine-preflight.js";
import { parseCanonicalAppMapTestPlan } from "./app-map-test-execution-intent.js";

const at = 1;

function androidProfile(): TargetProfile {
  return {
    id: "device:RQCY104BG8X-1080x2340",
    targetId: "RQCY104BG8X",
    source: "device",
    platform: "android",
    name: "Galaxy",
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
  capture?: boolean;
  companions?: AppMapScenarioTest["nativeRouteCompanions"];
}): AppMap {
  const scope = { organizationId: "org", projectId: "project", appMapId: input.id };
  const variantId = `${input.id}-home`;
  const test: AppMapScenarioTest = {
    ...scope,
    id: input.testId,
    name: input.label,
    kind: "scenario",
    intentSchemaVersion: 1,
    originApplication: input.originApplication,
    ...(input.companions ? { nativeRouteCompanions: input.companions } : {}),
    steps: [
      {
        id: "step-action",
        kind: "instruction",
        intent: input.label,
        ...(input.capture ? { capture: true } : {}),
        binding: { status: "resolved", kind: "connections", connectionIds: ["chrome"] },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
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
    tests: { [input.testId]: test },
  });
}

test("P0.4 compile JSON lists Android vs iOS vs web Home chrome as separate configurations", () => {
  const android = destEndMap({
    id: "grok-android",
    profile: androidProfile(),
    testId: "test-grok-android-home-chrome",
    originApplication: "ai.x.grok",
    label: "Home chrome",
    capture: true,
  });
  const ios = destEndMap({
    id: "grok-ios",
    profile: iosProfile(),
    testId: "test-grok-ios-home-chrome",
    originApplication: "ai.x.GrokApp",
    label: "Home chrome",
    capture: true,
  });
  const web = destEndMap({
    id: "grok-web",
    profile: browserProfile(),
    testId: "test-grok-web-signed-in-home",
    originApplication: "https://grok.com",
    label: "Home chrome",
    capture: true,
    companions: [
      {
        platform: "android",
        appMapId: "grok-android",
        testId: "test-grok-android-home-chrome",
      },
      { platform: "ios", appMapId: "grok-ios", testId: "test-grok-ios-home-chrome" },
    ],
  });

  const androidPlan = compileAppMapTest(
    android,
    android.tests["test-grok-android-home-chrome"]!,
  ).plan;
  const iosPlan = compileAppMapTest(ios, ios.tests["test-grok-ios-home-chrome"]!).plan;
  const webPlan = compileAppMapTest(web, web.tests["test-grok-web-signed-in-home"]!).plan;

  assert.deepEqual(androidPlan.routeVariantConfigurations, [
    {
      platform: "android",
      configuration: { app: "android" },
      testId: "test-grok-android-home-chrome",
      role: "compiled",
    },
  ]);
  assert.deepEqual(iosPlan.routeVariantConfigurations, [
    {
      platform: "ios",
      configuration: { app: "ai.x.GrokApp" },
      testId: "test-grok-ios-home-chrome",
      role: "compiled",
    },
  ]);
  assert.deepEqual(
    webPlan.routeVariantConfigurations?.map((quote) => [quote.platform, quote.testId, quote.role]),
    [
      ["web", "test-grok-web-signed-in-home", "compiled"],
      ["android", "test-grok-android-home-chrome", "companion"],
      ["ios", "test-grok-ios-home-chrome", "companion"],
    ],
  );
  assert.equal(
    routeVariantQuotesShareATestAcrossPlatforms(webPlan.routeVariantConfigurations ?? []),
    false,
  );
  assert.equal(androidPlan.plannedSlots?.[0]?.configuration?.app, "android");
  assert.equal(iosPlan.plannedSlots?.[0]?.configuration?.app, "ai.x.GrokApp");
  assert.equal(webPlan.plannedSlots?.[0]?.configuration?.browser, "grok-com");
  assert.notEqual(
    captureReviewSlotId(androidPlan.plannedSlots![0]!),
    captureReviewSlotId(iosPlan.plannedSlots![0]!),
  );
  assert.notEqual(
    captureReviewSlotId(androidPlan.plannedSlots![0]!),
    captureReviewSlotId(webPlan.plannedSlots![0]!),
  );
  assert.equal(
    parseCanonicalAppMapTestPlan(androidPlan)?.routeVariantConfigurations?.[0]?.platform,
    "android",
  );
  assert.match(ROUTE_VARIANT_CONFIGURATION_ASSUMPTION, /separate configurations/u);
});

test("P0.4 Plan JSON does not treat a shared caption as one Test covering three platforms", async () => {
  const map = destEndMap({
    id: "grok-web",
    profile: browserProfile(),
    testId: "test-grok-web-signed-in-home",
    originApplication: "https://grok.com",
    label: "Home chrome",
    companions: [
      {
        platform: "android",
        appMapId: "grok-android",
        testId: "test-grok-android-home-chrome",
      },
      { platform: "ios", appMapId: "grok-ios", testId: "test-grok-ios-home-chrome" },
    ],
  });
  const language = {
    organizationId: "org",
    projectId: "project",
    appMapId: "grok-web",
    id: "language",
    name: "Language",
    kind: "language" as const,
    apply: { kind: "appLocale" as const, app: "ai.x.grok" },
    options: [{ id: "en", label: "English" }],
    restoreId: "en",
    createdAt: at,
    updatedAt: at,
  };
  const combine = {
    organizationId: "org",
    projectId: "project",
    appMapId: "grok-web",
    id: "home-chrome",
    name: "Home chrome",
    createdAt: at,
    updatedAt: at,
    variableIds: ["language"],
    testIds: ["test-grok-web-signed-in-home"],
    cellRuntimeProfiles: [
      {
        testId: "test-grok-web-signed-in-home",
        values: { language: "en" },
        targetProfileId: "browser:grok-com",
      },
    ],
  };
  map.variables = { language };
  map.combines = { "home-chrome": combine };
  const preflight = await preflightAppMapCombine(map, combine);
  assert.equal(preflight.ok, true, JSON.stringify(preflight.blockers));
  assert.deepEqual(
    preflight.routeVariantConfigurations?.map((quote) => [
      quote.platform,
      quote.testId,
      quote.role,
    ]),
    [
      ["web", "test-grok-web-signed-in-home", "compiled"],
      ["android", "test-grok-android-home-chrome", "companion"],
      ["ios", "test-grok-ios-home-chrome", "companion"],
    ],
  );
  assert.equal(new Set(preflight.routeVariantConfigurations?.map((quote) => quote.testId)).size, 3);
  assert.equal(preflight.tests.length, 1);
  assert.equal(preflight.tests[0]?.name, "Home chrome");
});
