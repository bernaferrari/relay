import assert from "node:assert/strict";
import test from "node:test";
import { listConnectedTargets } from "./connected-target-inventory.js";

const target = {
  id: "browser-selected",
  name: "Selected browser",
  kind: "browser" as const,
  createdAt: 1,
  updatedAt: 1,
  browser: { startUrl: "https://example.test" },
};

test("the managed browser inventory excludes registered native targets", async () => {
  const result = await listConnectedTargets(
    { targetKind: "browser" },
    {
      listDevices: async () => [],
      listAndroidDevicesFast: async () => [],
      listTargets: async () => [
        target,
        { ...target, id: "registered-android", kind: "android", browser: undefined },
      ],
    },
  );
  assert.deepEqual(
    result.devices.map(({ id }) => id),
    [target.id],
  );
});

test("an exact managed browser inventory does not wait for physical device discovery", async () => {
  const calls: string[] = [];
  const inventory = listConnectedTargets(
    { targetId: target.id, targetKind: "browser" },
    {
      listTargets: async () => {
        calls.push("registry");
        return [target];
      },
      listDevices: () => {
        calls.push("physical");
        return new Promise(() => {});
      },
      listAndroidDevicesFast: async () => [],
    },
  );
  const blocked = Symbol("waiting on unrelated physical inventory");
  const result = await Promise.race([
    inventory,
    new Promise<typeof blocked>((resolve) => setImmediate(() => resolve(blocked))),
  ]);
  assert.notEqual(
    result,
    blocked,
    "Exact browser discovery must settle while hardware discovery is stalled",
  );
  assert.deepEqual(calls, ["registry"]);
  assert.deepEqual(
    (result as Awaited<typeof inventory>).devices.map(({ id }) => id),
    [target.id],
  );
});

test("typed browser inventory preserves missing, duplicate, and unavailable registry states", async () => {
  const runtime = {
    listDevices: async () => {
      throw new Error("Hardware must not be scanned");
    },
    listAndroidDevicesFast: async () => [],
    listTargets: async () => [target, { ...target, name: "Duplicate" }],
  };
  assert.deepEqual(
    (await listConnectedTargets({ targetKind: "browser", targetId: "missing" }, runtime)).devices,
    [],
  );
  assert.equal(
    (await listConnectedTargets({ targetKind: "browser", targetId: target.id }, runtime)).devices
      .length,
    2,
  );
  await assert.rejects(
    listConnectedTargets(
      { targetKind: "browser" },
      {
        ...runtime,
        listTargets: async () => {
          throw new Error("Registry unavailable");
        },
      },
    ),
    /Registry unavailable/u,
  );
});

test("an untyped identifier retains physical and browser collisions", async () => {
  const physical = {
    id: target.id,
    serial: target.id,
    name: "Phone",
    platform: "android" as const,
    kind: "physical",
    booted: true,
    connectionState: "offline",
  };
  const result = await listConnectedTargets(
    { targetId: target.id },
    {
      listDevices: async () => [physical],
      listAndroidDevicesFast: async () => [],
      listTargets: async () => [target],
    },
  );
  assert.deepEqual(
    result.devices.map(({ platform }) => platform),
    ["android", "browser"],
  );
  assert.equal(result.devices[0]?.connectionState, "offline");
  assert.equal(result.physicalDeviceCount, 1);
});

test("typed physical and phase discovery do not read managed targets", async () => {
  const phone = {
    id: "phone",
    serial: "phone",
    name: "Phone",
    platform: "android" as const,
    kind: "physical",
    booted: true,
  };
  const runtime = {
    listDevices: async () => [phone],
    listAndroidDevicesFast: async () => [phone],
    listTargets: async () => {
      throw new Error("Registry must not be read");
    },
  };
  assert.deepEqual(
    (await listConnectedTargets({ targetKind: "device", targetId: "phone" }, runtime)).devices,
    [phone],
  );
  assert.deepEqual((await listConnectedTargets({ phase: "android" }, runtime)).devices, [phone]);
  assert.deepEqual((await listConnectedTargets({ phase: "ios" }, runtime)).devices, []);
});
