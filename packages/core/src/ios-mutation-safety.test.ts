import assert from "node:assert/strict";
import test from "node:test";
import {
  IosMutationOutcomeUnknownError,
  lastIosMutationAttemptDiagnostic,
  pressNamedControl,
  pressPoint,
  runIosMutationOnce,
  type Device,
} from "./device.js";
import { recordIosVideo } from "./ios-device-adapter.js";
import { scrollUp as recipeRunnerScrollUp } from "./recipe-runner-support.js";
import { runWithTargetContext } from "./target-context.js";
import { TargetControlReservedError } from "./target-control.js";
import { interact } from "./workspace-interact.js";

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

test("Android keeps its bounded transient retry behaviour", async () => {
  const previousDelay = process.env.RELAY_RETRY_DELAY_MS;
  process.env.RELAY_RETRY_DELAY_MS = "1";
  let nativePresses = 0;
  const device = {
    interactions: {
      press: async () => {
        nativePresses += 1;
        if (nativePresses < 3) throw new Error("connection reset");
      },
    },
  } as unknown as Device;
  try {
    await runWithTargetContext(android("android-retry"), () => pressPoint(device, 4, 8));
  } finally {
    if (previousDelay === undefined) delete process.env.RELAY_RETRY_DELAY_MS;
    else process.env.RELAY_RETRY_DELAY_MS = previousDelay;
  }
  assert.equal(nativePresses, 3);
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
