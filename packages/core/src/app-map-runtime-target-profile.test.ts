import assert from "node:assert/strict";
import test from "node:test";
import { compileBrowserEnvironment } from "@relay/protocol";
import {
  appMapRuntimeTargetProfileFromSaved,
  parseAppMapRuntimeTargetProfile,
  sameAppMapRuntimeTargetProfile,
} from "./app-map-runtime-target-profile.js";

const webkitPt = compileBrowserEnvironment({
  engine: "webkit",
  viewport: { width: 390, height: 844 },
  locale: "pt-BR",
  timezoneId: "America/Maceio",
  colorScheme: "dark",
  reducedMotion: "reduce",
  networkProfile: "wifi-slow",
  authenticationFixtureId: "member-session",
  featureFlagFixtureId: "checkout-v2",
  environmentRevision: "browser-env-9",
});

test("runtime target profiles retain the complete saved browser environment", () => {
  const frozen = appMapRuntimeTargetProfileFromSaved({
    id: "browser:checkout",
    targetId: "checkout",
    platform: "browser",
    browserCaseProfile: webkitPt,
  });
  assert.deepEqual(frozen, {
    id: "browser:checkout",
    targetId: "checkout",
    platform: "browser",
    viewport: { width: 390, height: 844 },
    browserCaseProfile: webkitPt,
  });
  assert.deepEqual(parseAppMapRuntimeTargetProfile(structuredClone(frozen)), frozen);
});

test("runtime profile equality covers every browser field while legacy profiles stay readable", () => {
  const selected = appMapRuntimeTargetProfileFromSaved({
    id: "browser:checkout",
    targetId: "checkout",
    platform: "browser",
    browserCaseProfile: webkitPt,
  });
  const changedLocale = appMapRuntimeTargetProfileFromSaved({
    ...selected,
    browserCaseProfile: { ...webkitPt, locale: "en-US" },
  });
  assert.equal(sameAppMapRuntimeTargetProfile(selected, changedLocale), false);
  assert.deepEqual(
    parseAppMapRuntimeTargetProfile({
      id: "browser:legacy",
      targetId: "legacy",
      platform: "browser",
      viewport: { width: 800, height: 600 },
    }),
    {
      id: "browser:legacy",
      targetId: "legacy",
      platform: "browser",
      viewport: { width: 800, height: 600 },
    },
  );
  assert.equal(
    parseAppMapRuntimeTargetProfile({
      ...selected,
      viewport: { width: 391, height: 844 },
    }),
    undefined,
  );
  assert.throws(
    () =>
      appMapRuntimeTargetProfileFromSaved({
        ...selected,
        viewport: { width: 1_280, height: 800 },
      }),
    /viewport conflicts/u,
  );
});
