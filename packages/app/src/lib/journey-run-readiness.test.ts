import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyGraph, JourneyGraphTransition, RecipeStep } from "@relay/protocol";
import { journeyRunReadiness } from "./journey-run-readiness";

const at = 1;
const screen = (id: string) => ({ id, title: id, createdAt: at, updatedAt: at });
const connection = (
  id: string,
  fromScreenId: string,
  to: string,
  overrides: Partial<JourneyGraphTransition> = {},
): JourneyGraphTransition => ({
  id,
  fromScreenId,
  destination: { kind: "screen", screenId: to },
  stepIds: [],
  state: "recorded",
  kind: "forward",
  review: { status: "verified", updatedAt: at, verifiedAt: at },
  createdAt: at,
  updatedAt: at,
  ...overrides,
});
const graph = (transitions: JourneyGraphTransition[]): JourneyGraph => ({
  schemaVersion: 1,
  screens: [screen("start"), screen("a"), screen("b")],
  transitions,
  flows: [{ id: "main", name: "Main", screenId: "start", createdAt: at, updatedAt: at }],
});

test("allows a verified automatic connection with no recipe actions", () => {
  const result = journeyRunReadiness({
    graph: graph([connection("automatic", "start", "a", { mode: "automatic" })]),
    recipeSteps: [],
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.transitionPath, ["automatic"]);
});

test("blocks a captured connection until it is approved", () => {
  const result = journeyRunReadiness({
    graph: graph([connection("tap", "start", "a", { review: { status: "draft", updatedAt: at } })]),
    recipeSteps: [],
  });
  assert.equal(result.ready, false);
  assert.match(result.reason, /approve/);
});

test("asks for a destination when the graph branches", () => {
  const result = journeyRunReadiness({
    graph: graph([connection("left", "start", "a"), connection("right", "start", "b")]),
    recipeSteps: [],
  });
  assert.equal(result.ready, false);
  assert.match(result.reason, /destination/);
});

test("runs only to the selected destination on a branch", () => {
  const result = journeyRunReadiness({
    graph: graph([connection("left", "start", "a"), connection("right", "start", "b")]),
    recipeSteps: [],
    selection: { screenId: "b" },
  });
  assert.equal(result.ready, true);
  assert.equal(result.label, "Run to here");
  assert.deepEqual(result.transitionPath, ["right"]);
});

test("blocks when a connection references a missing recipe action", () => {
  const result = journeyRunReadiness({
    graph: graph([connection("tap", "start", "a", { stepIds: ["missing"] })]),
    recipeSteps: [] as RecipeStep[],
  });
  assert.equal(result.ready, false);
  assert.match(result.reason, /missing/);
});

test("requires an explicit destination for an unbounded loop", () => {
  const result = journeyRunReadiness({
    graph: graph([
      connection("out", "start", "a"),
      connection("back", "a", "start", { kind: "return" }),
    ]),
    recipeSteps: [],
  });
  assert.equal(result.ready, false);
  assert.match(result.reason, /loop/);
});
