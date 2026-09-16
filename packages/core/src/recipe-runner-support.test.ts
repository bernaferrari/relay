import assert from "node:assert/strict";
import test from "node:test";
import type { Device, SnapshotNode } from "./device.js";
import { noteConfirmedIosSnapshotInput, resetIosSnapshotFlights } from "./ios-snapshot-flight.js";
import { runWithTargetContext } from "./target-context.js";
import { resolvePointForDevice, targetPresent } from "./recipe-runner-support.js";
import { setLiveIosRunnerCommandPostForTests } from "./ios-runner-listener-command.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function countingSnapshotDevice(screens: SnapshotNode[][]): {
  device: Device;
  snapshotCalls: () => number;
} {
  let calls = 0;
  const device = {
    capture: {
      snapshot: async () => {
        const nodes = screens[Math.min(calls, screens.length - 1)] ?? [];
        calls += 1;
        return { nodes };
      },
    },
  } as unknown as Device;
  return { device, snapshotCalls: () => calls };
}

const portraitIpad: SnapshotNode[] = [
  {
    index: 0,
    depth: 0,
    type: "Application",
    rect: { x: 0, y: 0, width: 834, height: 1112 },
  },
];

const landscapeIpad: SnapshotNode[] = [
  {
    index: 0,
    depth: 0,
    type: "Application",
    rect: { x: 0, y: 0, width: 1112, height: 834 },
  },
];

test.afterEach(() => resetIosSnapshotFlights());

test("a confirmed input invalidates the cached runtime bounds for the same device", async () => {
  const { device, snapshotCalls } = countingSnapshotDevice([landscapeIpad, portraitIpad]);
  const target = { kind: "device", platform: "ios", serial: "bounds-fence-ipad" } as const;

  await runWithTargetContext(target, () =>
    resolvePointForDevice(device, {
      x: 100,
      y: 50,
      anchor: { horizontal: "right", vertical: "top" },
      referenceBounds: { width: 1112, height: 834 },
    }),
  );
  const callsAfterFirst = snapshotCalls();

  // A rotation (or any confirmed mutation) completes. The next anchored
  // resolution must re-read bounds instead of replaying the cached landscape.
  noteConfirmedIosSnapshotInput(target.serial);
  await runWithTargetContext(target, () =>
    resolvePointForDevice(device, {
      x: 100,
      y: 50,
      anchor: { horizontal: "right", vertical: "top" },
      referenceBounds: { width: 1112, height: 834 },
    }),
  );

  assert.equal(snapshotCalls(), callsAfterFirst + 1);
});

test("unchanged targets still share one cached bounds read", async () => {
  const { device, snapshotCalls } = countingSnapshotDevice([landscapeIpad]);
  const target = { kind: "device", platform: "ios", serial: "bounds-share-ipad" } as const;

  await runWithTargetContext(target, () => resolvePointForDevice(device, { x: 10, y: 10 }));
  await runWithTargetContext(target, () => resolvePointForDevice(device, { x: 20, y: 20 }));

  assert.equal(snapshotCalls(), 1);
});

test("iOS identifier presence does not queue a snapshot behind RUNNER_BUSY", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-present-busy-"));
  const serial = "present-busy-ipad";
  const previous = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = dir;
  await writeFile(
    join(dir, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, port: 50937 }),
  );
  let snapshotCalls = 0;
  let findCalls = 0;
  const restore = setLiveIosRunnerCommandPostForTests(async () => ({
    ok: false,
    error: {
      code: "RUNNER_BUSY",
      message:
        "The iOS runner is still finishing a previous command that exceeded its execution watchdog",
    },
  }));
  const device = {
    capture: {
      snapshot: async () => {
        snapshotCalls += 1;
        return { nodes: [] };
      },
    },
    interactions: {
      find: async () => {
        findCalls += 1;
        throw new Error("No match");
      },
    },
  } as unknown as Device;
  try {
    await assert.rejects(
      () =>
        runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
          targetPresent(device, { identifier: "ask.toolbar.textfield" }),
        ),
      /still finishing a previous command/u,
    );
    assert.equal(snapshotCalls, 0);
    assert.equal(findCalls, 0);
  } finally {
    restore();
    if (previous === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
