import assert from "node:assert/strict";
import test from "node:test";
import type { Device, SnapshotNode } from "./device.js";
import { noteConfirmedIosSnapshotInput, resetIosSnapshotFlights } from "./ios-snapshot-flight.js";
import { runWithTargetContext } from "./target-context.js";
import { resolvePointForDevice } from "./recipe-runner-support.js";

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
