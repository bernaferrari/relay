import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasGraph, CanvasTransition, RecipeStep } from "@relay/protocol";
import { appMapRunReadiness } from "./app-map-run-readiness";

const at = 1;

// One readiness rule is shared by canvas controls and execution.
const screen = (id: string) => ({ id, title: id, createdAt: at, updatedAt: at });
const connection = (
  id: string,
  fromScreenId: string,
  to: string,
  overrides: Partial<CanvasTransition> = {},
): CanvasTransition => ({
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
const graph = (transitions: CanvasTransition[]): CanvasGraph => ({
  schemaVersion: 1,
  screens: [screen("start"), screen("a"), screen("b")],
  transitions,
  flows: [{ id: "main", name: "Main", screenId: "start", createdAt: at, updatedAt: at }],
});

test("allows a verified automatic connection with no recipe actions", () => {
  const result = appMapRunReadiness({
    graph: graph([connection("automatic", "start", "a", { mode: "automatic" })]),
    recipeSteps: [],
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.transitionPath, ["automatic"]);
});

test("blocks a captured connection until it is approved", () => {
  const result = appMapRunReadiness({
    graph: graph([connection("tap", "start", "a", { review: { status: "draft", updatedAt: at } })]),
    recipeSteps: [],
  });
  assert.equal(result.ready, false);
  assert.match(result.reason, /approve/);
});

test("asks for a destination when the graph branches", () => {
  const result = appMapRunReadiness({
    graph: graph([connection("left", "start", "a"), connection("right", "start", "b")]),
    recipeSteps: [],
  });
  assert.equal(result.ready, false);
  assert.match(result.reason, /destination/);
});

test("runs only to the selected destination on a branch", () => {
  const result = appMapRunReadiness({
    graph: graph([connection("left", "start", "a"), connection("right", "start", "b")]),
    recipeSteps: [],
    selection: { screenId: "b" },
  });
  assert.equal(result.ready, true);
  assert.equal(result.label, "Run to here");
  assert.deepEqual(result.transitionPath, ["right"]);
});

test("blocks when a connection references a missing recipe action", () => {
  const result = appMapRunReadiness({
    graph: graph([connection("tap", "start", "a", { stepIds: ["missing"] })]),
    recipeSteps: [] as RecipeStep[],
  });
  assert.equal(result.ready, false);
  assert.match(result.reason, /missing/);
});

test("requires an explicit destination for an unbounded loop", () => {
  const result = appMapRunReadiness({
    graph: graph([
      connection("out", "start", "a"),
      connection("back", "a", "start", { kind: "return" }),
    ]),
    recipeSteps: [],
  });
  assert.equal(result.ready, false);
  assert.match(result.reason, /loop/);
});
