import assert from "node:assert/strict";
import test from "node:test";
import {
  iosPreviewFrameFingerprint,
  IosLatestFrameFanout,
  type IosFrameSink,
} from "./ios-live-preview-telemetry.js";

class SilentSink implements IosFrameSink {
  write(): boolean {
    return true;
  }
  once(): void {}
}

test("frame fingerprints are deterministic per content and differ per content", () => {
  const first = iosPreviewFrameFingerprint(Buffer.from([0x01, 0x02, 0x03]));
  const again = iosPreviewFrameFingerprint(Buffer.from([0x01, 0x02, 0x03]));
  const other = iosPreviewFrameFingerprint(Buffer.from([0x01, 0x02, 0x04]));
  assert.equal(first, again);
  assert.notEqual(first, other);
});

test("fanout exposes the newest frame content fingerprint so consumers can tell stream-alive from frame-advanced", () => {
  const fanout = new IosLatestFrameFanout();
  fanout.subscribe(new SilentSink());

  assert.equal(fanout.diagnostics.lastFrameFingerprint, undefined, "no frame yet, no identity");

  fanout.publish(Buffer.from("same pixels"));
  const unchanged = fanout.diagnostics;
  fanout.publish(Buffer.from("same pixels"));
  const stillUnchanged = fanout.diagnostics;

  assert.ok(unchanged.lastFrameFingerprint);
  assert.equal(
    unchanged.lastFrameFingerprint,
    stillUnchanged.lastFrameFingerprint,
    "re-encoded duplicate screens keep one content identity while frames advance",
  );
  assert.equal(stillUnchanged.publishedFrames, 2);

  fanout.publish(Buffer.from("new pixels"));
  const advanced = fanout.diagnostics;
  assert.notEqual(
    advanced.lastFrameFingerprint,
    unchanged.lastFrameFingerprint,
    "changed screen content must produce a changed fingerprint",
  );
});
