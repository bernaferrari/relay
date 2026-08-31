import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCompiledRuntimeTargetProfile, TargetProfile } from "@relay/protocol";
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
