import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_APP_MAP_CANVAS_STATE } from "./app-map-canvas-state";

test("new App Map canvas state starts empty with no renderer-owned Takes", () => {
  assert.equal(EMPTY_APP_MAP_CANVAS_STATE.graph?.screens.length, 0);
  assert.equal(EMPTY_APP_MAP_CANVAS_STATE.graph?.transitions.length, 0);
  assert.equal(EMPTY_APP_MAP_CANVAS_STATE.takes?.length, 0);
});
