import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deviceTestDouble } from "@relay/core/testing";
import {
  createDevice,
  IosMutationOutcomeUnknownError,
  pressPoint,
  resetDeviceClients,
  type Device,
} from "./device.js";
import {
  createDeviceForTarget,
  createDeviceForTargetAsync,
  setCloudDeviceProvider,
  setLocalDeviceProvider,
} from "./device-factory.js";
import { createDeviceObservationFacade } from "./device-observation-membrane.js";
import { runWithTargetContext, type TargetContext } from "./target-context.js";

type CallLog = {
  presses: Array<{ x?: number; y?: number }>;
  finds: Array<{ action?: unknown; query?: unknown }>;
};

function adapterSource(calls: CallLog, options: { unknownIosPress?: boolean } = {}): object {
  return {
    devices: {
      list: async () => [{ id: "fake", name: "Fake", platform: "android" }],
      boot: async () => ({ booted: true }),
    },
    apps: {
      open: async () => ({ appId: "example" }),
      close: async () => ({ closed: true }),
    },
    capture: {
      snapshot: async () => ({ nodes: [] }),
      screenshot: async () => ({ path: "/tmp/fake.png" }),
    },
    interactions: {
      find: async (input: { action?: unknown; query?: unknown }) => {
        calls.finds.push(input);
        return { found: true };
      },
      press: async (input: { x?: number; y?: number }) => {
        calls.presses.push(input);
        if (options.unknownIosPress) throw new Error("native acknowledgement lost");
        return { ok: true };
      },
    },
    command: {
      wait: async () => ({ ok: true }),
      appState: async () => ({ platform: "android", package: "example", activity: "Main" }),
      back: async () => ({ ok: true }),
    },
    observability: {
      perf: async () => ({ ok: true }),
      logs: async () => ({ entries: [] }),
      network: async () => ({ entries: [] }),
      audio: async () => ({ ok: true }),
      crashes: async () => ({ platform: "android", since: 0, entries: [], truncated: false }),
    },
    recording: { record: async () => ({ started: true }) },
    settings: { update: async () => ({ ok: true }) },
  };
}

function assertObservationOnly(device: Device): void {
  const value = device as unknown as Record<string, Record<string, unknown>>;
  assert.equal(Object.getPrototypeOf(device), null);
  assert.equal(Object.isFrozen(device), true);
  assert.deepEqual(Object.keys(device).sort(), [
    "capture",
    "command",
    "devices",
    "interactions",
    "observability",
  ]);
  assert.deepEqual(Object.keys(value.devices ?? {}).sort(), ["list"]);
  assert.deepEqual(Object.keys(value.capture ?? {}).sort(), ["screenshot", "snapshot"]);
  assert.deepEqual(Object.keys(value.interactions ?? {}).sort(), ["find"]);
  assert.deepEqual(Object.keys(value.command ?? {}).sort(), ["appState", "wait"]);
  assert.equal("apps" in value, false);
  assert.equal("recording" in value, false);
  assert.equal("settings" in value, false);
  assert.equal("press" in (value.interactions ?? {}), false);
  assert.equal("back" in (value.command ?? {}), false);
  assert.equal("boot" in (value.devices ?? {}), false);
  assert.equal(Object.isFrozen(value.interactions), true);
}

function assertSinglePress(calls: CallLog, x: number, y: number): void {
  assert.equal(calls.presses.length, 1);
  assert.equal(calls.presses[0]?.x, x);
  assert.equal(calls.presses[0]?.y, y);
}

afterEach(() => {
  setCloudDeviceProvider(undefined);
  setLocalDeviceProvider(undefined);
  resetDeviceClients();
});

test("the observation membrane hides raw properties and rejects runtime find-clicks", async () => {
  const calls: CallLog = { presses: [], finds: [] };
  const device = createDeviceObservationFacade(adapterSource(calls));

  assertObservationOnly(device);
  await device.interactions.find({ action: "exists", query: "Settings" });
  assert.deepEqual(calls.finds, [{ action: "exists", query: "Settings" }]);
  assert.throws(
    () =>
      (
        device.interactions.find as unknown as (input: { action: string; query: string }) => unknown
      )({ action: "click", query: "Settings" }),
    /only permits interactions\.find/u,
  );
  assert.deepEqual(calls.finds, [{ action: "exists", query: "Settings" }]);
});

test("explicit test doubles keep canonical Android and iOS mutation semantics", async () => {
  const androidCalls: CallLog = { presses: [], finds: [] };
  const android = deviceTestDouble(adapterSource(androidCalls));
  assertObservationOnly(android);
  await runWithTargetContext(
    { kind: "device", platform: "android", serial: "membrane-android" },
    async () => await pressPoint(android, 12, 34),
  );
  assertSinglePress(androidCalls, 12, 34);

  const iosCalls: CallLog = { presses: [], finds: [] };
  const ios = deviceTestDouble(adapterSource(iosCalls, { unknownIosPress: true }));
  await assert.rejects(
    runWithTargetContext(
      { kind: "device", platform: "ios", serial: "membrane-ios" },
      async () => await pressPoint(ios, 56, 78),
    ),
    (error: unknown) => error instanceof IosMutationOutcomeUnknownError,
  );
  assertSinglePress(iosCalls, 56, 78);
});

test("local, browser-shaped, and cloud adapter products all receive the public facade", async () => {
  const localCalls: CallLog = { presses: [], finds: [] };
  const localContext = {
    kind: "device",
    platform: "android",
    serial: "membrane-local",
  } as const;
  setLocalDeviceProvider({
    kind: "device",
    create: () => adapterSource(localCalls) as Device,
  });
  const local = createDeviceForTarget(localContext);
  assertObservationOnly(local);
  await runWithTargetContext(localContext, async () => await pressPoint(local, 1, 2));
  assertSinglePress(localCalls, 1, 2);

  const browserCalls: CallLog = { presses: [], finds: [] };
  const browser = createDeviceObservationFacade(adapterSource(browserCalls));
  const browserContext: TargetContext = {
    kind: "browser",
    platform: "browser",
    targetId: "membrane-browser",
  };
  assertObservationOnly(browser);
  await runWithTargetContext(browserContext, async () => await pressPoint(browser, 3, 4));
  assertSinglePress(browserCalls, 3, 4);

  const cloudCalls: CallLog = { presses: [], finds: [] };
  const cloudContext = {
    kind: "cloud",
    provider: "membrane-cloud",
    sessionId: "membrane-session",
    platform: "android",
  } as const;
  setCloudDeviceProvider({
    kind: "cloud",
    provider: cloudContext.provider,
    create: () => adapterSource(cloudCalls) as Device,
  });
  const cloud = createDeviceForTarget(cloudContext);
  assertObservationOnly(cloud);
  assertObservationOnly(await createDeviceForTargetAsync(cloudContext));
  await runWithTargetContext(cloudContext, async () => await pressPoint(cloud, 5, 6));
  assertSinglePress(cloudCalls, 5, 6);
});

test("direct local Android and iOS clients are wrapped before any device operation", async () => {
  for (const context of [
    { kind: "device", platform: "android", serial: "membrane-local-android" },
    { kind: "device", platform: "ios", serial: "membrane-local-ios" },
  ] as const) {
    await runWithTargetContext(context, async () => {
      assertObservationOnly(createDevice());
    });
  }
});
