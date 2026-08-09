import assert from "node:assert/strict";
import test from "node:test";
import { relayPreviewPacketIsPaintable, relayVideoPacketStream } from "./relay-video-stream";

function framedPacket(payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(16 + payload.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 1);
  view.setUint8(1, 1);
  view.setBigUint64(4, 42n);
  view.setUint32(12, payload.byteLength);
  bytes.set(payload, 16);
  return bytes;
}

test("parses a timestamped video packet split across HTTP chunks", async () => {
  const framed = framedPacket(Uint8Array.of(7, 8, 9));
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(framed.subarray(0, 5));
      controller.enqueue(framed.subarray(5, 17));
      controller.enqueue(framed.subarray(17));
      controller.close();
    },
  });
  const reader = relayVideoPacketStream(input).getReader();

  const result = await reader.read();
  assert.equal(result.done, false);
  assert.equal(result.value?.type, "data");
  if (result.value?.type !== "data") return;
  assert.equal(result.value.keyframe, true);
  assert.equal(result.value.pts, 42n);
  assert.deepEqual(result.value.data, Uint8Array.of(7, 8, 9));
});

test("JPEG and scrcpy H.264 paint; raw annex-B does not", () => {
  assert.equal(
    relayPreviewPacketIsPaintable({ type: "jpeg", pts: 0n, data: Uint8Array.of(0xff, 0xd8) }),
    true,
  );
  assert.equal(
    relayPreviewPacketIsPaintable({
      type: "data",
      keyframe: true,
      pts: 0n,
      data: Uint8Array.of(1),
    }),
    true,
  );
  assert.equal(
    relayPreviewPacketIsPaintable({
      type: "annexb",
      pts: 0n,
      keyframe: true,
      data: Uint8Array.of(0, 0, 0, 1, 0x65),
    }),
    false,
  );
});
