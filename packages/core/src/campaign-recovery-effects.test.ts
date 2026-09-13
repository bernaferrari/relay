import assert from "node:assert/strict";
import test from "node:test";
import { frozenColdCoverageEffects } from "./campaign-recovery-effects.js";
import type { Recipe } from "./recipes.js";

function recipe(id: string, steps: Recipe["steps"]): Recipe {
  return { id, title: id, source: "custom", steps, createdAt: 1, updatedAt: 1 };
}

test("nested coverage modules freeze cold effects before runtime", () => {
  const graph = {
    check: recipe("check", [{ kind: "module", recipeId: "hidden" }]),
    hidden: recipe("hidden", [{ kind: "app", action: "close", app: "ai.x.grok" }]),
    cold: recipe("cold", [{ kind: "app", action: "open", app: "ai.x.grok" }]),
  };
  const effects = frozenColdCoverageEffects({
    graph,
    coverageRecipeId: "check",
    excludedRecipeIds: ["cold"],
  });
  assert.equal(
    effects.some((effect) => effect.recipeId === "hidden"),
    true,
  );
  assert.equal(
    effects.some((effect) => effect.recipeId === "cold"),
    false,
  );
});

test("omitted relaunch on app open is warm during coverage", () => {
  const graph = {
    check: recipe("check", [{ kind: "app", action: "open", app: "ai.x.grok" }]),
  };
  assert.deepEqual(frozenColdCoverageEffects({ graph, coverageRecipeId: "check" }), []);
});

test("product file upload stays in coverage instead of a cold device reset", () => {
  const graph = {
    check: recipe("check", [
      { kind: "upload", file: "tests/fixtures/sample.pdf", target: { label: "Upload a file" } },
    ]),
    offline: recipe("offline", [{ kind: "offline", state: "on" }]),
  };
  assert.deepEqual(frozenColdCoverageEffects({ graph, coverageRecipeId: "check" }), []);
  assert.equal(
    frozenColdCoverageEffects({ graph, coverageRecipeId: "offline" }).some((effect) =>
      effect.reason.includes("offline"),
    ),
    true,
  );
});
