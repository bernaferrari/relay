import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  encodeRelayAnnexBPacket,
  encodeRelayJpegPacket,
  IosLatestFrameFanout,
  IosPreviewOwnerRegistry,
  iosLivePreviewMetricHeaders,
  iosPreviewFrameAgeMs,
  iosPreviewFrameIsFresh,
  iosPreviewObservedFramesPerSecond,
  readMjpegJpegs,
  readIosLivePreviewDiagnostics,
  type IosFrameSink,
  type IosPreviewOwner,
  type IosPreviewSourceDiagnostics,
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

test("parses the bounded Relay sidecar multipart packets", async () => {
  const first = Buffer.from([0xff, 0xd8, 0x01, 0xd9]);
  const second = Buffer.from([0xff, 0xd8, 0x02, 0xd9]);
  const part = (jpeg: Buffer) =>
    Buffer.concat([
      Buffer.from("--RelayFrame\r\nContent-Type: image/jpeg\r\n"),
      Buffer.from(`Content-Length: ${jpeg.length}\r\n\r\n`),
      jpeg,
      Buffer.from("\r\n"),
    ]);
  async function* chunks() {
    yield Buffer.concat([part(first), part(second)]);
  }
  const frames: Buffer[] = [];
  for await (const frame of readMjpegJpegs(chunks())) frames.push(frame);
  assert.deepEqual(frames, [first, second]);
});

test("drops stale frames for a slow Relay client instead of queueing the device source", () => {
  let at = 1_000;
  const fanout = new IosLatestFrameFanout({ now: () => at });
  const sink = new FakeFrameSink(false, true);
  const subscription = fanout.subscribeWithDiagnostics(sink);

  fanout.publish(Buffer.from([1]));
  at = 1_500;
  fanout.publish(Buffer.from([2]));
  at = 2_000;
  fanout.publish(Buffer.from([3]));

  assert.deepEqual(sink.writes, [Buffer.from([1])]);
  assert.deepEqual(fanout.diagnostics, {
    subscribers: 1,
    publishedFrames: 3,
    offeredFrames: 3,
    writtenFrames: 1,
    droppedFrames: 1,
    pendingFrames: 1,
    dropRate: 0.5,
  });
  assert.deepEqual(subscription.diagnostics, {
    attachedAt: 1_000,
    offeredFrames: 3,
    writtenFrames: 1,
    droppedFrames: 1,
    pendingFrames: 1,
    dropRate: 0.5,
  });

  at = 3_000;
  sink.emit("drain");
  assert.deepEqual(sink.writes, [Buffer.from([1]), Buffer.from([3])]);
  assert.deepEqual(subscription.diagnostics, {
    attachedAt: 1_000,
    offeredFrames: 3,
    writtenFrames: 2,
    droppedFrames: 1,
    pendingFrames: 0,
    writtenFramesPerSecond: 0.5,
    dropRate: 1 / 3,
  });
  at = 3_250;
  subscription.release();
  fanout.publish(Buffer.from([4]));
  assert.equal(fanout.subscriberCount, 0);
  assert.deepEqual(subscription.diagnostics, {
    attachedAt: 1_000,
    releasedAt: 3_250,
    offeredFrames: 3,
    writtenFrames: 2,
    droppedFrames: 1,
    pendingFrames: 0,
    writtenFramesPerSecond: 0.5,
    dropRate: 1 / 3,
  });
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

test("reports observed source timing without inventing a target FPS", () => {
  assert.equal(iosPreviewObservedFramesPerSecond(1, 1_000, 1_000), undefined);
  assert.equal(iosPreviewObservedFramesPerSecond(3, 1_000, 2_000), 2);
  assert.equal(iosPreviewObservedFramesPerSecond(3, 2_000, 1_000), undefined);
  assert.equal(iosPreviewFrameAgeMs(undefined, 2_000), undefined);
  assert.equal(iosPreviewFrameAgeMs(1_000, 1_750), 750);
  assert.equal(iosPreviewFrameAgeMs(2_000, 1_750), 0);
});

test("emits safe stream-start metrics that separate observation from a target rate", () => {
  const diagnostics: IosPreviewSourceDiagnostics = {
    state: "streaming",
    startedAt: 1_000,
    readyAt: 1_250,
    lastFrameAt: 2_000,
    frames: 4,
    bytes: 123,
    observedFramesPerSecond: 3,
    frameAgeMs: 45,
    stale: false,
    staleAfterMs: 8_000,
    contentType: "multipart/x-mixed-replace; boundary=frame",
    fanout: {
      subscribers: 1,
      publishedFrames: 4,
      offeredFrames: 4,
      writtenFrames: 4,
      droppedFrames: 0,
      pendingFrames: 0,
      writtenFramesPerSecond: 3,
      dropRate: 0,
    },
  };

  const headers = iosLivePreviewMetricHeaders("instruments-mjpeg", diagnostics);
  assert.equal(headers["X-Relay-Ios-Observed-Source-Fps"], "3");
  assert.equal(headers["X-Relay-Ios-Source-Frame-Age-Ms"], "45");
  assert.equal(headers["X-Relay-Ios-Source-Stale"], "false");
  assert.equal(headers["X-Relay-Ios-Source-Stale-After-Ms"], "8000");
  assert.equal(headers["X-Relay-Ios-Target-Fps"], "unadvertised");
  assert.equal(headers["X-Relay-Ios-Delivery-Strategy"], "latest-frame");
});

test("returns a metadata-only inactive iOS relay diagnostic without starting a source", () => {
  const diagnostics = readIosLivePreviewDiagnostics("not-running", 42_000);
  assert.deepEqual(diagnostics, {
    provider: "go-ios-instruments-screenshot",
    deliveryStrategy: "latest-frame",
    targetFramesPerSecond: null,
    active: false,
    observedAt: 42_000,
    source: {
      state: "not-running",
      encoding: "unknown",
      observedFrames: 0,
      bytes: 0,
      stale: true,
      staleAfterMs: 8_000,
    },
    relay: {
      subscribers: 0,
      publishedFrames: 0,
      offeredFrames: 0,
      writtenFrames: 0,
      droppedFrames: 0,
      pendingFrames: 0,
    },
  });
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
