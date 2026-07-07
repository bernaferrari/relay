import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateRecipeSteps,
  listRecipes,
  readRecipe,
  saveRecipe,
  deleteRecipe,
  builtinRecipes,
  describeRecipeStep,
  glyphsForStep,
} from "./recipes.js";

// Isolate the on-disk store in a temp dir for the whole suite.
let tmp = "";
before(async () => {
  tmp = await mkdtemp(join(tmpdir(), "recipes-test-"));
  process.env.GROK_DEVICE_RECIPES_DIR = tmp;
});
after(async () => {
  delete process.env.GROK_DEVICE_RECIPES_DIR;
  await rm(tmp, { recursive: true, force: true });
});

describe("recipe store roundtrip", () => {
  it("save → list (custom after builtins) → read → delete → gone", async () => {
    const saved = await saveRecipe({
      title: "My Recipe",
      description: "a test",
      steps: [{ kind: "sleep", ms: 50 }],
    });
    assert.equal(saved.source, "custom");
    assert.match(saved.id, /^custom-my-recipe-/);
    assert.equal(saved.steps.length, 1);

    const all = await listRecipes();
    const builtinCount = builtinRecipes().length;
    assert.equal(all.length, builtinCount + 1);
    // builtins come first
    assert.equal(all[0]!.source, "builtin");
    assert.equal(all[0]!.id, "update-last-alpha");
    // custom appears after builtins
    const custom = all.find((r) => r.id === saved.id);
    assert.ok(custom, "custom recipe appears in list");
    assert.equal(custom!.source, "custom");

    const read = await readRecipe(saved.id);
    assert.ok(read, "readRecipe returns the recipe");
    assert.equal(read!.title, "My Recipe");
    assert.equal(read!.source, "custom");

    await deleteRecipe(saved.id);
    const gone = await readRecipe(saved.id);
    assert.equal(gone, null, "deleted recipe is gone");
  });

  it("reads builtins by id without touching disk", async () => {
    const logout = await readRecipe("logout");
    assert.ok(logout);
    assert.equal(logout!.source, "builtin");
    assert.deepEqual(logout!.steps, [{ kind: "flow", flow: "logout" }]);
  });
});

describe("builtin protection", () => {
  it("saveRecipe with a builtin id throws", async () => {
    await assert.rejects(
      () => saveRecipe({ id: "logout", title: "x", steps: [] }),
      /cannot overwrite builtin recipe: logout/,
    );
  });

  it("deleteRecipe with a builtin id throws", async () => {
    await assert.rejects(() => deleteRecipe("logout"), /cannot delete builtin recipe: logout/);
  });
});

describe("validateRecipeSteps", () => {
  it("accepts every step kind with valid fields", () => {
    const steps = [
      { kind: "tap", target: { ref: "@e1" } },
      { kind: "type", text: "hi", target: { label: "Field" } },
      { kind: "scroll", direction: "down", amount: 0.5 },
      { kind: "swipe", from: { x: 540, y: 1600 }, to: { x: 540, y: 600 }, durationMs: 300 },
      { kind: "key", key: "back" },
      { kind: "sleep", ms: 100 },
      { kind: "wait-for", target: { text: "Welcome" }, timeoutMs: 5000 },
      { kind: "pause", message: "enter 2FA code" },
      { kind: "screenshot", caption: "after login" },
      { kind: "flow", flow: "logout" },
    ];
    const out = validateRecipeSteps(steps);
    assert.equal(out.length, steps.length);
    assert.equal(out[0]!.kind, "tap");
    assert.equal(out[3]!.kind, "swipe");
    assert.equal(out[9]!.kind, "flow");
  });

  it("rejects tap with empty target, naming the step index", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "tap", target: {} }]),
      /step 1: tap requires target/,
    );
  });

  it("rejects wait-for with point-only target", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "wait-for", target: { point: { x: 1, y: 2 } } }]),
      /step 1: wait-for target must have ref\/label\/text/,
    );
  });

  it("rejects flow with an unknown action id", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "flow", flow: "nope" }]),
      /step 1: flow references unknown action id: nope/,
    );
  });

  it("rejects negative sleep", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "sleep", ms: -1 }]),
      /step 1: sleep ms must be >= 0/,
    );
  });

  it("rejects swipe missing from/to", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "swipe", to: { x: 1, y: 2 } }]),
      /step 1: swipe.from must be \{ x: number, y: number \}/,
    );
  });

  it("rejects swipe with non-numeric coordinates", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "swipe", from: { x: "a", y: 2 }, to: { x: 1, y: 2 } }]),
      /step 1: swipe.from must be \{ x: number, y: number \}/,
    );
  });

  it("rejects swipe with out-of-range durationMs", () => {
    assert.throws(
      () =>
        validateRecipeSteps([
          { kind: "swipe", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, durationMs: 10 },
        ]),
      /step 1: swipe.durationMs must be between 50 and 5000/,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          { kind: "swipe", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, durationMs: 9000 },
        ]),
      /step 1: swipe.durationMs must be between 50 and 5000/,
    );
  });

  it("accepts swipe without optional durationMs (defaults at runtime)", () => {
    const out = validateRecipeSteps([
      { kind: "swipe", from: { x: 540, y: 1600 }, to: { x: 540, y: 600 } },
    ]);
    assert.equal(out[0]!.kind, "swipe");
  });

  it("rejects non-array steps", () => {
    assert.throws(() => validateRecipeSteps({ not: "array" }), /steps must be an array/);
  });

  it("reports the index of the FIRST invalid step (1-based)", () => {
    assert.throws(
      () =>
        validateRecipeSteps([
          { kind: "sleep", ms: 10 },
          { kind: "sleep", ms: 20 },
          { kind: "tap", target: {} },
        ]),
      /step 3: tap requires target/,
    );
  });
});

