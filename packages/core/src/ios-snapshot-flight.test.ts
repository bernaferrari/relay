import assert from "node:assert/strict";
import test from "node:test";
import {
  IosSnapshotInFlightError,
  IosSnapshotRunnerWedgedError,
  IosSnapshotTimedOutError,
  resetIosSnapshotFlights,
  setIosSnapshotForceExpiryMsForTests,
  snapshotIosSingleFlight,
  waitForIosSnapshotFlightSettle,
} from "./ios-snapshot-flight.js";
import type { TargetContext } from "./target-context.js";

const ios = (serial: string): TargetContext =>
  ({ kind: "device", platform: "ios", serial }) as const;

test("force-expiry keeps outstanding native work registered so a second traversal cannot start", async () => {
  const serial = "ios-snapshot-force-expiry-overlap";
  const context = ios(serial);
  let nativeStarts = 0;
  let release!: (value: { nodes: Array<{ label: string }> }) => void;
  const pending = new Promise<{ nodes: Array<{ label: string }> }>((resolve) => {
    release = resolve;
  });
  setIosSnapshotForceExpiryMsForTests(40);
  resetIosSnapshotFlights(context);
  try {
    const first = snapshotIosSingleFlight(
      context,
      false,
      async () => {
        nativeStarts += 1;
        return pending;
      },
      15,
    );
    await assert.rejects(first, IosSnapshotTimedOutError);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    await assert.rejects(
      snapshotIosSingleFlight(context, false, async () => {
        nativeStarts += 1;
        return { nodes: [{ label: "second tree" }] };
      }),
      IosSnapshotRunnerWedgedError,
    );
    assert.equal(nativeStarts, 1);

    const settledBeforeNative = await waitForIosSnapshotFlightSettle(context, 20);
    assert.equal(settledBeforeNative, false);

    release({ nodes: [{ label: "first tree" }] });
    const settledAfterNative = await waitForIosSnapshotFlightSettle(context, 200);
    assert.equal(settledAfterNative, true);

    const second = await snapshotIosSingleFlight(context, false, async () => {
      nativeStarts += 1;
      return { nodes: [{ label: "after recovery" }] };
    });
    assert.deepEqual(second, [{ label: "after recovery" }]);
    assert.equal(nativeStarts, 2);
  } finally {
    release({ nodes: [{ label: "first tree" }] });
    setIosSnapshotForceExpiryMsForTests();
    resetIosSnapshotFlights(context);
  }
});

test("a caller timeout still refuses overlapping reads until native work settles", async () => {
  const serial = "ios-snapshot-caller-timeout-lock";
  const context = ios(serial);
  let nativeStarts = 0;
  let release!: (value: { nodes: Array<{ label: string }> }) => void;
  const pending = new Promise<{ nodes: Array<{ label: string }> }>((resolve) => {
    release = resolve;
  });
  resetIosSnapshotFlights(context);
  try {
    const first = snapshotIosSingleFlight(
      context,
      false,
      async () => {
        nativeStarts += 1;
        return pending;
      },
      15,
    );
    await assert.rejects(first, IosSnapshotTimedOutError);
    await assert.rejects(
      snapshotIosSingleFlight(context, false, async () => {
        nativeStarts += 1;
        return { nodes: [{ label: "overlap" }] };
      }),
      IosSnapshotInFlightError,
    );
    assert.equal(nativeStarts, 1);
    release({ nodes: [{ label: "settled" }] });
    await waitForIosSnapshotFlightSettle(context, 200);
  } finally {
    release({ nodes: [{ label: "settled" }] });
    resetIosSnapshotFlights(context);
  }
});
