import assert from "node:assert/strict";
import test from "node:test";
import { androidMobileDataAdbArgs, setAndroidMobileData } from "./android-mobile-data.js";
import { runWithTargetContext } from "./target-context.js";

test("android mobile-data uses svc data argv", () => {
  assert.deepEqual(androidMobileDataAdbArgs("emulator-5554", "off"), [
    "-s",
    "emulator-5554",
    "shell",
    "svc",
    "data",
    "disable",
  ]);
  assert.deepEqual(androidMobileDataAdbArgs("pixel", "on"), [
    "-s",
    "pixel",
    "shell",
    "svc",
    "data",
    "enable",
  ]);
});

test("mobile-data fails closed off Android", async () => {
  await assert.rejects(
    () =>
      runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-com" }, () =>
        setAndroidMobileData("off"),
      ),
    /only supported on Android/u,
  );
  await assert.rejects(
    () =>
      runWithTargetContext({ kind: "device", platform: "ios", serial: "ipad-1" }, () =>
        setAndroidMobileData("on"),
      ),
    /only supported on Android/u,
  );
});