describe("describeRecipeStep", () => {
  it("describes each kind", () => {
    assert.equal(describeRecipeStep({ kind: "tap", target: { ref: "@e5" } }), "Tap ref @e5");
    assert.equal(describeRecipeStep({ kind: "tap", target: { label: "Go" } }), 'Tap label "Go"');
    assert.equal(describeRecipeStep({ kind: "type", text: "x" }), "Type text");
    assert.equal(
      describeRecipeStep({ kind: "type", text: "x", target: { text: "Email" } }),
      'Type into text "Email"',
    );
    assert.equal(describeRecipeStep({ kind: "scroll", direction: "up" }), "Scroll up");
    assert.equal(
      describeRecipeStep({ kind: "swipe", from: { x: 540, y: 1600 }, to: { x: 540, y: 600 } }),
      "swipe ↑ 540,1600 → 540,600",
    );
    assert.equal(
      describeRecipeStep({ kind: "swipe", from: { x: 200, y: 600 }, to: { x: 800, y: 600 } }),
      "swipe → 200,600 → 800,600",
    );
    assert.equal(describeRecipeStep({ kind: "key", key: "home" }), "Key: home");
    assert.equal(describeRecipeStep({ kind: "sleep", ms: 250 }), "Sleep 250ms");
    assert.equal(describeRecipeStep({ kind: "screenshot" }), "Screenshot");
    assert.equal(
      describeRecipeStep({ kind: "screenshot", caption: "proof" }),
      "Screenshot · proof",
    );
    assert.equal(describeRecipeStep({ kind: "flow", flow: "logout" }), "Flow: logout");
    assert.equal(describeRecipeStep({ kind: "pause", message: "2FA" }), "Pause: 2FA");
    assert.equal(
      describeRecipeStep({ kind: "wait-for", target: { text: "Done" } }),
      'Wait for text "Done"',
    );
  });

  it("glyphsForStep maps each kind", () => {
    assert.deepEqual(glyphsForStep({ kind: "tap", target: { ref: "x" } }), ["tap"]);
    assert.deepEqual(glyphsForStep({ kind: "type", text: "x" }), ["type"]);
    assert.deepEqual(glyphsForStep({ kind: "scroll", direction: "down" }), ["swipe"]);
    assert.deepEqual(glyphsForStep({ kind: "swipe", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }), [
      "swipe",
    ]);
    assert.deepEqual(glyphsForStep({ kind: "key", key: "back" }), ["tap"]);
    assert.deepEqual(glyphsForStep({ kind: "sleep", ms: 1 }), ["wait"]);
    assert.deepEqual(glyphsForStep({ kind: "wait-for", target: { text: "x" } }), ["wait"]);
    assert.deepEqual(glyphsForStep({ kind: "pause", message: "x" }), ["wait"]);
    assert.deepEqual(glyphsForStep({ kind: "screenshot" }), ["shot"]);
    assert.deepEqual(glyphsForStep({ kind: "flow", flow: "logout" }), ["store"]);
  });
});
