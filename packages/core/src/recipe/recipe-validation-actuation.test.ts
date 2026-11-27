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

test("drag, upload-file, and switch-tab parse with their contracts", () => {
  const steps = validateRecipeSteps([
    { kind: "drag", from: { label: "Card" }, to: { identifier: "column-done" } },
    { kind: "drag", from: { point: { x: 10, y: 20 } }, to: { point: { x: 30, y: 40 } } },
    { kind: "upload-file", file: "fixtures/avatar.png", target: { label: "Avatar" } },
    { kind: "upload-file", file: "fixtures/avatar.png" },
    { kind: "switch-tab", index: 1 },
    { kind: "switch-tab", url: "checkout" },
  ]);
  assert.equal(steps.length, 6);
  assert.equal(steps[0]!.kind, "drag");
  assert.equal(steps[2]!.kind, "upload-file");
  assert.equal(steps[4]!.kind, "switch-tab");
  assert.equal(steps[4]!.kind === "switch-tab" && steps[4]!.index, 1);
  assert.equal(steps[5]!.kind === "switch-tab" && steps[5]!.url, "checkout");
});

test("drag rejects ends the browser locator contract cannot prove", () => {
  assert.throws(
    () => validateRecipeSteps([{ kind: "drag", from: { text: "Card" }, to: { label: "x" } }]),
    /identifier\/label\/point/u,
  );
  assert.throws(
    () => validateRecipeSteps([{ kind: "drag", from: { ref: "e5" }, to: { label: "x" } }]),
    /identifier\/label\/point/u,
  );
  assert.throws(
    () =>
      validateRecipeSteps([
        {
          kind: "drag",
          from: {
            point: { x: 1, y: 2, relativeTo: { target: { label: "x" }, xRatio: 0.5, yRatio: 0.5 } },
          },
          to: { label: "y" },
        },
      ]),
    /identifier\/label\/point/u,
  );
  assert.throws(
    () => validateRecipeSteps([{ kind: "drag", from: { label: "x" } }]),
    /to must be an object/u,
  );
});

test("upload-file rejects empty and absolute file references", () => {
  assert.throws(() => validateRecipeSteps([{ kind: "upload-file" }]), /upload-file requires file/u);
  assert.throws(
    () => validateRecipeSteps([{ kind: "upload-file", file: "  " }]),
    /upload-file requires file/u,
  );
  assert.throws(
    () => validateRecipeSteps([{ kind: "upload-file", file: "/etc/passwd" }]),
    /workspace-relative/u,
  );
  assert.throws(
    () => validateRecipeSteps([{ kind: "upload-file", file: "a.png", target: { text: "x" } }]),
    /identifier\/label\/point/u,
  );
});

test("switch-tab requires exactly one honest selector", () => {
  assert.throws(
    () => validateRecipeSteps([{ kind: "switch-tab" }]),
    /exactly one of index or url/u,
  );
  assert.throws(
    () => validateRecipeSteps([{ kind: "switch-tab", index: 0, url: "x" }]),
    /exactly one of index or url/u,
  );
  assert.throws(
    () => validateRecipeSteps([{ kind: "switch-tab", index: -1 }]),
    /non-negative integer/u,
  );
  assert.throws(
    () => validateRecipeSteps([{ kind: "switch-tab", index: 1.5 }]),
    /non-negative integer/u,
  );
  assert.throws(() => validateRecipeSteps([{ kind: "switch-tab", url: " " }]), /non-empty string/u);
});

test("drag, upload-file, and switch-tab fail closed on native platforms", () => {
  const blocker = (step: object, platform: "ios" | "android" | "browser") =>
    recipeStepPlatformBlocker(step as never, platform);
  const drag = { kind: "drag", from: { label: "a" }, to: { label: "b" } };
  const uploadFile = { kind: "upload-file", file: "fixtures/a.png" };
  const switchTab = { kind: "switch-tab", index: 0 };
  for (const platform of ["ios", "android"] as const) {
    assert.match(blocker(drag, platform) ?? "", /browser/u, `drag on ${platform}`);
    assert.match(blocker(uploadFile, platform) ?? "", /browser/u, `upload-file on ${platform}`);
    assert.match(blocker(switchTab, platform) ?? "", /browser/u, `switch-tab on ${platform}`);
  }
  assert.equal(blocker(drag, "browser"), undefined);
  assert.equal(blocker(uploadFile, "browser"), undefined);
  assert.equal(blocker(switchTab, "browser"), undefined);
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
  assert.equal(
    describeRecipeStep({ kind: "drag", from: { label: "Card" }, to: { identifier: "done" } }),
    'Drag label "Card" to identifier done',
  );
  assert.equal(
    describeRecipeStep({
      kind: "upload-file",
      file: "fixtures/a.png",
      target: { label: "Avatar" },
    }),
    'Attach fixtures/a.png to label "Avatar"',
  );
  assert.equal(
    describeRecipeStep({ kind: "upload-file", file: "fixtures/a.png" }),
    "Attach fixtures/a.png",
  );
  assert.equal(describeRecipeStep({ kind: "switch-tab", index: 1 }), "Switch to browser tab 2");
  assert.equal(
    describeRecipeStep({ kind: "switch-tab", url: "checkout" }),
    'Switch to browser tab matching "checkout"',
  );
});
