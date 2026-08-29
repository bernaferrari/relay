import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentDeviceClient } from "agent-device";
import { runWithJobControl } from "./control.js";
import { bindNativeDeviceMutations } from "./device-mutation-adapter.js";
import {
  IosMutationOutcomeUnknownError,
  IosSupervisionRequiredError,
  runIosMutationOnce,
  runWithIosSupervisionMode,
} from "./ios-mutation-policy.js";
import { reserveTargetControl } from "./target-control.js";
import { runWithTargetContext } from "./target-context.js";
import { runWithTargetSupervisorStore, TargetSupervisorStore } from "./target-supervisor-store.js";

type NativeDevice = ReturnType<typeof createAgentDeviceClient>;

function stubNative(record: (name: string) => void): NativeDevice {
  return {
    devices: { boot: async () => undefined },
    apps: { open: async () => record("open"), close: async () => undefined },
    interactions: {
      press: async () => record("press"),
      longPress: async () => undefined,
      fill: async () => undefined,
      type: async () => undefined,
      find: async () => undefined,
      scroll: async () => undefined,
      swipe: async () => undefined,
      pan: async () => undefined,
    },
    command: {
      back: async () => undefined,
      home: async () => undefined,
      clipboard: async () => undefined,
      keyboard: async () => undefined,
      alert: async () => undefined,
      appSwitcher: async () => undefined,
      rotate: async () => undefined,
      prepare: async () => undefined,
    },
    settings: { update: async () => undefined },
    recording: { record: async () => undefined },
  } as unknown as NativeDevice;
}

test("a cached client attributes each mutation to the job running it", async () => {
  const calls: string[] = [];
  // One client per target outlives every job that uses it. Built here outside
  // any job, exactly as a manual interact would build it before a batch starts.
  const bound = bindNativeDeviceMutations(
    stubNative((name) => calls.push(name)),
    "ipad-cache",
    "ios",
  );

  const release = reserveTargetControl("ipad-cache", "job-1");
  try {
    await runWithIosSupervisionMode("test-optional", () =>
      runWithJobControl("job-1", () =>
        bound.interactions.press({ platform: "ios", x: 1, y: 2 } as never),
      ),
    );
  } finally {
    release();
  }

  assert.deepEqual(calls, ["press"]);
});

test("required iOS supervision blocks before native dispatch when no store is available", async () => {
  const calls: string[] = [];
  const serial = "ios-supervision-required";
  const bound = bindNativeDeviceMutations(
    stubNative((name) => calls.push(name)),
    serial,
    "ios",
  );

  await assert.rejects(
    runWithIosSupervisionMode("required", () =>
      runIosMutationOnce(serial, "press", () =>
        bound.interactions.press({ platform: "ios", x: 1, y: 2 } as never),
      ),
    ),
    (error) => error instanceof IosSupervisionRequiredError,
  );
  assert.deepEqual(calls, []);
});

test("required iOS supervision never intercepts an Android mutation", async () => {
  const calls: string[] = [];
  const bound = bindNativeDeviceMutations(
    stubNative((name) => calls.push(name)),
    "android-supervision-boundary",
    "android",
  );

  await runWithIosSupervisionMode("required", () =>
    bound.interactions.press({ platform: "android", x: 1, y: 2 } as never),
  );

  assert.deepEqual(calls, ["press"]);
});

test("low-level iOS tests can explicitly opt into optional or unsupervised dispatch", async () => {
  const calls: string[] = [];
  const optionalSerial = "ios-supervision-test-optional";
  const optional = bindNativeDeviceMutations(
    stubNative((name) => calls.push(`${optionalSerial}:${name}`)),
    optionalSerial,
    "ios",
  );
  await runWithIosSupervisionMode("test-optional", () =>
    runIosMutationOnce(optionalSerial, "press", () =>
      optional.interactions.press({ platform: "ios", x: 1, y: 2 } as never),
    ),
  );

  const unsupervisedSerial = "ios-supervision-unsupervised";
  const unsupervised = bindNativeDeviceMutations(
    stubNative((name) => calls.push(`${unsupervisedSerial}:${name}`)),
    unsupervisedSerial,
    "ios",
  );
  await runWithIosSupervisionMode("unsupervised", () =>
    runIosMutationOnce(unsupervisedSerial, "press", () =>
      unsupervised.interactions.press({ platform: "ios", x: 1, y: 2 } as never),
    ),
  );

  assert.deepEqual(calls, [`${optionalSerial}:press`, `${unsupervisedSerial}:press`]);
});

