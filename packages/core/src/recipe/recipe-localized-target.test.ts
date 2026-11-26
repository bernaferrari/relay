import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocalizedRecipeTarget } from "./recipe-localized-target.js";

const localization = {
  packageName: "com.example.app",
  locale: "ja",
  translate: (text: string) =>
    text === "Network & internet" ? "ネットワークとインターネット" : undefined,
};
const node = {
  label: "ネットワークとインターネット",
  type: "Button",
  hittable: true,
  bundleId: "com.example.app",
  rect: { x: 30, y: 240, width: 280, height: 80 },
};

test("English instruction resolves the current Japanese button and its reflowed bounds", () => {
  const result = resolveLocalizedRecipeTarget(
    [node],
    { label: "Network & internet" },
    localization,
  );
  assert.equal(result?.outcome.status, "resolved");
  if (result?.outcome.status === "resolved")
    assert.deepEqual(result.outcome.resolution.point, { x: 170, y: 280 });
  assert.equal(result?.target.label, node.label);
  assert.equal(node.label, "ネットワークとインターネット", "retained evidence stays Japanese");
});

test("does not turn ambiguous translated buttons into a coordinate fallback", () => {
  const result = resolveLocalizedRecipeTarget(
    [node, { ...node, rect: { ...node.rect, y: 460 } }],
    {
      label: "Network & internet",
      point: { x: 170, y: 280 },
    },
    localization,
  );
  assert.equal(result?.outcome.status, "ambiguous");
  assert.equal(result?.target.point, undefined);
});

test("does not use another application's matching text", () => {
  const result = resolveLocalizedRecipeTarget(
    [{ ...node, bundleId: "com.other.app" }],
    { label: "Network & internet" },
    localization,
  );
  assert.equal(result?.outcome.status, "absent");
});

test("unavailable translations preserve failure instead of guessing", () => {
  assert.equal(
    resolveLocalizedRecipeTarget([node], { label: "Delete everything" }, localization),
    undefined,
  );
});
