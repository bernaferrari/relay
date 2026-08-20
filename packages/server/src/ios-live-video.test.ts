import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  encodeRelayAnnexBPacket,
  encodeRelayJpegPacket,
  IosLatestFrameFanout,
  IosPreviewOwnerRegistry,
  iosPreviewFrameIsFresh,
  readMjpegJpegs,
  type IosFrameSink,
  type IosPreviewOwner,
} from "./ios-live-video.js";

class FakeFrameSink extends EventEmitter implements IosFrameSink {
  readonly writes: Buffer[] = [];
  readonly writeResults: boolean[];

  constructor(...writeResults: boolean[]) {
    super();
    this.writeResults = writeResults;
  }

  write(chunk: Uint8Array): boolean {
    this.writes.push(Buffer.from(chunk));
    return this.writeResults.shift() ?? true;
  }
}

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

test("drops stale frames for a slow Relay client instead of queueing the device source", () => {
  const fanout = new IosLatestFrameFanout();
  const sink = new FakeFrameSink(false, true);
  const release = fanout.subscribe(sink);

  fanout.publish(Buffer.from([1]));
  fanout.publish(Buffer.from([2]));
  fanout.publish(Buffer.from([3]));

  assert.deepEqual(sink.writes, [Buffer.from([1])]);
  assert.deepEqual(fanout.diagnostics, {
    subscribers: 1,
    publishedFrames: 3,
    writtenFrames: 1,
    droppedFrames: 1,
  });

  sink.emit("drain");
  assert.deepEqual(sink.writes, [Buffer.from([1]), Buffer.from([3])]);
  release();
  fanout.publish(Buffer.from([4]));
  assert.equal(fanout.subscriberCount, 0);
});

test("shares one in-flight iOS preview start and cannot release its replacement", async () => {
  type Owner = IosPreviewOwner & { live: boolean; stopped: number };
  const registry = new IosPreviewOwnerRegistry<Owner>();
  let startCalls = 0;
  let resolveStart: ((owner: Owner) => void) | undefined;
  const firstOwner: Owner = {
    live: true,
    stopped: 0,
    async stop() {
      this.stopped += 1;
      return true;
    },
  };
  const start = () => {
    startCalls += 1;
    return new Promise<Owner>((resolve) => {
      resolveStart = resolve;
    });
  };

  const first = registry.acquire("ios-1", (owner) => owner.live, start);
  const second = registry.acquire("ios-1", (owner) => owner.live, start);
  await Promise.resolve();
  assert.equal(startCalls, 1);
  resolveStart?.(firstOwner);
  const [ownerFromFirst, ownerFromSecond] = await Promise.all([first, second]);
  assert.strictEqual(ownerFromFirst, firstOwner);
  assert.strictEqual(ownerFromSecond, firstOwner);

  firstOwner.live = false;
  const replacement: Owner = {
    live: true,
    stopped: 0,
    async stop() {
      this.stopped += 1;
      return true;
    },
  };
  const current = await registry.acquire(
    "ios-1",
    (owner) => owner.live,
    async () => replacement,
  );
  assert.strictEqual(current, replacement);
  assert.equal(firstOwner.stopped, 1);
  assert.equal(registry.release("ios-1", firstOwner), false);
  assert.equal(registry.count, 1);
});

test("requires a recent observed frame before considering an iOS source live", () => {
  assert.equal(iosPreviewFrameIsFresh(undefined, 10_000, 8_000), false);
  assert.equal(iosPreviewFrameIsFresh(2_000, 10_000, 8_000), true);
  assert.equal(iosPreviewFrameIsFresh(1_999, 10_000, 8_000), false);
  assert.equal(iosPreviewFrameIsFresh(10_001, 10_000, 8_000), false);
});

test("rejects absurd MJPEG Content-Length values before buffering a frame", async () => {
  async function* malformed() {
    yield Buffer.from("--BoundaryString\r\nContent-Length: 999999999\r\n\r\n");
  }
  await assert.rejects(async () => {
    for await (const _frame of readMjpegJpegs(malformed())) {
      // The malformed header must fail before it can yield.
    }
  }, /invalid Content-Length/i);
});
