import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { base, selectedPlatform } from "./device.js";
import { runWithTargetContext, targetIdentity } from "./target-context.js";

test("target contexts remain isolated across interleaved operations", async () => {
  const [android, ios, browser] = await Promise.all([
    runWithTargetContext({ kind: "device", platform: "android", serial: "android-a" }, async () => {
      await delay(15);
      return { base: base(), platform: selectedPlatform(), identity: targetIdentity() };
    }),
    runWithTargetContext({ kind: "device", platform: "ios", serial: "ios-b" }, async () => {
      await delay(5);
      return { base: base(), platform: selectedPlatform(), identity: targetIdentity() };
    }),
    runWithTargetContext(
      { kind: "browser", platform: "browser", targetId: "browser-c" },
      async () => {
        await delay(10);
        return { base: base(), platform: selectedPlatform(), identity: targetIdentity() };
      },
    ),
  ]);

  assert.deepEqual(android, {
    base: { platform: "android", serial: "android-a", device: "android-a" },
    platform: "android",
    identity: "android-a",
  });
  assert.deepEqual(ios, {
    base: { platform: "ios", udid: "ios-b" },
    platform: "ios",
    identity: "ios-b",
  });
  assert.deepEqual(browser, {
    base: { platform: "android" },
    platform: "android",
    identity: "browser-c",
  });
});
