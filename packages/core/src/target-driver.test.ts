import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Device } from "./device.js";
import { setLocalDeviceProvider } from "./device-factory.js";
import {
  createLocalAgentDeviceTargetDriver,
  createTargetDriver,
  executionTargetRefFromTargetContext,
  TargetDriverCapabilityUnavailableError,
  targetContextFromExecutionTargetRef,
} from "./target-driver.js";
import type { TargetContext } from "./target-context.js";

afterEach(() => setLocalDeviceProvider(undefined));

test("execution target bridge round-trips every current target context losslessly", () => {
  const contexts: TargetContext[] = [
    { kind: "device", platform: "android", serial: "emulator-5554" },
    { kind: "device", platform: "ios", serial: "00008120-0012345678901234" },
    { kind: "browser", platform: "browser", targetId: "docs-browser" },
    {
      kind: "cloud",
      provider: "future-farm",
      sessionId: "session-42",
      platform: "android",
    },
  ];

  for (const context of contexts) {
    assert.deepEqual(
      targetContextFromExecutionTargetRef(executionTargetRefFromTargetContext(context)),
      context,
    );
  }

  const local = executionTargetRefFromTargetContext(contexts[1]!);
  assert.equal(local.kind, "local-device");
  assert.equal(local.provider.key, "relay.local.agent-device");
  assert.equal(local.targetId, "00008120-0012345678901234");
});

test("local AgentDevice driver scopes control and capture to a local physical target", async () => {
  const context: TargetContext = {
    kind: "device",
    platform: "android",
    serial: "driver-android",
  };
  const target = executionTargetRefFromTargetContext(context);
  const seen: TargetContext[] = [];
  setLocalDeviceProvider({
    kind: "device",
    create(actual) {
      seen.push(actual);
      return {
        devices: {
          list: async () => [{ id: "driver-android", name: "Driver", platform: "android" }],
        },
      } as unknown as Device;
    },
  });
  const driver = createLocalAgentDeviceTargetDriver();

  assert.deepEqual(driver.control.availability(target), {
    capability: "control",
    state: "available",
  });
  assert.deepEqual(driver.capture.availability(target), {
    capability: "capture",
    state: "available",
  });
  const result = await driver.capture.withTarget(target, async (session) => {
    assert.deepEqual(session.context, context);
    assert.equal(session.target, target);
    return await session.device.devices.list();
  });

  assert.equal(result[0]?.id, "driver-android");
  assert.deepEqual(seen, [context]);
});

test("driver availability is derived from executable handlers and fails closed", async () => {
  const localTarget = executionTargetRefFromTargetContext({
    kind: "device",
    platform: "ios",
    serial: "driver-ios",
  });
  const browserTarget = executionTargetRefFromTargetContext({
    kind: "browser",
    platform: "browser",
    targetId: "driver-browser",
  });
  const local = createLocalAgentDeviceTargetDriver();

  assert.deepEqual(local.inventory.availability(), {
    capability: "inventory",
    state: "unavailable",
    reason: "not-configured",
  });
  assert.deepEqual(local.recovery.availability(localTarget), {
    capability: "recovery",
    state: "unavailable",
    reason: "not-configured",
  });
  assert.deepEqual(local.capture.availability(browserTarget), {
    capability: "capture",
    state: "unavailable",
    reason: "target-kind-unsupported",
  });
  await assert.rejects(
    local.capture.withTarget(browserTarget, async () => undefined),
    (error: unknown) =>
      error instanceof TargetDriverCapabilityUnavailableError &&
      error.code === "TARGET_DRIVER_CAPABILITY_UNAVAILABLE" &&
      error.reason === "target-kind-unsupported",
  );

  let called = false;
  const remoteTarget = executionTargetRefFromTargetContext({
    kind: "cloud",
    provider: "example.remote",
    sessionId: "session-unsupported",
    platform: "ios",
  });
  const rejectedProvider = createTargetDriver({
    provider: { key: "example.remote", scope: "remote" },
    // An installed handler still cannot advertise a capability for targets its
    // provider does not support.
    supportsTarget: (target) =>
      target.kind === "provider-session" ? "target-kind-unsupported" : undefined,
    control: async <_T>() => {
      called = true;
      throw new Error("unsupported provider handler must not execute");
    },
  });
  assert.deepEqual(rejectedProvider.control.availability(remoteTarget), {
    capability: "control",
    state: "unavailable",
    reason: "target-kind-unsupported",
  });
  await assert.rejects(rejectedProvider.control.withTarget(remoteTarget, async () => "not-run"));
  assert.equal(called, false);

  assert.deepEqual(rejectedProvider.control.availability(localTarget), {
    capability: "control",
    state: "unavailable",
    reason: "provider-mismatch",
  });
});

test("configured inventory and recovery become available only with concrete local handlers", async () => {
  const target = executionTargetRefFromTargetContext({
    kind: "device",
    platform: "android",
    serial: "configured-driver",
  });
  if (target.kind !== "local-device") throw new Error("expected local device target");
  const driver = createLocalAgentDeviceTargetDriver({
    list: async () => [target],
    recover: async (_target, request) => ({
      recovered: request.reason === "connect",
      ready: true,
      summary: "Local host recovery completed.",
    }),
  });

  assert.deepEqual(driver.inventory.availability(), {
    capability: "inventory",
    state: "available",
  });
  assert.deepEqual(driver.recovery.availability(target), {
    capability: "recovery",
    state: "available",
  });
  assert.deepEqual(await driver.inventory.list(), [target]);
  assert.deepEqual(await driver.recovery.recover(target, { reason: "connect" }), {
    recovered: true,
    ready: true,
    summary: "Local host recovery completed.",
  });
});
