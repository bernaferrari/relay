import assert from "node:assert/strict";
import test from "node:test";
import {
  frozenColdCoverageEffects,
  rejectForbiddenCoverageEffect,
} from "./campaign-recovery-effects.js";
import type { Recipe } from "./recipes.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import type { TestJob } from "./session.js";

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

test("dest-end coverage may freeze mobile-data and app.background primitives", () => {
  const graph = {
    check: recipe("check", [{ kind: "module", recipeId: "mobile-data" }]),
    "mobile-data": recipe("mobile-data", [
      { kind: "wait-for", target: { label: "Google search" } },
      { kind: "settings", setting: "mobile-data", state: "off" },
      { kind: "settings", setting: "mobile-data", state: "on" },
    ]),
    background: recipe("background", [
      { kind: "app", action: "background", app: "com.android.chrome", backgroundMs: 1_000 },
    ]),
    close: recipe("close", [{ kind: "app", action: "close", app: "com.android.chrome" }]),
  };
  assert.deepEqual(
    frozenColdCoverageEffects({
      graph,
      coverageRecipeId: "check",
      destEndRecipeIds: ["check", "mobile-data"],
    }),
    [],
  );
  assert.deepEqual(
    frozenColdCoverageEffects({
      graph,
      coverageRecipeId: "background",
      destEndRecipeIds: ["background"],
    }),
    [],
  );
  assert.equal(
    frozenColdCoverageEffects({ graph, coverageRecipeId: "mobile-data" }).some((effect) =>
      effect.reason.includes("settings"),
    ),
    true,
  );
  assert.equal(
    frozenColdCoverageEffects({
      graph,
      coverageRecipeId: "close",
      destEndRecipeIds: ["close"],
    }).some((effect) => effect.reason.includes("app close")),
    true,
  );
});

test("dest-end coverage does not reject mobile-data or app.background at runtime", () => {
  const job = { id: "dest-end", artifacts: [] } as unknown as TestJob;
  const ctx: RecipeStepContext = {
    log: () => {},
    job,
    moduleStack: ["android-mobile-data"],
    runtime: {
      campaignCoverageStarted: true,
      destEndRecipeIds: ["android-mobile-data"],
    },
  };
  rejectForbiddenCoverageEffect(
    { kind: "settings", setting: "mobile-data", state: "off" },
    ctx,
  );
  rejectForbiddenCoverageEffect(
    { kind: "app", action: "background", app: "com.android.chrome", backgroundMs: 1_000 },
    ctx,
  );
  assert.equal(
    job.artifacts.some((artifact) => artifact.kind === "campaign-effect-blocked"),
    false,
  );
  assert.throws(
    () =>
      rejectForbiddenCoverageEffect(
        { kind: "app", action: "close", app: "com.android.chrome" },
        ctx,
      ),
    /Campaign safety blocked app/u,
  );
});
