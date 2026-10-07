import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCompiledRuntimeTargetProfile, TargetProfile } from "@relay/protocol";
import { compileBrowserEnvironment } from "@relay/protocol";
import { appMapRuntimeTargetProfileFromSaved, sameAppMapRuntimeTargetProfile } from "@relay/core";
import { queuedAppMapTestTargetProfile } from "./app-map-test-target-profile.js";
import { HttpError } from "./http.js";

const frozen: AppMapCompiledRuntimeTargetProfile = {
  id: "android:pixel",
  targetId: "emulator-5554",
  platform: "android",
  model: "Emulator",
  androidAvdName: "Pixel_9_API_36",
  osVersion: "16",
  capabilities: ["snapshot", "screenshot", "tap"],
};

function observed(androidAvdName: string): TargetProfile {
  return {
    id: "observed:pixel",
    targetId: "emulator-5554",
    source: "device",
    platform: "android",
    name: "Pixel 9",
    model: "Emulator",
    androidAvdName,
    osVersion: "16",
    capabilities: ["snapshot", "screenshot", "tap"],
    observedAt: 1,
  };
}

test("queued Android emulator Tests require the exact frozen AVD behind a reusable serial", () => {
  assert.throws(
    () =>
      queuedAppMapTestTargetProfile({
        runtimeTargetProfile: frozen,
        observedTargetProfile: observed("Tablet_API_36"),
        target: { kind: "device", targetId: "emulator-5554", platform: "android" },
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.body?.code === "TARGET_PROFILE_TARGET_MISMATCH",
  );

  const accepted = queuedAppMapTestTargetProfile({
    runtimeTargetProfile: frozen,
    observedTargetProfile: observed("Pixel_9_API_36"),
    target: { kind: "device", targetId: "emulator-5554", platform: "android" },
  });
  assert.equal(accepted?.androidAvdName, "Pixel_9_API_36");
  assert.throws(
    () =>
      queuedAppMapTestTargetProfile({
        runtimeTargetProfile: frozen,
        observedTargetProfile: { ...observed("Pixel_9_API_36"), osVersion: "17" },
        target: { kind: "device", targetId: "emulator-5554", platform: "android" },
      }),
    (error: unknown) =>
      error instanceof HttpError && error.body?.code === "TARGET_PROFILE_TARGET_MISMATCH",
  );
});

test("queued Android emulator Tests carry observed AVD identity for legacy saved profiles", () => {
  const legacy = { ...frozen };
  delete legacy.androidAvdName;
  const accepted = queuedAppMapTestTargetProfile({
    runtimeTargetProfile: legacy,
    observedTargetProfile: observed("Pixel_9_API_36"),
    target: { kind: "device", targetId: "emulator-5554", platform: "android" },
  });
  assert.equal(accepted?.androidAvdName, undefined);
  assert.equal(accepted?.observedAndroidAvdName, "Pixel_9_API_36");
  assert.ok(accepted);
  assert.ok(
    sameAppMapRuntimeTargetProfile(appMapRuntimeTargetProfileFromSaved(accepted), legacy),
    "collector hints must not change the queue admission identity",
  );
});

test("a generic native model label is not an exact hardware identity and known geometry still guards admission", () => {
  const saved = { ...frozen, model: "device", viewport: { width: 1080, height: 2340 } };
  const actual = {
    ...observed("Pixel_9_API_36"),
    model: "SM-S931B",
    viewport: { width: 1080, height: 2340 },
  };
  assert.ok(
    queuedAppMapTestTargetProfile({
      runtimeTargetProfile: saved,
      observedTargetProfile: actual,
      target: { kind: "device", targetId: saved.targetId, platform: "android" },
    }),
  );
  assert.throws(
    () =>
      queuedAppMapTestTargetProfile({
        runtimeTargetProfile: saved,
        observedTargetProfile: { ...actual, viewport: { width: 2340, height: 1080 } },
        target: { kind: "device", targetId: saved.targetId, platform: "android" },
      }),
    (error: unknown) =>
      error instanceof HttpError && error.body?.code === "TARGET_PROFILE_TARGET_MISMATCH",
  );
});

test("queued browser Tests overlay an account fixture onto an unsigned managed target", () => {
  const unsigned = compileBrowserEnvironment({
    engine: "chromium",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "UTC",
  });
  const signedIn = compileBrowserEnvironment({
    ...unsigned,
    authenticationFixtureId: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
  });
  const runtimeTargetProfile = {
    id: "browser:grok-com-1280x800-339a5a430a41",
    targetId: "grok-com",
    platform: "browser" as const,
    viewport: signedIn.viewport,
    browserCaseProfile: signedIn,
  };
  const observedTargetProfile: TargetProfile = {
    id: "browser:grok-com",
    targetId: "grok-com",
    source: "browser",
    platform: "browser",
    name: "grok.com",
    viewport: unsigned.viewport,
    browserCaseProfile: unsigned,
    capabilities: ["screenshot", "snapshot"],
    observedAt: 1,
  };
  const queued = queuedAppMapTestTargetProfile({
    runtimeTargetProfile,
    observedTargetProfile,
    target: { kind: "browser", targetId: "grok-com", platform: "browser" },
  });
  assert.equal(
    queued?.browserCaseProfile?.authenticationFixtureId,
    "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
  );
  assert.throws(
    () =>
      queuedAppMapTestTargetProfile({
        runtimeTargetProfile,
        observedTargetProfile: {
          ...observedTargetProfile,
          browserCaseProfile: compileBrowserEnvironment({
            ...unsigned,
            engine: "webkit",
          }),
        },
        target: { kind: "browser", targetId: "grok-com", platform: "browser" },
      }),
    (error: unknown) =>
      error instanceof HttpError && error.body?.code === "TARGET_PROFILE_TARGET_MISMATCH",
  );
});
