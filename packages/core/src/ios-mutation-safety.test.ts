import assert from "node:assert/strict";
import test from "node:test";
import {
  IosMutationOutcomeUnknownError,
  IosSnapshotInFlightError,
  lastIosMutationAttemptDiagnostic,
  pressNamedControl,
  pressMatchingText,
  pressLabel,
  pressPoint,
  runIosMutationOnce,
  snapshot,
  type Device,
} from "./device.js";
import { unknownErrorMessage } from "./ios-runner-listener-command.js";
import { recordIosVideo } from "./ios-device-adapter.js";
import { IosSnapshotStaleAfterInputError } from "./ios-snapshot-flight.js";
import { scrollUp as recipeRunnerScrollUp } from "./recipe-runner-support.js";
import { runWithTargetContext } from "./target-context.js";
import { TargetControlReservedError } from "./target-control.js";
import { interact } from "./workspace-interact.js";

test("a missing XCTest session has not pressed the glass", async () => {
  const device = {
    interactions: {
      press: async () => {
        throw new Error("No active session. Run open first.");
      },
    },
  } as unknown as Device;
  await assert.rejects(
    () => runWithTargetContext(ios("ipad-no-session-press"), () => pressPoint(device, 10, 20)),
    (error: unknown) => {
      assert.ok(!(error instanceof IosMutationOutcomeUnknownError));
      assert.match(
        error instanceof Error ? error.message : "",
        /No active session\. Run open first/,
      );
      const diagnostic = lastIosMutationAttemptDiagnostic("ipad-no-session-press");
      assert.equal(diagnostic?.outcome, "selector-miss");
      assert.equal(diagnostic?.retry.decision, "safe-selector-fallback");
      return true;
    },
  );
});

const ios = (serial: string) => ({ kind: "device", platform: "ios", serial }) as const;
const android = (serial: string) => ({ kind: "device", platform: "android", serial }) as const;

test("a transient physical iOS point press is issued once and stops for evidence", async () => {
  const serial = "ios-one-press";
  let nativePresses = 0;
  const device = {
    interactions: {
      press: async () => {
        nativePresses += 1;
        throw new Error("connection reset");
      },
    },
  } as unknown as Device;

  await assert.rejects(
    runWithTargetContext(ios(serial), () => pressPoint(device, 48, 72)),
    (error: unknown) => {
      assert.ok(error instanceof IosMutationOutcomeUnknownError);
      assert.deepEqual(
        { ...error.iosMutation, sequence: 0, at: 0 },
        {
          sequence: 0,
          operation: "press",
          nativeAttempts: 1,
          outcome: "outcome-unknown",
          retry: {
            attempts: 0,
            decision: "blocked",
            reason: "native-command-outcome-unknown",
          },
          intervention: {
            required: true,
            action: "capture-current-screen-before-any-retry",
          },
          at: 0,
        },
      );
      return true;
    },
  );

  assert.equal(nativePresses, 1);
  assert.equal(lastIosMutationAttemptDiagnostic(serial)?.nativeAttempts, 1);
  assert.equal(lastIosMutationAttemptDiagnostic(serial)?.retry.decision, "blocked");
});

test("a confirmed iOS input fences a delayed tree without overlapping XCTest reads", async () => {
  const serial = "ios-input-fence";
  const beforeInput = [{ role: "button", label: "Old screen" }];
  const afterInput = [{ role: "button", label: "New screen" }];
  let snapshotCalls = 0;
  let signalReadStarted!: () => void;
  const readStarted = new Promise<void>((resolve) => {
    signalReadStarted = resolve;
  });
  let releaseOldTree!: (value: { nodes: typeof beforeInput }) => void;
  const oldTree = new Promise<{ nodes: typeof beforeInput }>((resolve) => {
    releaseOldTree = resolve;
  });
  const device = {
    capture: {
      snapshot: () => {
        snapshotCalls += 1;
        signalReadStarted();
        return snapshotCalls === 1 ? oldTree : Promise.resolve({ nodes: afterInput });
      },
    },
    interactions: { press: async () => undefined },
  } as unknown as Device;

  const preInputRead = runWithTargetContext(ios(serial), () => snapshot(device));
  await readStarted;

  await runWithTargetContext(ios(serial), () => pressPoint(device, 48, 72));

  // iOS cannot cancel the old traversal, so a post-tap caller must wait for
  // it rather than share its pre-tap nodes or start a second XCTest request.
  await assert.rejects(
    runWithTargetContext(ios(serial), () => snapshot(device)),
    IosSnapshotInFlightError,
  );
  assert.equal(snapshotCalls, 1);

  releaseOldTree({ nodes: beforeInput });
  await assert.rejects(preInputRead, IosSnapshotStaleAfterInputError);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(await runWithTargetContext(ios(serial), () => snapshot(device)), afterInput);
  assert.equal(snapshotCalls, 2);
});

