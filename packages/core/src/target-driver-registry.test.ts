import assert from "node:assert/strict";
import test from "node:test";
import { createDeterministicProviderTestDriver } from "./deterministic-provider-test-driver.js";
import { createTargetDriver, TargetDriverCapabilityUnavailableError } from "./target-driver.js";
import {
  assertProviderTargetExecutionAdmission,
  createProviderTargetExecutionPlan,
  recoverProviderTarget,
  TargetDriverRegistry,
  withProviderTargetExecution,
  withProviderTargetExecutionPlan,
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

test("an admitted provider plan keeps its exact driver through a registry rotation", async () => {
  const admitted = createDeterministicProviderTestDriver();
  const replacement = createDeterministicProviderTestDriver();
  const target = admitted.target("provider-session-rotation", "ios");
  const registry = new TargetDriverRegistry([admitted.driver]);
  const plan = createProviderTargetExecutionPlan(target, registry);

  assert.notEqual(plan.target, target, "the plan owns an immutable target copy");
  assert.deepEqual(plan.target, target);
  assert.deepEqual(plan.capabilities, ["control", "capture"]);
  assert.equal(registry.unregister(target.provider), true);
  registry.register(replacement.driver);

  await withProviderTargetExecutionPlan(plan, async ({ control }) => {
    await control.device.capture.screenshot();
  });
  assert.ok(
    admitted.events.includes(`capture.screenshot:${target.targetId}`),
    "queued work stays with the driver that passed admission",
  );
  assert.equal(replacement.events.length, 0, "a replacement driver receives no admitted work");

  await withProviderTargetExecution(
    target,
    async ({ control }) => {
      await control.device.capture.screenshot();
    },
    registry,
  );
  assert.ok(
    replacement.events.includes(`capture.screenshot:${target.targetId}`),
    "new admissions use the host's rotated driver",
  );
});
