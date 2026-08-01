import assert from "node:assert/strict";
import test from "node:test";
import { journeyStartupDecision } from "./journey-startup";

test("startup waits for the definitive journey list before creating a canvas", () => {
  assert.deepEqual(
    journeyStartupDecision({ online: true, loaded: false, selectedId: null, journeys: [] }),
    { kind: "wait" },
  );
  assert.deepEqual(
    journeyStartupDecision({ online: true, loaded: true, selectedId: null, journeys: [] }),
    { kind: "create" },
  );
});

test("startup keeps a valid selection or restores the most recently edited journey", () => {
  const journeys = [
    { id: "older", source: "custom", updatedAt: 10 },
    { id: "latest", source: "custom", updatedAt: 20 },
  ];
  assert.deepEqual(
    journeyStartupDecision({ online: true, loaded: true, selectedId: "older", journeys }),
    { kind: "keep" },
  );
  assert.deepEqual(
    journeyStartupDecision({ online: true, loaded: true, selectedId: null, journeys }),
    { kind: "select", id: "latest" },
  );
});
