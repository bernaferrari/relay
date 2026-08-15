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
