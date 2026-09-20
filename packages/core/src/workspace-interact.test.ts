import assert from "node:assert/strict";
import test from "node:test";
import { interact } from "./workspace-interact.js";
import {
  IosMutationOutcomeUnknownError,
  lastIosMutationAttemptDiagnostic,
} from "./ios-mutation-policy.js";
import { IosSnapshotInFlightError, snapshot, type Device } from "./device.js";
import { IosSnapshotStaleAfterInputError, resetIosSnapshotFlights } from "./ios-snapshot-flight.js";
import { IOS_POINT_TAP_RECOVER, setIosPixelTapForTests } from "./workspace-ios-raw.js";
import { runWithTargetContext } from "./target-context.js";
import { runWithTargetSupervisorStore, TargetSupervisorStore } from "./target-supervisor-store.js";

test("iOS point interact uses CoreDevice HID when the helper lands", async () => {
  const taps: unknown[] = [];
  setIosPixelTapForTests(async (input) => {
    taps.push(input);
  });
  const device = {
    interactions: {
      press: () => {
        throw new Error("XCTest pressPoint must not run when HID lands");
      },
    },
  } as unknown as Device;
  const supervisors = new TargetSupervisorStore(":memory:");
  try {
    const result = await runWithTargetSupervisorStore(supervisors, () =>
      runWithTargetContext({ kind: "device", platform: "ios", serial: "db0c9b7c" }, () =>
        interact({ kind: "point", x: 1112, y: 1010 }, { device, verifyIosScreenChange: false }),
      ),
    );
    assert.deepEqual(result.resolution, {
      method: "point",
      point: { x: 1112, y: 1010 },
      bounds: { x: 1112, y: 1010, width: 1, height: 1 },
    });
    assert.deepEqual(taps, [{ serial: "db0c9b7c", x: 1112, y: 1010 }]);
  } finally {
    setIosPixelTapForTests();
    supervisors.close();
  }
});

test("iOS point interact falls back to XCTest when HID is absent from the DDI", async () => {
  const presses: unknown[] = [];
  setIosPixelTapForTests(async () => {
    throw new Error(
      "service 'com.apple.coredevice.hid.universalhidservice' is not available in RSD",
    );
  });
  const device = {
    interactions: {
      press: (options: unknown) => {
        presses.push(options);
        return Promise.resolve({});
      },
    },
  } as unknown as Device;
  const supervisors = new TargetSupervisorStore(":memory:");
  try {
    await runWithTargetSupervisorStore(supervisors, () =>
      runWithTargetContext({ kind: "device", platform: "ios", serial: "db0c9b7c" }, () =>
        interact({ kind: "point", x: 1112, y: 1010 }, { device, verifyIosScreenChange: false }),
      ),
    );
    assert.equal(presses.length, 1);
    assert.equal((presses[0] as { x: number }).x, 1112);
    assert.equal((presses[0] as { y: number }).y, 1010);
  } finally {
    setIosPixelTapForTests();
    supervisors.close();
  }
});

test("iOS point interact asks for recover when HID and XCTest both cannot press", async () => {
  setIosPixelTapForTests(async () => {
    throw new Error("this DDI/RSD has no dtuhidd surface");
  });
  const device = {
    interactions: {
      press: () => Promise.reject(new Error("No active session. Run open first.")),
    },
  } as unknown as Device;
  const supervisors = new TargetSupervisorStore(":memory:");
  try {
    await assert.rejects(
      () =>
        runWithTargetSupervisorStore(supervisors, () =>
          runWithTargetContext({ kind: "device", platform: "ios", serial: "db0c9b7c" }, () =>
            interact({ kind: "point", x: 1112, y: 1010 }, { device, verifyIosScreenChange: false }),
          ),
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!(error instanceof IosMutationOutcomeUnknownError));
        assert.match(error.message, new RegExp(IOS_POINT_TAP_RECOVER));
        assert.doesNotMatch(error.message, /Retry the tap/);
        assert.match(error.message, /Recover the runner/);
        return true;
      },
    );
  } finally {
    setIosPixelTapForTests();
    supervisors.close();
  }
});