test("an iOS selector miss or outcome-unknown mutation does not falsely fence a tree", async () => {
  for (const [serial, error] of [
    ["ios-selector-miss-no-fence", new Error("Selector did not match an element")],
    ["ios-outcome-unknown-no-fence", new Error("connection reset")],
  ] as const) {
    let releaseTree!: (value: { nodes: Array<{ label: string }> }) => void;
    const tree = new Promise<{ nodes: Array<{ label: string }> }>((resolve) => {
      releaseTree = resolve;
    });
    let snapshotCalls = 0;
    const device = {
      capture: {
        snapshot: () => {
          snapshotCalls += 1;
          return tree;
        },
      },
    } as unknown as Device;

    const first = runWithTargetContext(ios(serial), () => snapshot(device));
    for (let i = 0; i < 50 && snapshotCalls === 0; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await assert.rejects(
      runWithTargetContext(ios(serial), () =>
        runIosMutationOnce(serial, "press", async () => {
          throw error;
        }),
      ),
    );

    // No completed native input was observed, so both callers retain the one
    // safe read instead of pretending the screen changed.
    const second = runWithTargetContext(ios(serial), () => snapshot(device));
    assert.equal(snapshotCalls, 1);
    releaseTree({ nodes: [{ label: "Still current" }] });
    assert.deepEqual(await first, [{ label: "Still current" }]);
    assert.deepEqual(await second, [{ label: "Still current" }]);
  }
});

test("an uncertain semantic iOS press never falls through to a second point press", async () => {
  const serial = "ios-no-semantic-fallback";
  const presses: unknown[] = [];
  const device = {
    capture: {
      snapshot: async () => ({
        nodes: [
          {
            type: "Button",
            label: "Settings",
            enabled: true,
            hittable: true,
            rect: { x: 20, y: 40, width: 240, height: 44 },
          },
        ],
      }),
    },
    interactions: {
      press: async (options: unknown) => {
        presses.push(options);
        throw new Error("socket disconnected");
      },
    },
  } as unknown as Device;

  await assert.rejects(
    runWithTargetContext(ios(serial), () => pressNamedControl(device, { label: "Settings" })),
    IosMutationOutcomeUnknownError,
  );

  assert.equal(presses.length, 1);
  assert.equal((presses[0] as { selector?: string }).selector, 'label="Settings"');
  assert.equal(lastIosMutationAttemptDiagnostic(serial)?.retry.decision, "blocked");
});

test("a native selector miss is the reviewed exception that can use the current point once", async () => {
  const serial = "ios-selector-miss";
  const presses: unknown[] = [];
  const device = {
    capture: {
      snapshot: async () => ({
        nodes: [
          {
            type: "Button",
            label: "Settings",
            enabled: true,
            hittable: true,
            rect: { x: 20, y: 40, width: 240, height: 44 },
          },
        ],
      }),
    },
    interactions: {
      press: async (options: unknown) => {
        presses.push(options);
        if ((options as { selector?: string }).selector) {
          throw new Error("Selector did not match an element");
        }
      },
    },
  } as unknown as Device;

  await runWithTargetContext(ios(serial), () => pressNamedControl(device, { label: "Settings" }));

  assert.deepEqual(presses, [
    {
      platform: "ios",
      udid: serial,
      selector: 'label="Settings"',
      maestro: {
        allowNonHittableCoordinateFallback: true,
        expectedTapPoint: { x: 140, y: 62 },
      },
    },
    { platform: "ios", udid: serial, x: 140, y: 62 },
  ]);
  assert.equal(lastIosMutationAttemptDiagnostic(serial)?.outcome, "completed");
});

test("an ambiguous fallback find never becomes a coordinate press", async () => {
  const serial = "ios-matching-text-fallback-unknown";
  const presses: Array<{ selector?: string; x?: number; y?: number }> = [];
  const finds: Array<{ action?: string }> = [];
  const device = {
    capture: {
      snapshot: async () => ({
        nodes: [
          {
            type: "Button",
            label: "Settings",
            enabled: true,
            hittable: true,
            rect: { x: 20, y: 40, width: 240, height: 44 },
          },
        ],
      }),
    },
    interactions: {
      press: async (options: { selector?: string; x?: number; y?: number }) => {
        presses.push(options);
        if (options.selector) throw new Error("Selector did not match an element");
      },
      find: async (options: { action?: string }) => {
        finds.push(options);
        if (options.action === "click") throw new Error("connection reset");
      },
    },
  } as unknown as Device;

  await assert.rejects(
    runWithTargetContext(ios(serial), () => pressMatchingText(device, "Settings")),
    IosMutationOutcomeUnknownError,
  );

  assert.deepEqual(
    presses.map(({ selector, x, y }) => ({ selector, x, y })),
    [{ selector: 'label*="Settings"', x: undefined, y: undefined }],
    "the safe initial selector miss must not be followed by a coordinate press after find becomes ambiguous",
  );
  assert.deepEqual(
    finds.map(({ action }) => action),
    ["exists", "click"],
  );
  assert.deepEqual(lastIosMutationAttemptDiagnostic(serial)?.retry, {
    attempts: 0,
    decision: "blocked",
    reason: "native-command-outcome-unknown",
  });
});

test("a proven pressMatchingText selector miss still resolves through its current point", async () => {
  const serial = "ios-matching-text-selector-miss";
  const presses: Array<{ selector?: string; x?: number; y?: number }> = [];
  const device = {
    capture: {
      snapshot: async () => ({
        nodes: [
          {
            type: "Button",
            label: "Settings",
            enabled: true,
            hittable: true,
            rect: { x: 20, y: 40, width: 240, height: 44 },
          },
        ],
      }),
    },
    interactions: {
      press: async (options: { selector?: string; x?: number; y?: number }) => {
        presses.push(options);
        if (options.selector) throw new Error("Selector did not match an element");
      },
      find: async () => {
        throw new Error("element not found");
      },
    },
  } as unknown as Device;

  await runWithTargetContext(ios(serial), () => pressMatchingText(device, "Settings"));

  assert.deepEqual(
    presses.map(({ selector, x, y }) => ({ selector, x, y })),
    [
      { selector: 'label*="Settings"', x: undefined, y: undefined },
      { selector: undefined, x: 140, y: 62 },
    ],
  );
  assert.equal(lastIosMutationAttemptDiagnostic(serial)?.outcome, "completed");
});

test("Android physical mutations do not retry an uncertain press", async () => {
  let nativePresses = 0;
  const device = {
    interactions: {
      press: async () => {
        nativePresses += 1;
        throw new Error("connection reset");
      },
    },
  } as unknown as Device;

  await assert.rejects(
    runWithTargetContext(android("android-no-retry"), () => pressPoint(device, 4, 8)),
    /connection reset/u,
  );
  assert.equal(nativePresses, 1);
});

test("Android named press does not fall through to a second point after transport loss", async () => {
  let nativePresses = 0;
  const device = {
    capture: {
      snapshot: async () => ({
        nodes: [
          {
            type: "button",
            label: "Send",
            rect: { x: 10, y: 20, width: 100, height: 40 },
          },
        ],
      }),
    },
    interactions: {
      press: async () => {
        nativePresses += 1;
        throw new Error("connection reset");
      },
    },
  } as unknown as Device;

  await assert.rejects(
    runWithTargetContext(android("android-named-no-fallback"), () => pressLabel(device, "Send")),
    /connection reset/u,
  );
  assert.equal(nativePresses, 1);
});

test("a target-control denial is known pre-dispatch, not an ambiguous iOS mutation", async () => {
  const serial = "ios-reserved-before-dispatch";
  await assert.rejects(
    runWithTargetContext(ios(serial), () =>
      // This is the error the target lane throws before calling its native SDK
      // callback, so it must not create a false intervention prompt.
      runIosMutationOnce(serial, "press", async () => {
        throw new TargetControlReservedError(serial);
      }),
    ),
    TargetControlReservedError,
  );
  assert.equal(lastIosMutationAttemptDiagnostic(serial), undefined);
});

test("iOS video start is also one native mutation when its acknowledgement is lost", async () => {
  let records = 0;
  const device = {
    recording: {
      record: async () => {
        records += 1;
        throw new Error("connection reset");
      },
    },
  } as unknown as Device;

  await assert.rejects(
    recordIosVideo(device, { udid: "ios-video-once", action: "start", path: "/tmp/take.mp4" }),
    IosMutationOutcomeUnknownError,
  );

  assert.equal(records, 1);
  assert.equal(lastIosMutationAttemptDiagnostic("ios-video-once")?.operation, "video");
  assert.equal(lastIosMutationAttemptDiagnostic("ios-video-once")?.retry.decision, "blocked");
});

test("a successful outer iOS Back response reports its one native attempt", async () => {
  const serial = "ios-interact-diagnostic";
  let nativeBacks = 0;
  const device = {
    command: {
      back: async () => {
        nativeBacks += 1;
      },
    },
  } as unknown as Device;

  const result = await runWithTargetContext(ios(serial), () =>
    interact({ kind: "key", key: "back" }, { device }),
  );

  assert.equal(nativeBacks, 1);
  assert.deepEqual(
    {
      operation: result.iosMutation?.operation,
      nativeAttempts: result.iosMutation?.nativeAttempts,
      retry: result.iosMutation?.retry,
      intervention: result.iosMutation?.intervention,
    },
    {
      operation: "back",
      nativeAttempts: 1,
      retry: { attempts: 0, decision: "not-needed", reason: "native-command-completed" },
      intervention: { required: false, action: "none" },
    },
  );
  assert.equal(result.iosSessionLifecycle?.attempts, 1);
});

test("a runner {message,code} element miss is not-dispatched, not unknown", async () => {
  const serial = "ios-type-object-miss";
  let nativeTypes = 0;
  const device = {
    interactions: {
      type: async () => {
        nativeTypes += 1;
        throw {
          message: "element not found",
          code: "COMMAND_FAILED",
        };
      },
    },
  } as unknown as Device;

  await assert.rejects(
    runWithTargetContext(ios(serial), () => interact({ kind: "type", text: "hello" }, { device })),
    (error: unknown) => {
      assert.ok(!(error instanceof IosMutationOutcomeUnknownError));
      assert.equal(unknownErrorMessage(error), "element not found");
      return true;
    },
  );
  assert.equal(nativeTypes, 1);
  assert.deepEqual(lastIosMutationAttemptDiagnostic(serial)?.retry, {
    attempts: 0,
    decision: "safe-selector-fallback",
    reason: "selector-was-not-dispatched",
  });
});

test("outer iOS swipe and type interactions never retry an uncertain native command", async () => {
  const serial = "ios-outer-no-retry";
  let nativeSwipes = 0;
  let nativeTypes = 0;
  const device = {
    interactions: {
      pan: async () => {
        nativeSwipes += 1;
        throw new Error("socket disconnected");
      },
      type: async () => {
        nativeTypes += 1;
        throw new Error("connection reset");
      },
    },
  } as unknown as Device;

  await assert.rejects(
    runWithTargetContext(ios(serial), () =>
      interact(
        {
          kind: "swipe",
          from: { x: 100, y: 600 },
          to: { x: 100, y: 200 },
        },
        { device },
      ),
    ),
    IosMutationOutcomeUnknownError,
  );
  await assert.rejects(
    runWithTargetContext(ios(serial), () => interact({ kind: "type", text: "Hello" }, { device })),
    IosMutationOutcomeUnknownError,
  );

  assert.equal(nativeSwipes, 1);
  assert.equal(nativeTypes, 1);
  assert.deepEqual(lastIosMutationAttemptDiagnostic(serial)?.retry, {
    attempts: 0,
    decision: "blocked",
    reason: "native-command-outcome-unknown",
  });
});

test("the recipe runner's direct scroll fallback stays on the exact-once iOS path", async () => {
  const serial = "ios-recipe-scroll-once";
  let nativeScrolls = 0;
  const device = {
    interactions: {
      scroll: async () => {
        nativeScrolls += 1;
        throw new Error("connection reset");
      },
    },
  } as unknown as Device;

  await assert.rejects(
    runWithTargetContext(ios(serial), () => recipeRunnerScrollUp(device)),
    IosMutationOutcomeUnknownError,
  );

  assert.equal(nativeScrolls, 1);
  assert.equal(lastIosMutationAttemptDiagnostic(serial)?.operation, "scroll");
});
