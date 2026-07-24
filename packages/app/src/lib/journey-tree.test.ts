import test from "node:test";
import assert from "node:assert/strict";
import type { RecipeStep } from "./api-types";
import { buildJourneyTree, screenKeyForStep } from "./journey-tree";

const tap = (label: string, screen: string): RecipeStep =>
  ({
    kind: "tap",
    target: { label },
    evidence: {
      id: `evidence-${screen}-${label}`,
      recordedAt: 1,
      screenshot: {
        recipeId: "test",
        id: `shot-${screen}-${label}`,
        capturedAt: 1,
        mime: "image/png",
        sha256: screen.padEnd(64, "0"),
      },
    },
  }) as RecipeStep;

test("a repeated captured screen becomes one node with a return path", () => {
  const tree = buildJourneyTree([
    tap("Settings", "home"),
    tap("Notifications", "settings"),
    { kind: "key", key: "back", evidence: tap("", "notifications").evidence } as RecipeStep,
    tap("Privacy", "settings"),
  ]);

  assert.equal(tree.nodes.length, 3);
  assert.equal(tree.hasScreenIdentity, true);
  assert.equal(tree.nodes.find((node) => node.title === "Settings")?.stepIndexes.length, 2);
  assert.ok(tree.edges.some((edge) => edge.label === "Back" && edge.kind === "return"));
});

test("a stable UI tree folds older screenshot-less recordings", () => {
  const first = {
    kind: "tap",
    target: { label: "Settings" },
    evidence: {
      id: "a",
      recordedAt: 1,
      nodes: [{ role: "button", label: "General" }],
    },
  } as RecipeStep;
  const second = {
    ...first,
    evidence: { ...first.evidence!, id: "b", recordedAt: 2 },
  } as RecipeStep;
  assert.equal(screenKeyForStep(first, 0), screenKeyForStep(second, 1));
});

test("marks recordings without a durable screen identity as an ordered action list", () => {
  const tree = buildJourneyTree([
    { kind: "tap", target: { point: { x: 12, y: 18 } } } as RecipeStep,
    { kind: "type", text: "hello" } as RecipeStep,
  ]);

  assert.equal(tree.hasScreenIdentity, false);
  assert.equal(tree.nodes.length, 2);
});
