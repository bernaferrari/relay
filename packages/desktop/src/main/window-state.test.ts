import assert from "node:assert/strict";
import test from "node:test";
import { clampWindowBounds, parseWindowState } from "./window-state.ts";

test("clamps saved bounds into a current display when the original monitor is gone", () => {
  assert.deepEqual(
    clampWindowBounds({ x: 3_000, y: 100, width: 1_000, height: 700 }, [
      { x: 0, y: 0, width: 1_920, height: 1_040 },
    ]),
    { x: 920, y: 100, width: 1_000, height: 700 },
  );
});

test("keeps saved bounds on an existing secondary display", () => {
  const bounds = { x: -1_700, y: 80, width: 1_000, height: 700 };
  assert.deepEqual(
    clampWindowBounds(bounds, [
      { x: 0, y: 0, width: 1_920, height: 1_040 },
      { x: -1_920, y: 0, width: 1_920, height: 1_040 },
    ]),
    bounds,
  );
});

test("shrinks oversized saved bounds to fit the display work area", () => {
  assert.deepEqual(
    clampWindowBounds({ x: -200, y: -100, width: 1_800, height: 1_200 }, [
      { x: 0, y: 24, width: 1_440, height: 876 },
    ]),
    { x: 0, y: 24, width: 1_440, height: 876 },
  );
});

test("parses only finite, positive versioned window state", () => {
  assert.deepEqual(
    parseWindowState(
      JSON.stringify({
        version: 1,
        bounds: { x: 120, y: 80, width: 1_100, height: 760 },
        maximized: true,
      }),
    ),
    {
      version: 1,
      bounds: { x: 120, y: 80, width: 1_100, height: 760 },
      maximized: true,
    },
  );
  assert.equal(
    parseWindowState(
      JSON.stringify({
        version: 1,
        bounds: { x: 120, y: 80, width: 0, height: 760 },
        maximized: false,
      }),
    ),
    null,
  );
  assert.equal(parseWindowState("not json"), null);
});
