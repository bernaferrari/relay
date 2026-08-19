import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_APP_MAP_CANVAS_STATE } from "./app-map-canvas-state";
import { appMapProjectionNormalizer } from "./app-map-projection-normalization";

test("normalizes impossible stacks through the canonical persistence boundary", () => {
  const projection = {
    ...EMPTY_APP_MAP_CANVAS_STATE,
    positions: { first: { x: 10, y: 20 }, second: { x: 10, y: 20 } },
  };
  const persisted: unknown[] = [];
  const normalize = appMapProjectionNormalizer(
    (value, settings) => {
      persisted.push({ value, settings });
    },
    () => EMPTY_APP_MAP_CANVAS_STATE.graph!,
  );

  const normalized = normalize(projection);

  assert.notDeepEqual(normalized.positions.first, normalized.positions.second);
  assert.deepEqual(persisted, [
    { value: normalized, settings: { before: projection, recordHistory: false } },
  ]);
  assert.equal(normalize(normalized), normalized);
  assert.equal(persisted.length, 1);
});
