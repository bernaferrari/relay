import assert from "node:assert/strict";
import test from "node:test";
import type { LogicalScrollSurface, RecipeStep } from "./index.js";

test("full-surface semantic indexes are a derived executable protocol contract", () => {
  const semanticIndex: NonNullable<LogicalScrollSurface["semanticIndex"]> = {
    schemaVersion: 1,
    documentHeight: 3_600,
    viewportHeight: 900,
    anchors: [
      { order: 0, documentY: 180, target: { identifier: "appearance" } },
      { order: 1, documentY: 2_940, target: { identifier: "kids-mode" } },
    ],
  };
  const step: Extract<RecipeStep, { kind: "reveal" }> = {
    kind: "reveal",
    target: { identifier: "kids-mode" },
    direction: "auto",
    navigation: [
      {
        ...semanticIndex,
        surfaceId: "settings-surface",
        captureId: "settings-en-r1",
        targetOrder: 1,
        targetDocumentY: 2_940,
      },
    ],
  };

  assert.deepEqual(structuredClone(step).navigation?.[0]?.anchors, semanticIndex.anchors);
});

test("full-surface confidence keeps unknown coverage explicit and source-bound", () => {
  const confidence: NonNullable<LogicalScrollSurface["confidenceModel"]> = {
    schemaVersion: 1,
    classification: "partial",
    confidence: 0.72,
    capturedPixels: 1_820,
    documentExtent: "open",
    coverage: [
      {
        startY: 0,
        endY: 1_820,
        state: "captured",
        confidence: 1,
        sourceViewportIndexes: [0, 1, 2],
      },
      {
        startY: 1_820,
        endY: null,
        state: "not-reached",
        confidence: 1,
        sourceViewportIndexes: [],
      },
    ],
    mergeAnchors: [],
    regions: [],
  };

  assert.equal(structuredClone(confidence).coverage.at(-1)?.endY, null);
  assert.equal(confidence.classification, "partial");
});
