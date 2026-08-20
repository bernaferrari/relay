import assert from "node:assert/strict";
import test from "node:test";
import {
  iosLivePreviewLabel,
  iosLivePreviewUiFormat,
  iosLivePreviewUsesStream,
  parseIosLivePreviewSettings,
} from "./ios-live-preview.js";

test("defaults to the safe Instruments stream, with PNG as an explicit fallback", () => {
  assert.deepEqual(parseIosLivePreviewSettings(undefined), { backend: "go-ios-auto" });
  assert.equal(iosLivePreviewUsesStream("go-ios-auto"), true);
  assert.equal(iosLivePreviewUsesStream("agent-device-png"), false);
  assert.equal(
    parseIosLivePreviewSettings({ backend: "agent-device-png" }).backend,
    "agent-device-png",
  );
});

test("default iOS preview is a JPEG stream DeviceVideoStream can paint", () => {
  const backend = parseIosLivePreviewSettings(undefined).backend;
  assert.equal(iosLivePreviewUiFormat(backend), "jpeg");
  assert.equal(iosLivePreviewUiFormat("go-ios-mjpeg"), "jpeg");
  assert.equal(iosLivePreviewUiFormat("agent-device-png"), "png");
});

test("accepts go-ios backends and legacy aliases", () => {
  assert.equal(
    parseIosLivePreviewSettings({ backend: "go-ios-devicekit" }).backend,
    "go-ios-mjpeg",
  );
  assert.equal(parseIosLivePreviewSettings({ backend: "go-ios-mjpeg" }).backend, "go-ios-mjpeg");
  assert.equal(parseIosLivePreviewSettings({ backend: "go-ios" }).backend, "go-ios-auto");
  assert.equal(parseIosLivePreviewSettings({ backend: "nope" }).backend, "go-ios-auto");
  assert.match(iosLivePreviewLabel("go-ios-auto"), /safe/i);
});