test("iOS point interact never replays TAP after HID watchdog or transport loss", async () => {
  for (const message of [
    "connection reset",
    "The iOS runner is still finishing a previous command that exceeded its execution watchdog",
    "iOS point tap via CoreDevice HID failed. Do not retry the same XCTest press. no tunnel",
  ]) {
    let presses = 0;
    setIosPixelTapForTests(async () => {
      throw new Error(message);
    });
    const device = {
      interactions: {
        press: async () => {
          presses += 1;
        },
      },
    } as unknown as Device;
    const supervisors = new TargetSupervisorStore(":memory:");
    try {
      await assert.rejects(
        () =>
          runWithTargetSupervisorStore(supervisors, () =>
            runWithTargetContext({ kind: "device", platform: "ios", serial: "db0c9b7c" }, () =>
              interact({ kind: "point", x: 48, y: 72 }, { device, verifyIosScreenChange: false }),
            ),
          ),
        (error: unknown) => {
          assert.ok(error instanceof IosMutationOutcomeUnknownError);
          assert.equal(error.iosMutation.outcome, "outcome-unknown");
          assert.equal(error.iosMutation.retry.decision, "blocked");
          return true;
        },
      );
      assert.equal(presses, 0, message);
    } finally {
      setIosPixelTapForTests();
      supervisors.close();
    }
  }
});

test("a successful HID tap fences an in-flight tree and records the same mutation as XCTest", async () => {
  const serial = "ios-hid-mutation-fence";
  const beforeInput = [{ role: "button", label: "Old screen" }];
  const afterInput = [{ role: "button", label: "New screen" }];
  let snapshotCalls = 0;
  let releaseOldTree!: (value: { nodes: typeof beforeInput }) => void;
  const oldTree = new Promise<{ nodes: typeof beforeInput }>((resolve) => {
    releaseOldTree = resolve;
  });
  const taps: unknown[] = [];
  setIosPixelTapForTests(async (input) => {
    taps.push(input);
  });
  const device = {
    capture: {
      snapshot: () => {
        snapshotCalls += 1;
        return snapshotCalls === 1 ? oldTree : Promise.resolve({ nodes: afterInput });
      },
    },
    interactions: {
      press: () => {
        throw new Error("XCTest pressPoint must not run when HID lands");
      },
    },
  } as unknown as Device;
  const supervisors = new TargetSupervisorStore(":memory:");
  resetIosSnapshotFlights();
  try {
    const preInputRead = runWithTargetSupervisorStore(supervisors, () =>
      runWithTargetContext({ kind: "device", platform: "ios", serial }, () => snapshot(device)),
    );
    for (let i = 0; i < 50 && snapshotCalls === 0; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    await runWithTargetSupervisorStore(supervisors, () =>
      runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
        interact({ kind: "point", x: 48, y: 72 }, { device, verifyIosScreenChange: false }),
      ),
    );

    await assert.rejects(
      runWithTargetSupervisorStore(supervisors, () =>
        runWithTargetContext({ kind: "device", platform: "ios", serial }, () => snapshot(device)),
      ),
      IosSnapshotInFlightError,
    );
    assert.equal(snapshotCalls, 1);
    assert.equal(taps.length, 1);

    const diagnostic = lastIosMutationAttemptDiagnostic(serial);
    assert.ok(diagnostic);
    assert.equal(diagnostic.operation, "press");
    assert.equal(diagnostic.outcome, "completed");
    assert.equal(diagnostic.nativeAttempts, 1);
    assert.deepEqual(
      supervisors
        .health({ id: serial, kind: "ios" })
        .events.filter((event) => event.code.startsWith("INPUT_"))
        .map((event) => event.code)
        .reverse(),
      ["INPUT_INTENT_PERSISTED", "INPUT_DISPATCHED", "INPUT_COMPLETED"],
    );

    releaseOldTree({ nodes: beforeInput });
    await assert.rejects(preInputRead, IosSnapshotStaleAfterInputError);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(
      await runWithTargetSupervisorStore(supervisors, () =>
        runWithTargetContext({ kind: "device", platform: "ios", serial }, () => snapshot(device)),
      ),
      afterInput,
    );
    assert.equal(snapshotCalls, 2);
  } finally {
    releaseOldTree({ nodes: beforeInput });
    setIosPixelTapForTests();
    supervisors.close();
    resetIosSnapshotFlights();
  }
});
