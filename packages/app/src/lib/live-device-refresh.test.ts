import assert from "node:assert/strict";
import test from "node:test";
import { refreshLiveDeviceEvidence } from "./live-device-refresh";

test("physical iOS refreshes pixels before starting the accessibility read", async () => {
  const calls: string[] = [];
  let releaseFrame!: () => void;
  const frame = new Promise<void>((resolve) => {
    releaseFrame = resolve;
  });

  const refresh = refreshLiveDeviceEvidence({
    physicalIos: true,
    pollFrame: async () => {
      calls.push("frame:start");
      await frame;
      calls.push("frame:end");
    },
    pollSnapshot: async () => {
      calls.push("snapshot");
    },
  });

  await Promise.resolve();
  assert.deepEqual(calls, ["frame:start"]);
  releaseFrame();
  await refresh;
  assert.deepEqual(calls, ["frame:start", "frame:end", "snapshot"]);
});

test("non-iOS refreshes pixels and semantics concurrently", async () => {
  const calls: string[] = [];
  let releaseFrame!: () => void;
  let releaseSnapshot!: () => void;
  const frame = new Promise<void>((resolve) => {
    releaseFrame = resolve;
  });
  const snapshot = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });

  const refresh = refreshLiveDeviceEvidence({
    physicalIos: false,
    pollFrame: async () => {
      calls.push("frame:start");
      await frame;
    },
    pollSnapshot: async () => {
      calls.push("snapshot:start");
      await snapshot;
    },
  });

  await Promise.resolve();
  assert.deepEqual(calls, ["frame:start", "snapshot:start"]);
  releaseFrame();
  releaseSnapshot();
  await refresh;
});
