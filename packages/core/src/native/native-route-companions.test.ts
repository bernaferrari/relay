import assert from "node:assert/strict";
import test from "node:test";
import { applyScenarioTestStepEdits } from "../app-map/app-map.js";
import { isUnrecordedRuntimePlatform } from "../app-map/app-map-test-route-variants.js";
import {
  registerNativeRouteCompanionResolver,
  resolveNativeRouteCompanions,
} from "../app-map/app-map-extension-policy.js";
import { assertScenarioTest } from "../app-map/test-intent-validation.js";
import type { AppMap, AppMapNativeRouteCompanion, AppMapScenarioTest } from "@relay/protocol";

const at = 1;
const SHOP_COMPANIONS: Record<string, readonly AppMapNativeRouteCompanion[]> = {
  "test-shop-web-home": [
    { platform: "android", appMapId: "shop-android", testId: "test-shop-android-home" },
    { platform: "ios", appMapId: "shop-ios", testId: "test-shop-ios-home" },
  ],
};

function withShopCompanions<T>(body: () => T): T {
  const unregister = registerNativeRouteCompanionResolver(({ map, test }) =>
    map.id === "shop-web" ? SHOP_COMPANIONS[test.id] : undefined,
  );
  try {
    return body();
  } finally {
    unregister();
  }
}

function shopWebTest(id: string): AppMapScenarioTest {
  return {
    id,
    organizationId: "local",
    projectId: "default",
    appMapId: "shop-web",
    createdAt: at,
    updatedAt: at,
    name: id,
    kind: "scenario",
    intentSchemaVersion: 1,
    originApplication: "https://shop.example",
    steps: [
      {
        id: "open",
        kind: "instruction",
        intent: "Open",
        binding: { status: "unresolved", reason: "Choose a binding" },
      },
    ],
  };
}

function shopWebMap(test: AppMapScenarioTest): AppMap {
  return {
    id: "shop-web",
    screens: {},
    screenVariants: {},
    connections: {},
    tests: { [test.id]: test },
  } as unknown as AppMap;
}

test("registered product policy supplies same-intent native companions", () => {
  withShopCompanions(() => {
    const scenario = shopWebTest("test-shop-web-home");
    const companions = resolveNativeRouteCompanions(shopWebMap(scenario), scenario);
    assert.deepEqual(companions, SHOP_COMPANIONS[scenario.id]);
    scenario.nativeRouteCompanions = [...companions];
    assertScenarioTest(scenario, scenario.id);
  });
});

test("unregistered tests and maps have no implicit native companions", () => {
  withShopCompanions(() => {
    const missing = shopWebTest("test-shop-web-missing");
    assert.deepEqual(resolveNativeRouteCompanions(shopWebMap(missing), missing), []);
    const otherMap = { ...shopWebMap(missing), id: "other-web" };
    const home = shopWebTest("test-shop-web-home");
    assert.deepEqual(resolveNativeRouteCompanions(otherMap, home), []);
  });
});

test("explicit test metadata wins over registered fallback policy", () => {
  withShopCompanions(() => {
    const scenario = shopWebTest("test-shop-web-home");
    const explicit = [
      { platform: "android" as const, appMapId: "shop-android", testId: "explicit-test" },
    ];
    scenario.nativeRouteCompanions = explicit;
    assert.deepEqual(resolveNativeRouteCompanions(shopWebMap(scenario), scenario), explicit);
  });
});

test("companions leave Android and iOS unrecorded on this map", () => {
  withShopCompanions(() => {
    const scenario = shopWebTest("test-shop-web-home");
    scenario.nativeRouteCompanions = [
      ...resolveNativeRouteCompanions(shopWebMap(scenario), scenario),
    ];
    const map = { screens: {}, screenVariants: {}, connections: {} };
    assert.equal(isUnrecordedRuntimePlatform(map, scenario, "android"), true);
    assert.equal(isUnrecordedRuntimePlatform(map, scenario, "ios"), true);
    assert.equal(isUnrecordedRuntimePlatform(map, scenario, "browser"), false);
  });
});

test("nativeRouteCompanions cannot join a Test on the same App Map", () => {
  const scenario = shopWebTest("test-shop-web-home");
  scenario.nativeRouteCompanions = [
    { platform: "android", appMapId: "shop-web", testId: "test-shop-web-sidebar" },
  ];
  assert.throws(() => assertScenarioTest(scenario, "test"), /different App Map/u);
});

test("test.patch persists and removes nativeRouteCompanions", () => {
  const source = shopWebTest("test-shop-web-home");
  const companions = SHOP_COMPANIONS[source.id]!;
  const patched = applyScenarioTestStepEdits(source, [
    { kind: "test.patch", patch: { nativeRouteCompanions: [...companions] } },
  ]);
  assert.deepEqual(patched.nativeRouteCompanions, companions);
  const cleared = applyScenarioTestStepEdits(patched, [
    { kind: "test.patch", patch: { nativeRouteCompanions: null } },
  ]);
  assert.equal("nativeRouteCompanions" in cleared, false);
});
