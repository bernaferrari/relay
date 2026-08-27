import assert from "node:assert/strict";
import test from "node:test";
import { appMapOpeningMode, appMapStartupDecision } from "./app-map-startup";

test("startup waits for the canonical map list before opening a local blank canvas", () => {
  assert.deepEqual(
    appMapStartupDecision({ online: true, loaded: false, selectedId: null, maps: [] }),
    { kind: "wait" },
  );
  assert.deepEqual(
    appMapStartupDecision({ online: true, loaded: true, selectedId: null, maps: [] }),
    { kind: "blank" },
  );
});

test("startup keeps a valid map or restores the most recently edited map", () => {
  const maps = [
    { id: "older", updatedAt: 10 },
    { id: "latest", updatedAt: 20 },
  ];
  assert.deepEqual(
    appMapStartupDecision({ online: true, loaded: true, selectedId: "older", maps }),
    { kind: "keep", mode: "test" },
  );
  assert.deepEqual(appMapStartupDecision({ online: true, loaded: true, selectedId: null, maps }), {
    kind: "select",
    id: "latest",
    mode: "test",
  });
});

test("every saved map opens in Test while Map remains an optional topology view", () => {
  const map = { id: "mapped", updatedAt: 10, tests: { checkout: {} } };
  assert.equal(appMapOpeningMode(map), "test");
  assert.deepEqual(
    appMapStartupDecision({ online: true, loaded: true, selectedId: map.id, maps: [map] }),
    { kind: "keep", mode: "test" },
  );
  assert.equal(appMapOpeningMode({ id: "new", updatedAt: 20 }), "test");
});