test("physical iOS native dispatches write durable supervisor receipts", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "relay-supervised-native-"));
  const store = new TargetSupervisorStore(join(root, "supervisors.sqlite"));
  context.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  const successfulSerial = "ios-supervised-success";
  const successful = bindNativeDeviceMutations(
    stubNative(() => undefined),
    successfulSerial,
    "ios",
  );
  await runWithTargetSupervisorStore(store, () =>
    runWithTargetContext({ kind: "device", platform: "ios", serial: successfulSerial }, () =>
      runIosMutationOnce(successfulSerial, "press", () =>
        successful.interactions.press({ platform: "ios", x: 1, y: 2 } as never),
      ),
    ),
  );
  const success = store.health({ id: successfulSerial, kind: "ios" });
  assert.equal(success.input.state, "ready");
  assert.deepEqual(
    success.events
      .filter((event) => event.code.startsWith("INPUT_"))
      .map((event) => event.code)
      .reverse(),
    ["INPUT_INTENT_PERSISTED", "INPUT_DISPATCHED", "INPUT_COMPLETED"],
  );

  const unknownSerial = "ios-supervised-unknown";
  const unknown = bindNativeDeviceMutations(
    {
      ...stubNative(() => undefined),
      interactions: {
        ...stubNative(() => undefined).interactions,
        press: async () => {
          throw new Error("connection reset");
        },
      },
    } as NativeDevice,
    unknownSerial,
    "ios",
  );
  await assert.rejects(
    runWithTargetSupervisorStore(store, () =>
      runWithTargetContext({ kind: "device", platform: "ios", serial: unknownSerial }, () =>
        runIosMutationOnce(unknownSerial, "press", () =>
          unknown.interactions.press({ platform: "ios", x: 1, y: 2 } as never),
        ),
      ),
    ),
    IosMutationOutcomeUnknownError,
  );
  const uncertain = store.health({ id: unknownSerial, kind: "ios" });
  assert.equal(uncertain.input.state, "uncertain");
  assert.equal(uncertain.counters.uncertainMutations, 1);
  assert.equal(uncertain.events[0]?.code, "INPUT_OUTCOME_UNKNOWN");

  const missSerial = "ios-supervised-selector-miss";
  const miss = bindNativeDeviceMutations(
    {
      ...stubNative(() => undefined),
      interactions: {
        ...stubNative(() => undefined).interactions,
        press: async () => {
          throw new Error("Selector did not match an element");
        },
      },
    } as NativeDevice,
    missSerial,
    "ios",
  );
  await assert.rejects(
    runWithTargetSupervisorStore(store, () =>
      runWithTargetContext({ kind: "device", platform: "ios", serial: missSerial }, () =>
        runIosMutationOnce(missSerial, "press", () =>
          miss.interactions.press({ platform: "ios", selector: 'label="Missing"' } as never),
        ),
      ),
    ),
    /Selector did not match/u,
  );
  const rejected = store.health({ id: missSerial, kind: "ios" });
  assert.equal(rejected.input.state, "ready");
  assert.equal(rejected.counters.uncertainMutations, 0);
  assert.equal(rejected.events[0]?.code, "INPUT_NOT_DISPATCHED");
});

test("a terminal receipt failure cannot turn a completed native input into a retryable error", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "relay-supervised-receipt-failure-"));
  let failCompletedReceipt = true;
  const store = new TargetSupervisorStore(join(root, "supervisors.sqlite"), {
    beforePersistTransition: (event) => {
      if (failCompletedReceipt && event.kind === "input.completed") {
        failCompletedReceipt = false;
        throw new Error("injected receipt persistence failure");
      }
    },
  });
  context.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  const serial = "ios-supervised-receipt-failure";
  let nativeCalls = 0;
  const bound = bindNativeDeviceMutations(
    stubNative(() => {
      nativeCalls += 1;
    }),
    serial,
    "ios",
  );
  let failure: IosMutationOutcomeUnknownError | undefined;
  await assert.rejects(
    runWithTargetSupervisorStore(store, () =>
      runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
        runIosMutationOnce(serial, "press", () =>
          bound.interactions.press({ platform: "ios", x: 1, y: 2 } as never),
        ),
      ),
    ),
    (error) => {
      assert.ok(error instanceof IosMutationOutcomeUnknownError);
      failure = error;
      return true;
    },
  );
  assert.equal(nativeCalls, 1);
  assert.match(failure?.supervisedMutation?.mutationId ?? "", /^ios-input-/u);
  assert.equal(store.health({ id: serial, kind: "ios" }).input.state, "uncertain");
});
