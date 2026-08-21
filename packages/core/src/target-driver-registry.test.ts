import assert from "node:assert/strict";
import test from "node:test";
import { createDeterministicProviderTestDriver } from "./deterministic-provider-test-driver.js";
import { createTargetDriver, TargetDriverCapabilityUnavailableError } from "./target-driver.js";
import {
  assertProviderTargetExecutionAdmission,
  recoverProviderTarget,
  TargetDriverRegistry,
} from "./target-driver-registry.js";

test("provider registry fails closed before queue admission and reports the missing capability", async () => {
  const fixture = createDeterministicProviderTestDriver();
  const target = fixture.target("provider-session-1");

  assert.throws(
    () => assertProviderTargetExecutionAdmission(target, new TargetDriverRegistry()),
    (error: unknown) =>
      error instanceof TargetDriverCapabilityUnavailableError &&
      error.code === "TARGET_DRIVER_CAPABILITY_UNAVAILABLE" &&
      error.capability === "control" &&
      error.reason === "not-configured",
  );

  const controlOnly = createTargetDriver({
    provider: target.provider,
    control: async (_target, operation) => await operation({} as never),
  });
  assert.throws(
    () => assertProviderTargetExecutionAdmission(target, new TargetDriverRegistry([controlOnly])),
    (error: unknown) =>
      error instanceof TargetDriverCapabilityUnavailableError &&
      error.capability === "capture" &&
      error.reason === "not-configured",
  );
  assert.equal(fixture.events.length, 0, "admission never enters an unrelated provider driver");

  await assert.rejects(
    recoverProviderTarget(target, { reason: "connect" }, new TargetDriverRegistry([controlOnly])),
    (error: unknown) =>
      error instanceof TargetDriverCapabilityUnavailableError &&
      error.capability === "recovery" &&
      error.reason === "not-configured",
  );
});

test("an explicitly registered provider exposes only its implemented recovery boundary", async () => {
  const fixture = createDeterministicProviderTestDriver();
  const target = fixture.target("provider-session-recover", "android");
  const result = await recoverProviderTarget(
    target,
    { reason: "observe" },
    new TargetDriverRegistry([fixture.driver]),
  );

  assert.deepEqual(result, {
    recovered: true,
    ready: true,
    summary: "Deterministic provider recovered provider-session-recover after observe.",
  });
  assert.deepEqual(fixture.events, [`recovery:${target.provider.key}:${target.targetId}:observe`]);
});
