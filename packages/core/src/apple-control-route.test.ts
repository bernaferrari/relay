import assert from "node:assert/strict";
import test from "node:test";
import { resolveAppleControlRoute } from "./apple-control-route.js";

test("Apple control route sends UUID serials to the simulator SDK", () => {
  assert.deepEqual(
    resolveAppleControlRoute({
      kind: "device",
      platform: "ios",
      serial: "D2625C92-964D-4326-8C83-0A4B9B06431D",
    }),
    { kind: "simulator-sdk", udid: "D2625C92-964D-4326-8C83-0A4B9B06431D" },
  );
});

test("Apple control route sends physical serials to the runner transport", () => {
  assert.deepEqual(
    resolveAppleControlRoute({
      kind: "device",
      platform: "ios",
      serial: "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5",
    }),
    { kind: "physical-runner", udid: "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5" },
  );
});

test("Apple control route is undefined for non-iOS targets", () => {
  assert.equal(
    resolveAppleControlRoute({ kind: "device", platform: "android", serial: "emulator-5554" }),
    undefined,
  );
  assert.equal(
    resolveAppleControlRoute({ kind: "browser", platform: "browser", targetId: "lane" }),
    undefined,
  );
});
