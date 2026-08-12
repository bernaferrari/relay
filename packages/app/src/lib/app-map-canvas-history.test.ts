import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "solid-js";
import { createAppMapCanvasHistory } from "./app-map-canvas-history";

test("canvas history moves entries atomically between undo and redo", () => {
  createRoot((dispose) => {
    const history = createAppMapCanvasHistory<number, { screenshotUri: string }>();
    history.record({ before: 1, after: 2, at: 1 });
    history.record({
      before: 2,
      after: 3,
      at: 2,
      restore: { screenshotUri: "relay-evidence://captures/settings.png" },
    });

    assert.deepEqual(history.depth(), { undo: 2, redo: 0 });
    assert.deepEqual(history.undo(), {
      before: 2,
      after: 3,
      at: 2,
      restore: { screenshotUri: "relay-evidence://captures/settings.png" },
    });
    assert.deepEqual(history.depth(), { undo: 1, redo: 1 });
    assert.deepEqual(history.redo(), {
      before: 2,
      after: 3,
      at: 2,
      restore: { screenshotUri: "relay-evidence://captures/settings.png" },
    });
    assert.deepEqual(history.depth(), { undo: 2, redo: 0 });
    dispose();
  });
});

test("record clears redo and enforces the configured history limit", () => {
  createRoot((dispose) => {
    const history = createAppMapCanvasHistory<number>(2);
    history.record({ before: 0, after: 1, at: 1 });
    history.record({ before: 1, after: 2, at: 2 });
    history.undo();
    history.record({ before: 1, after: 3, at: 3 });
    history.record({ before: 3, after: 4, at: 4 });

    assert.deepEqual(history.depth(), { undo: 2, redo: 0 });
    assert.equal(history.undo()?.before, 3);
    assert.equal(history.undo()?.before, 1);
    assert.equal(history.undo(), undefined);
    history.clear();
    assert.deepEqual(history.depth(), { undo: 0, redo: 0 });
    dispose();
  });
});
