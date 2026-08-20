import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import type { DeviceInfo } from "./api-types.js";
import {
  appMapTestCompileInput,
  createAppMapTestRunIntent,
  sameAppMapTestRunIntent,
} from "./app-map-test-run-intent.js";

const appMap = { id: "map", revision: 7 } as AppMap;
const testDefinition = { id: "test", updatedAt: 9 } as AppMapScenarioTest;

test("freezes one exact Test/device/profile intent for compile and run", () => {
  const intent = createAppMapTestRunIntent({
    generation: 3,
    appMap,
    test: testDefinition,
    device: { serial: "ipad-1", platform: "ios" } as DeviceInfo,
    targetProfileId: " ipad-pt ",
    freshSurfaceScreenIds: ["voice"],
    startup: { mode: "verified-checkpoint", screenId: "settings" },
  });

  assert.deepEqual(intent, {
    generation: 3,
    appMapId: "map",
    testId: "test",
    testUpdatedAt: 9,
    expectedRevision: 7,
    target: { kind: "device", platform: "ios", targetId: "ipad-1" },
    targetProfileId: "ipad-pt",
    surfaceCapture: { forceRecaptureScreenIds: ["voice"] },
    startup: { mode: "verified-checkpoint", screenId: "settings" },
  });
  assert.deepEqual(appMapTestCompileInput(intent), {
    appMapId: "map",
    testId: "test",
    entryCheckpointScreenId: "settings",
    targetProfileId: "ipad-pt",
  });
  assert.equal(sameAppMapTestRunIntent(intent, { ...intent }), true);
  assert.equal(sameAppMapTestRunIntent(intent, { ...intent, generation: 4 }), false);
  assert.equal(sameAppMapTestRunIntent(intent, { ...intent, expectedRevision: 8 }), false);
});
