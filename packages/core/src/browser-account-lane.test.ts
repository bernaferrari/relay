import assert from "node:assert/strict";
import test from "node:test";
import {
  browserAccountSchedulingKey,
  controlTargetIdForBrowserLane,
  jobSchedulingTargetId,
  managedBrowserTargetIdFromSchedulingKey,
  unsignedBrowserLaneId,
} from "./browser-account-lane.js";
import {
  EXECUTION_TARGET_REF_VERSION,
  LOCAL_AGENT_DEVICE_PROVIDER_KEY,
  LOCAL_BROWSER_PROVIDER_KEY,
} from "@relay/protocol";

const localBrowser = {
  schemaVersion: EXECUTION_TARGET_REF_VERSION,
  kind: "local-browser" as const,
  platform: "browser" as const,
  provider: { key: LOCAL_BROWSER_PROVIDER_KEY, scope: "local" as const },
  targetId: "grok-web",
  identity: { kind: "browser-target" as const, value: "grok-web" },
};

const localPhone = {
  schemaVersion: EXECUTION_TARGET_REF_VERSION,
  kind: "local-device" as const,
  platform: "android" as const,
  provider: { key: LOCAL_AGENT_DEVICE_PROVIDER_KEY, scope: "local" as const },
  targetId: "emulator-5554",
  identity: { kind: "device-serial" as const, value: "emulator-5554" },
};

test("browser account lanes keep fixtures independent and signed-out distinct", () => {
  assert.equal(browserAccountSchedulingKey("grok-web", "authfx:a:1"), "grok-web#authfx:a:1");
  assert.equal(browserAccountSchedulingKey("grok-web"), "grok-web#signed-out");
  assert.notEqual(
    browserAccountSchedulingKey("grok-web", "fx-a"),
    browserAccountSchedulingKey("grok-web", "fx-b"),
  );
});

test("unsigned Lanes are distinct scheduler identities without a fixture", () => {
  assert.equal(unsignedBrowserLaneId({ laneId: "grok-daily" }), "grok-daily");
  assert.equal(
    unsignedBrowserLaneId({
      laneId: "grok-daily",
      authenticationFixtureId: "authfx:a:1",
    }),
    undefined,
  );
  assert.equal(unsignedBrowserLaneId({ laneId: "grok-lab", accountKind: "fixture" }), undefined);
  assert.equal(
    browserAccountSchedulingKey("grok-com", undefined, "grok-daily"),
    "grok-com#signed-out:grok-daily",
  );
  assert.notEqual(
    browserAccountSchedulingKey("grok-com", undefined, "grok-daily"),
    browserAccountSchedulingKey("grok-com", undefined, "grok-daily-b"),
  );
  assert.equal(
    managedBrowserTargetIdFromSchedulingKey("grok-com#signed-out:grok-daily-b"),
    "grok-com",
  );
  assert.equal(
    jobSchedulingTargetId({
      executionTarget: localBrowser,
      unsignedLaneId: "grok-daily-b",
    }),
    "grok-web#signed-out:grok-daily-b",
  );
});

test("account-lane keys recover the managed browser for control and observation", () => {
  assert.equal(
    managedBrowserTargetIdFromSchedulingKey("grok-com#authfx:7189423f-193e-45ed-b674-154505cc5107:1"),
    "grok-com",
  );
  assert.equal(managedBrowserTargetIdFromSchedulingKey("grok-com#signed-out"), "grok-com");
  assert.equal(managedBrowserTargetIdFromSchedulingKey("grok-com"), undefined);
  assert.equal(controlTargetIdForBrowserLane("grok-com#signed-out"), "grok-com");
  assert.equal(controlTargetIdForBrowserLane("emulator-5554"), "emulator-5554");
});

test("fixture-keyed grok-com lanes stay distinct from the bare target and from each other", () => {
  assert.equal(
    browserAccountSchedulingKey("grok-com", "authfx:a:1"),
    "grok-com#authfx:a:1",
  );
  assert.equal(browserAccountSchedulingKey("grok-com"), "grok-com#signed-out");
  assert.notEqual(
    browserAccountSchedulingKey("grok-com", "authfx:a:1"),
    browserAccountSchedulingKey("grok-com", "authfx:b:1"),
  );
});

test("job scheduling identity uses the fixture for browsers and the serial for devices", () => {
  assert.equal(
    jobSchedulingTargetId({
      executionTarget: localBrowser,
      browserCaseProfile: { authenticationFixtureId: "authfx:member:2" },
    }),
    "grok-web#authfx:member:2",
  );
  assert.equal(jobSchedulingTargetId({ executionTarget: localBrowser }), "grok-web#signed-out");
  assert.equal(jobSchedulingTargetId({ executionTarget: localPhone }), "emulator-5554");
});
