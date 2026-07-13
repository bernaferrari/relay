import assert from "node:assert/strict";
import test from "node:test";
import { buildTestAtlas } from "./atlas.js";
import type { Recipe } from "./recipes.js";

test("atlas maps dependencies, capabilities, and duplicate recipes", () => {
  const base = { source: "custom" as const, description: "", createdAt: 1, updatedAt: 1 };
  const recipes: Recipe[] = [
    {
      ...base,
      id: "login",
      title: "Login",
      steps: [{ kind: "tap", target: { label: "Sign in" } }],
    },
    {
      ...base,
      id: "login-copy",
      title: "Login copy",
      steps: [{ kind: "tap", target: { label: "Sign in" } }],
    },
    {
      ...base,
      id: "smoke",
      title: "Smoke",
      steps: [
        { kind: "module", recipeId: "login" },
        { kind: "device", action: "lock" },
      ],
    },
  ];
  const atlas = buildTestAtlas(recipes);
  assert.equal(atlas.duplicateClusters[0]?.savings, 1);
  assert.deepEqual(atlas.edges[0], { from: "smoke", to: "login", kind: "reuse", label: "Reuses" });
  assert.ok(atlas.coverage.some((item) => item.capability === "Lock screen & keyboard"));
});
