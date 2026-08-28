import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { deriveScrollSurfaceConfidence } from "./scroll-surface-confidence.js";
import type { ScrollSurveyFrame } from "./scrollable-survey-types.js";

function pixels(documentOffset: number): string {
  const image = new PNG({ width: 64, height: 160 });
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = (y + documentOffset + x * 3) % 255;
      image.data[offset + 1] = (y * 2 + documentOffset) % 255;
      image.data[offset + 2] = x * 2;
      image.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(image).toString("base64");
}

function frame(index: number, documentOffset: number): ScrollSurveyFrame {
  return {
    index,
    offsetY: documentOffset,
    appendedHeight: index === 0 ? 0 : documentOffset,
    screenshot: {
      base64: pixels(documentOffset),
      width: 64,
      height: 160,
      capturedAt: 10 + index,
    },
    snapshot: {
      serial: "android-1",
      capturedAt: 10 + index,
      bounds: { width: 64, height: 160 },
      inspectable: true,
      source: "sdk",
      interactive: [],
      nodes: [
        {
          identifier: "root",
          type: "android.widget.FrameLayout",
          rect: { x: 0, y: 0, width: 64, height: 160 },
          index: 0,
        },
        {
          identifier: "content-shell",
          type: "android.widget.FrameLayout",
          rect: { x: 0, y: 20, width: 64, height: 140 },
          index: 1,
          parentIndex: 0,
        },
        {
          identifier: "settings-list",
          type: "androidx.recyclerview.widget.RecyclerView",
          rect: { x: 0, y: 40, width: 64, height: 120 },
          index: 2,
          parentIndex: 1,
        },
        {
          identifier: "sticky-title",
          label: "Settings",
          type: "android.widget.TextView",
          rect: { x: 4, y: 22, width: 48, height: 14 },
          index: 3,
          parentIndex: 1,
        },
        {
          identifier: "moving-row",
          label: "Data controls",
          type: "android.widget.TextView",
          rect: { x: 4, y: 90 - documentOffset, width: 48, height: 14 },
          index: 4,
          parentIndex: 2,
        },
      ],
      screenIdentity: { fingerprint: "settings", nodes: [], volatileSignals: [] },
    },
  };
}

test("derives coverage, merge confidence, sticky regions, and nested container identity", () => {
  const model = deriveScrollSurfaceConfidence({
    status: "completed",
    reason: "end-of-content",
    frames: [frame(0, 0), frame(1, 40)],
    diagnosticFrames: [],
  });

  assert.equal(model.classification, "complete");
  assert.equal(model.documentExtent, "known");
  assert.equal(model.capturedPixels, 200);
  assert.deepEqual(
    model.coverage.map(({ startY, endY, state }) => ({ startY, endY, state })),
    [{ startY: 0, endY: 200, state: "captured" }],
  );
  assert.equal(model.mergeAnchors.length, 1);
  assert.equal(model.mergeAnchors[0]?.shiftY, 40);
  assert.equal(
    model.regions.find(({ kind }) => kind === "sticky")?.target?.identifier,
    "sticky-title",
  );
  assert.deepEqual(model.scrollContainer, {
    target: { identifier: "settings-list" },
    role: "androidx.recyclerview.widget.RecyclerView",
    viewportRect: { x: 0, y: 40, width: 64, height: 120 },
    nested: true,
    confidence: 1,
    sourceViewportIndexes: [0, 1],
  });
});

test("marks unstable evidence dynamic and leaves remaining coverage explicitly open", () => {
  const first = frame(0, 0);
  const diagnostic = frame(1, 40);
  const model = deriveScrollSurfaceConfidence({
    status: "stopped",
    reason: "seam-ambiguous",
    frames: [first],
    diagnosticFrames: [diagnostic],
  });

  assert.equal(model.classification, "dynamic");
  assert.equal(model.documentExtent, "open");
  assert.deepEqual(
    model.coverage.map(({ endY, state }) => ({ endY, state })),
    [
      { endY: 160, state: "dynamic" },
      { endY: null, state: "not-reached" },
    ],
  );
  assert.equal(
    model.regions.find(({ kind }) => kind === "dynamic")?.reason.includes("stable"),
    true,
  );
});

test("does not misrepresent unsupported inspection as a partial successful merge", () => {
  const model = deriveScrollSurfaceConfidence({
    status: "stopped",
    reason: "inspection-unavailable",
    frames: [frame(0, 0)],
    diagnosticFrames: [],
  });
  assert.equal(model.classification, "unsupported");
  assert.equal(model.confidence, 0.15);
  assert.equal(model.coverage.at(-1)?.state, "not-reached");
});
