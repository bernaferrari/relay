import assert from "node:assert/strict";
import test from "node:test";
import { appMapStartupDecision } from "./app-map-startup";

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
    { kind: "keep" },
  );
  assert.deepEqual(appMapStartupDecision({ online: true, loaded: true, selectedId: null, maps }), {
    kind: "select",
    id: "latest",
  });
});
