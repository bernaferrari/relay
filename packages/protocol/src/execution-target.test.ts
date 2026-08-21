import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExecutionTargetRef,
  executionTargetRefKey,
  isExecutionTargetRef,
  LOCAL_AGENT_DEVICE_PROVIDER_KEY,
  type ExecutionTargetRef,
} from "./execution-target.js";

function localDevice(): ExecutionTargetRef {
  return {
    schemaVersion: 1,
    kind: "local-device",
    provider: { key: LOCAL_AGENT_DEVICE_PROVIDER_KEY, scope: "local" },
    targetId: "00008120-0012345678901234",
    platform: "ios",
    identity: { kind: "device-serial", value: "00008120-0012345678901234" },
  };
}

test("execution target refs retain provider-scoped local identity", () => {
  const target = localDevice();
  assert.equal(isExecutionTargetRef(target), true);
  assert.doesNotThrow(() => assertExecutionTargetRef(target));
  assert.equal(
    executionTargetRefKey(target),
    JSON.stringify([
      LOCAL_AGENT_DEVICE_PROVIDER_KEY,
      "local-device",
      "ios",
      "device-serial",
      "00008120-0012345678901234",
    ]),
  );
});

test("execution target refs reject provider and identity mismatches", () => {
  const target = localDevice() as unknown as Record<string, unknown>;
  target.provider = { key: "browserstack", scope: "remote" };
  assert.equal(isExecutionTargetRef(target), false);
  assert.throws(() => assertExecutionTargetRef(target), /Invalid execution target reference/u);

  const missingIdentity = { ...localDevice(), identity: { kind: "device-serial", value: "" } };
  assert.equal(isExecutionTargetRef(missingIdentity), false);
});
