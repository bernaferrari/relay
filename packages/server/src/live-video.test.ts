import assert from "node:assert/strict";
import test from "node:test";
import { AndroidVideoStreamRegistry, encodeRelayVideoPacket } from "./live-video.js";

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
