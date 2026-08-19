import assert from "node:assert/strict";
import test from "node:test";
import { createAgentDeviceClient } from "agent-device";
import { runWithJobControl } from "./control.js";
import { bindNativeDeviceMutations } from "./device-mutation-adapter.js";
import { reserveTargetControl } from "./target-control.js";

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
  );

  const release = reserveTargetControl("ipad-cache", "job-1");
  try {
    await runWithJobControl("job-1", () =>
      bound.interactions.press({ platform: "ios", x: 1, y: 2 } as never),
    );
  } finally {
    release();
  }

  assert.deepEqual(calls, ["press"]);
});
