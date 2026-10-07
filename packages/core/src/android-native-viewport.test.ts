import assert from "node:assert/strict";
import test from "node:test";
import {
  observeAndroidNativeViewport,
  parseAndroidNativeViewport,
} from "./android-native-viewport.js";
import { nativeViewportForTarget } from "./native-target-profile.js";

// Observed passive metadata from SM-S931B, RQCY104BG8X, Android 16.
const frame =
  "Viewport INTERNAL: displayId=0, uniqueId=local:463094653, port=0, orientation=0, logicalFrame=[0, 0, 1080, 2340], physicalFrame=[0, 0, 1080, 2340], deviceSize=[1080, 2340], isActive=[1]";

test("repeated input-manager records describe one full active Android display", () => {
  assert.deepEqual(parseAndroidNativeViewport(`${frame}\n${frame}\n${frame}`), {
    width: 1080,
    height: 2340,
  });
});

test("missing, inactive, cropped, secondary or conflicting display metadata gives no geometry", () => {
  for (const text of [
    "",
    frame.replace("isActive=[1]", "isActive=[0]"),
    frame.replace("displayId=0", "displayId=1"),
    frame.replace("[0, 0, 1080", "[0, 20, 1080"),
    frame.replace("1080, 2340", "0, 2340"),
    `${frame}\n${frame.replace("1080, 2340", "2340, 1080").replace("orientation=0", "orientation=1")}`,
    `${frame}\n${frame.replace("orientation=0", "orientation=2")}`,
  ])
    assert.equal(parseAndroidNativeViewport(text), undefined, text);
});

test("cold-cache discovery collects full geometry using only bounded passive metadata", async () => {
  const target = { targetId: "cold-cache-profile-regression", platform: "android" } as const;
  assert.equal(nativeViewportForTarget(target), undefined);
  const execute: Parameters<typeof observeAndroidNativeViewport>[1] = async (args, options) => {
    assert.deepEqual(args, ["-s", target.targetId, "shell", "dumpsys", "input"]);
    assert.deepEqual(options, { timeout: 1500, maxBuffer: 1024 * 1024 });
    return { stdout: frame, stderr: "" };
  };
  assert.deepEqual(await observeAndroidNativeViewport(target.targetId, execute), {
    width: 1080,
    height: 2340,
  });
  assert.deepEqual(nativeViewportForTarget(target), { width: 1080, height: 2340 });
});
