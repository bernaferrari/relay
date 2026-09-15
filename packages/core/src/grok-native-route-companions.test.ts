import assert from "node:assert/strict";
import test from "node:test";
import { applyScenarioTestStepEdits } from "./app-map.js";
import { isUnrecordedRuntimePlatform } from "./app-map-test-route-variants.js";
import {
  GROK_WEB_NATIVE_ROUTE_COMPANIONS,
  grokWebNativeRouteCompanions,
} from "./grok-native-route-companions.js";
import { assertScenarioTest } from "./app-map/test-intent-validation.js";
import type { AppMapScenarioTest } from "@relay/protocol";

const at = 1;

function grokWebTest(id: string): AppMapScenarioTest {
  return {
    id,
    organizationId: "local",
    projectId: "default",
    appMapId: "grok-web",
    createdAt: at,
    updatedAt: at,
    name: id,
    kind: "scenario",
    intentSchemaVersion: 1,
    originApplication: "https://grok.com",
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

test("signed-in grok.com journeys link the same-intent native Tests", () => {
  assert.equal(Object.keys(GROK_WEB_NATIVE_ROUTE_COMPANIONS).length, 10);
  for (const [testId, companions] of Object.entries(GROK_WEB_NATIVE_ROUTE_COMPANIONS)) {
    assert.ok(companions.length === 1 || companions.length === 2);
    assert.equal(companions[0]?.platform, "android");
    assert.equal(companions[0]?.appMapId, "grok-android");
    if (
      testId === "test-grok-web-signed-in-search" ||
      testId === "test-grok-web-signed-in-imagine"
    ) {
      assert.equal(companions.length, 1);
    } else {
      assert.equal(companions.length, 2);
      assert.equal(companions[1]?.platform, "ios");
      assert.equal(companions[1]?.appMapId, "grok-ios");
    }
    assert.deepEqual(grokWebNativeRouteCompanions(testId), companions);
    const scenario = grokWebTest(testId);
    scenario.nativeRouteCompanions = [...companions];
    assertScenarioTest(scenario, testId);
  }
});

test("logged-out grok.com Tests, Settings Language, and iOS YAML stay unrecorded", () => {
  for (const testId of [
    "test-grok-web-imagine",
    "test-grok-web-attach",
    "test-grok-web-signed-in-model",
    "test-grok-web-signed-in-settings-language",
    "switch-language-grok-ios",
    "test-grok-web-weekly",
  ]) {
    assert.equal(grokWebNativeRouteCompanions(testId), undefined);
  }
});

test("web Search does not bind grok-ios Conversations", () => {
  const companions = grokWebNativeRouteCompanions("test-grok-web-signed-in-search");
  assert.equal(companions?.length, 1);
  assert.equal(companions?.[0]?.platform, "android");
  assert.equal(
    companions?.some((item) => item.platform === "ios" || item.testId.includes("conversations")),
    false,
  );
});

test("web Imagine does not bind grok-ios Imagine while the tab is Unbound", () => {
  const companions = grokWebNativeRouteCompanions("test-grok-web-signed-in-imagine");
  assert.equal(companions?.length, 1);
  assert.equal(companions?.[0]?.platform, "android");
  assert.equal(companions?.[0]?.testId, "test-grok-android-imagine");
  assert.equal(
    companions?.some((item) => item.platform === "ios" || item.testId.includes("ios-imagine")),
    false,
  );
});

test("companions leave Android and iOS unrecorded on this map", () => {
  const scenario = grokWebTest("test-grok-web-signed-in-home");
  scenario.nativeRouteCompanions = [...grokWebNativeRouteCompanions(scenario.id)!];
  const map = { screens: {}, screenVariants: {}, connections: {} };
  assert.equal(isUnrecordedRuntimePlatform(map, scenario, "android"), true);
  assert.equal(isUnrecordedRuntimePlatform(map, scenario, "ios"), true);
  assert.equal(isUnrecordedRuntimePlatform(map, scenario, "browser"), false);
});

test("nativeRouteCompanions cannot join a Test on the same App Map", () => {
  const scenario = grokWebTest("test-grok-web-signed-in-home");
  scenario.nativeRouteCompanions = [
    { platform: "android", appMapId: "grok-web", testId: "test-grok-web-signed-in-sidebar" },
  ];
  assert.throws(() => assertScenarioTest(scenario, "test"), /different App Map/u);
});

test("test.patch persists and removes nativeRouteCompanions", () => {
  const source = grokWebTest("test-grok-web-signed-in-home");
  const companions = grokWebNativeRouteCompanions(source.id)!;
  const patched = applyScenarioTestStepEdits(source, [
    { kind: "test.patch", patch: { nativeRouteCompanions: [...companions] } },
  ]);
  assert.deepEqual(patched.nativeRouteCompanions, companions);
  const cleared = applyScenarioTestStepEdits(patched, [
    { kind: "test.patch", patch: { nativeRouteCompanions: null } },
  ]);
  assert.equal("nativeRouteCompanions" in cleared, false);
});
