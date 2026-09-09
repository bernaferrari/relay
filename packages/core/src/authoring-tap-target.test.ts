import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringObservation } from "@relay/protocol";
import { semanticTargetForRecording } from "./authoring-tap-target.js";
import { resolveNamedControlOutcome } from "./device-target-resolution.js";

function observation(): AuthoringObservation {
  return {
    id: "screen",
    capturedAt: 1,
    evidenceIds: [],
    bounds: { width: 400, height: 800 },
    screen: { id: "screen", fingerprint: "screen", capturedAt: 1, source: "recording" },
    proof: {
      schemaVersion: 1,
      captureOrder: "concurrent",
      pixels: { status: "captured", capturedAt: 1, fingerprint: "screen" },
      semantics: { status: "current", capturedAt: 1, fingerprint: "screen" },
    },
    nodes: [
      {
        identifier: "android:id/title",
        label: "Internet",
        rect: { x: 20, y: 100, width: 200, height: 60 },
        enabled: true,
        type: "button",
      },
      {
        identifier: "android:id/title",
        label: "VPN",
        rect: { x: 20, y: 200, width: 200, height: 60 },
        enabled: true,
        type: "button",
      },
    ],
  };
}
test("a repeated Android resource id falls back to the unique visible label", () => {
  assert.deepEqual(semanticTargetForRecording({ point: { x: 70, y: 120 } }, observation()), {
    target: { label: "Internet" },
    name: "Internet",
  });
});
test("a unique identifier takes priority over localized text", () => {
  const capture = observation();
  capture.nodes![0]!.identifier = "app:id/internet";
  assert.deepEqual(semanticTargetForRecording({ point: { x: 70, y: 120 } }, capture)?.target, {
    identifier: "app:id/internet",
  });
});
test("a containing control identifier wins over its nested label and resolves after translation and movement", () => {
  const capture = observation();
  capture.nodes!.push({
    identifier: "app:id/open_internet",
    type: "button",
    enabled: true,
    rect: { x: 10, y: 90, width: 300, height: 90 },
  });
  const recorded = semanticTargetForRecording({ point: { x: 70, y: 120 } }, capture);
  assert.deepEqual(recorded?.target, { identifier: "app:id/open_internet" });
  const replay = resolveNamedControlOutcome(
    [
      {
        identifier: "app:id/open_internet",
        label: "インターネット",
        type: "button",
        enabled: true,
        rect: { x: 30, y: 250, width: 330, height: 110 },
      },
    ],
    recorded!.target,
  );
  assert.equal(replay.status, "resolved");
  if (replay.status === "resolved") {
    assert.equal(replay.resolution.method, "identifier");
    assert.deepEqual(replay.resolution.bounds, { x: 30, y: 250, width: 330, height: 110 });
  }
});
test("stale trees and ambiguous labels do not replace a coordinate click", () => {
  const capture = observation();
  capture.nodes![1]!.label = "Internet";
  assert.equal(semanticTargetForRecording({ point: { x: 70, y: 120 } }, capture), undefined);
  capture.proof!.semantics.status = "unavailable";
  assert.equal(semanticTargetForRecording({ point: { x: 70, y: 120 } }, capture), undefined);
});
