import assert from "node:assert/strict";
import test from "node:test";
import { AppMapTargetProfileError } from "./app-map-native-companion-compile.js";
import {
  assertRecordedCompanionForRun,
  companionExecutionTarget,
} from "./app-map-native-companion-run.js";

const androidProfile = {
  id: "device:RQCY104BG8X-1080x2340",
  targetId: "RQCY104BG8X",
  platform: "android" as const,
};
const iosProfile = {
  id: "device:db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
  targetId: "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
  platform: "ios" as const,
};

test("companion run switches a grok-web browser target onto the Android device profile", () => {
  assert.deepEqual(
    companionExecutionTarget({
      requested: { kind: "browser", platform: "browser", targetId: "grok-com" },
      profile: androidProfile,
      nativeCompanion: {
        platform: "android",
        appMapId: "grok-android",
        testId: "test-grok-android-home-chrome",
        requestedFrom: { appMapId: "grok-web", testId: "test-grok-web-signed-in-home" },
      },
    }),
    { kind: "device", platform: "android", targetId: "RQCY104BG8X" },
  );
});

test("companion run keeps a matching explicit Android serial", () => {
  assert.deepEqual(
    companionExecutionTarget({
      requested: { kind: "device", platform: "android", targetId: "RQCY104BG8X" },
      profile: androidProfile,
      nativeCompanion: {
        platform: "android",
        appMapId: "grok-android",
        testId: "test-grok-android-home-chrome",
        requestedFrom: { appMapId: "grok-web", testId: "test-grok-web-signed-in-home" },
      },
    }),
    { kind: "device", platform: "android", targetId: "RQCY104BG8X" },
  );
});

test("companion run replaces a mismatched iPad target with the iOS companion device", () => {
  assert.deepEqual(
    companionExecutionTarget({
      requested: {
        kind: "device",
        platform: "ios",
        targetId: "other-ipad",
      },
      profile: iosProfile,
      nativeCompanion: {
        platform: "ios",
        appMapId: "grok-ios",
        testId: "test-grok-ios-home-chrome",
        requestedFrom: { appMapId: "grok-web", testId: "test-grok-web-signed-in-home" },
      },
    }),
    {
      kind: "device",
      platform: "ios",
      targetId: "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
    },
  );
});

test("local Web runs keep the requested browser target", () => {
  assert.deepEqual(
    companionExecutionTarget({
      requested: { kind: "browser", platform: "browser", targetId: "grok-com" },
      profile: { id: "browser:grok-com", targetId: "grok-com", platform: "browser" },
    }),
    { kind: "browser", platform: "browser", targetId: "grok-com" },
  );
});

test("Search × iOS run fail-closes instead of inventing a companion", () => {
  assert.throws(
    () =>
      assertRecordedCompanionForRun({
        testId: "test-grok-web-signed-in-search",
        targetProfileId: "ios",
      }),
    (error: unknown) =>
      error instanceof AppMapTargetProfileError &&
      error.code === "COMPANION_TEST_MISSING" &&
      /Grok Settings/u.test(error.message) &&
      !/unknown profile|not saved in this App Map/u.test(error.message),
  );
});

test("home × android run is allowed when the companion was resolved", () => {
  assert.doesNotThrow(() =>
    assertRecordedCompanionForRun({
      testId: "test-grok-web-signed-in-home",
      targetProfileId: "android",
      nativeCompanion: {
        platform: "android",
        appMapId: "grok-android",
        testId: "test-grok-android-home-chrome",
        requestedFrom: { appMapId: "grok-web", testId: "test-grok-web-signed-in-home" },
      },
    }),
  );
});
