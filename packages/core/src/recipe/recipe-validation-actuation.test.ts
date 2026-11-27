import assert from "node:assert/strict";
import test from "node:test";
import { validateRecipeSteps } from "./recipes.js";
import { describeRecipeStep } from "./recipe-presentation.js";
import { recipeStepPlatformBlocker } from "@relay/protocol";

test("hover, select, and press-key steps parse with their contracts", () => {
  const steps = validateRecipeSteps([
    { kind: "hover", target: { label: "Menu" } },
    { kind: "select", target: { identifier: "country" }, option: "Canada" },
    { kind: "press-key", key: "k", modifiers: ["controlOrMeta"] },
    { kind: "scroll", direction: "left" },
  ]);
  assert.equal(steps.length, 4);
  assert.equal(steps[0]!.kind, "hover");
  assert.equal(steps[1]!.kind, "select");
  assert.equal(steps[2]!.kind, "press-key");
  assert.equal(steps[3]!.kind === "scroll" && steps[3]!.direction, "left");
});

test("actuation steps reject malformed input rather than guessing", () => {
  assert.throws(
    () => validateRecipeSteps([{ kind: "hover", target: {} }]),
    /hover requires target/u,
  );
  assert.throws(
    () => validateRecipeSteps([{ kind: "select", target: { label: "x" } }]),
    /select requires option/u,
  );
  assert.throws(
    () => validateRecipeSteps([{ kind: "select", target: { point: { x: 1, y: 1 } }, option: "a" }]),
    /semantic identifier or label/u,
  );
  assert.throws(
    () => validateRecipeSteps([{ kind: "press-key", key: "q" }]),
    /press-key requires key/u,
  );
  assert.throws(
    () => validateRecipeSteps([{ kind: "press-key", key: "enter", modifiers: ["hyper"] }]),
    /modifiers must be/u,
  );
  assert.throws(
    () => validateRecipeSteps([{ kind: "scroll", direction: "diagonal" }]),
    /scroll requires direction/u,
  );
});

test("browser-only actuation is blocked on native platforms and admitted on browser", () => {
  const blocker = (step: object, platform: "ios" | "android" | "browser") =>
    recipeStepPlatformBlocker(step as never, platform);
  assert.match(blocker({ kind: "hover", target: { label: "x" } }, "ios") ?? "", /browser/u);
  assert.match(blocker({ kind: "press-key", key: "enter" }, "android") ?? "", /browser/u);
  assert.match(blocker({ kind: "scroll", direction: "left" }, "android") ?? "", /browser/u);
  assert.equal(blocker({ kind: "hover", target: { label: "x" } }, "browser"), undefined);
  assert.equal(blocker({ kind: "press-key", key: "enter" }, "browser"), undefined);
  assert.equal(blocker({ kind: "scroll", direction: "left" }, "browser"), undefined);
  assert.equal(blocker({ kind: "scroll", direction: "down" }, "android"), undefined);
});

test("new step kinds describe themselves honestly", () => {
  assert.equal(
    describeRecipeStep({ kind: "hover", target: { label: "Menu" } }),
    'Hover label "Menu"',
  );
  assert.equal(
    describeRecipeStep({ kind: "select", target: { identifier: "country" }, option: "Canada" }),
    'Select "Canada" in identifier country',
  );
  assert.equal(
    describeRecipeStep({ kind: "press-key", key: "k", modifiers: ["controlOrMeta"] }),
    "Press controlOrMeta+k",
  );
});
