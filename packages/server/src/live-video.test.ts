import assert from "node:assert/strict";
import test from "node:test";
import {
  AndroidControlChannel,
  AndroidVideoStreamRegistry,
  encodeRelayVideoPacket,
  injectAndroidTouch,
  injectAndroidKey,
  injectAndroidScroll,
} from "./live-video.js";
import { HttpError } from "./http.js";

test("live video registry replaces stale producers without releasing the replacement", () => {
  const registry = new AndroidVideoStreamRegistry();
  let firstClosed = 0;
  let secondClosed = 0;
  const releaseFirst = registry.replace("device-1", () => {
    firstClosed += 1;
  });
  const releaseSecond = registry.replace("device-1", () => {
    secondClosed += 1;
  });

  assert.equal(firstClosed, 1);
  assert.equal(secondClosed, 0);
  assert.equal(registry.count(), 1);
  releaseFirst();
  assert.equal(registry.count(), 1);
  releaseSecond();
  assert.equal(registry.count(), 0);
});

test("live video framing preserves packet kind, keyframe, timestamp, and size", () => {
  const header = Buffer.from(
    encodeRelayVideoPacket({
      type: "data",
      keyframe: true,
      pts: 123_456_789n,
      data: Uint8Array.of(1, 2, 3),
    }),
  );

  assert.equal(header.byteLength, 16);
  assert.equal(header.readUInt8(0), 1);
  assert.equal(header.readUInt8(1), 1);
  assert.equal(header.readBigUInt64BE(4), 123_456_789n);
  assert.equal(header.readUInt32BE(12), 3);
});

test("control retirement waits for an in-flight write and rejects later writes", async () => {
  let finishWrite: (() => void) | undefined;
  const writer = {
    injectKeyCode: async () => undefined,
    injectText: async () => undefined,
    injectScroll: async () => undefined,
    injectTouch: () =>
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
  };
  const channel = new AndroidControlChannel(writer);
  const write = channel.write((control) =>
    control.injectTouch({} as Parameters<typeof control.injectTouch>[0]),
  );
  await Promise.resolve();
  const close = channel.close();
  assert.ok(finishWrite);
  finishWrite?.();
  await Promise.all([write, close]);
  await assert.rejects(
    channel.write((control) => control.injectText("late")),
    /reconnecting/i,
  );
});

test("an absent live control proves the individual request was not dispatched", async () => {
  const serial = "no-live-controller";
  for (const send of [
    () => injectAndroidTouch(serial, "down", 0.5, 0.5),
    () => injectAndroidKey(serial, { kind: "key", key: "enter" }),
    () => injectAndroidScroll(serial, 0.5, 0.5, 0, 1),
  ]) {
    await assert.rejects(
      send(),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === 409 &&
        error.body?.code === "ANDROID_LIVE_INPUT_NOT_DISPATCHED" &&
        error.body?.dispatched === false,
    );
  }
});

test("a failed control write never claims the input was not dispatched", async () => {
  let writes = 0;
  const channel = new AndroidControlChannel({
    injectKeyCode: async () => undefined,
    injectText: async () => undefined,
    injectScroll: async () => undefined,
    injectTouch: async () => {
      writes += 1;
      throw new Error("socket lost after write");
    },
  });
  await assert.rejects(
    channel.write((control) =>
      control.injectTouch({} as Parameters<typeof control.injectTouch>[0]),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.body?.code !== "ANDROID_LIVE_INPUT_NOT_DISPATCHED",
  );
  assert.equal(writes, 1);
});
