import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeviceForTarget,
  getCloudDeviceProvider,
  setCloudDeviceProvider,
} from "./device-factory.js";
import {
  isCloudTarget,
  isDeviceTarget,
  runWithTargetContext,
  targetIdentity,
  type CloudTargetContext,
  type TargetContext,
} from "./target-context.js";

test("cloud TargetContext can be constructed and narrowed", () => {
  const cloud: TargetContext = {
    kind: "cloud",
    provider: "browserstack",
    sessionId: "sess-abc",
    platform: "android",
  };

  assert.equal(isCloudTarget(cloud), true);
  assert.equal(isDeviceTarget(cloud), false);
  if (!isCloudTarget(cloud)) throw new Error("expected cloud narrowing");
  const narrowed: CloudTargetContext = cloud;
  assert.equal(narrowed.provider, "browserstack");
  assert.equal(narrowed.sessionId, "sess-abc");
  assert.equal(targetIdentity(cloud), "sess-abc");
});

test("cloud TargetContext runs under AsyncLocalStorage", async () => {
  const identity = await runWithTargetContext(
    {
      kind: "cloud",
      provider: "sauce",
      sessionId: "cloud-42",
      platform: "ios",
    },
    async () => targetIdentity(),
  );
  assert.equal(identity, "cloud-42");
});

test("createDeviceForTarget stubs cloud until a provider is registered", () => {
  setCloudDeviceProvider(undefined);
  assert.equal(getCloudDeviceProvider(), undefined);
  assert.throws(
    () =>
      createDeviceForTarget({
        kind: "cloud",
        provider: "browserstack",
        sessionId: "sess-x",
        platform: "android",
      }),
    /not implemented yet/,
  );
});
