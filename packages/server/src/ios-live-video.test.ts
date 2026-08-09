import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeRelayAnnexBPacket,
  encodeRelayJpegPacket,
  readMjpegJpegs,
} from "./ios-live-video.js";

test("frames a jpeg packet with kind 2", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const packet = encodeRelayJpegPacket(jpeg, 12n);
  assert.equal(packet[0], 2);
  assert.equal(packet[1], 1);
  assert.equal(packet.readUInt32BE(12), 4);
  assert.deepEqual(packet.subarray(16), Buffer.from(jpeg));
});

test("frames annex-B chunks with kind 3", () => {
  const nal = Uint8Array.from([0, 0, 0, 1, 0x65, 1, 2]);
  const packet = encodeRelayAnnexBPacket(nal, 1n, true);
  assert.equal(packet[0], 3);
  assert.equal(packet[1], 1);
  assert.deepEqual(packet.subarray(16), Buffer.from(nal));
});

test("parses go-ios style mjpeg parts", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0x01, 0xd9]);
  const header = Buffer.concat([
    Buffer.from("--BoundaryString"),
    Buffer.from("\r\n"),
    Buffer.from("Content-type: image/jpg"),
    Buffer.from("\r\n"),
    Buffer.from(`Content-Length: ${jpeg.length}`),
    Buffer.from("\r\n\r\n"),
  ]);
  const body = Buffer.concat([header, jpeg, Buffer.from("\r\n")]);
  async function* chunks() {
    yield body;
  }
  const frames: Buffer[] = [];
  for await (const frame of readMjpegJpegs(chunks())) frames.push(frame);
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], jpeg);
});
