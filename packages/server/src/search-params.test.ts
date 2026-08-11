import assert from "node:assert/strict";
import test from "node:test";
import { optionalFiniteSearchNumber } from "./search-params.js";

test("optionalFiniteSearchNumber keeps missing coordinates absent", () => {
  const params = new URLSearchParams();
  assert.equal(optionalFiniteSearchNumber(params, "previewX"), undefined);
  assert.equal(optionalFiniteSearchNumber(params, "previewY"), undefined);
});

test("optionalFiniteSearchNumber accepts explicit zero and finite coordinates", () => {
  const params = new URLSearchParams({ previewX: "0", previewY: "1275.5" });
  assert.equal(optionalFiniteSearchNumber(params, "previewX"), 0);
  assert.equal(optionalFiniteSearchNumber(params, "previewY"), 1275.5);
});

test("optionalFiniteSearchNumber rejects empty and invalid coordinates", () => {
  const params = new URLSearchParams({ previewX: " ", previewY: "left" });
  assert.equal(optionalFiniteSearchNumber(params, "previewX"), undefined);
  assert.equal(optionalFiniteSearchNumber(params, "previewY"), undefined);
});
