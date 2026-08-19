import assert from "node:assert/strict";
import test from "node:test";
import { plural, pluralNoun } from "./plural";

test("one of a thing is singular", () => {
  assert.equal(plural(1, "language"), "1 language");
  assert.equal(plural(1, "screen"), "1 screen");
});

test("none and many take the plural", () => {
  assert.equal(plural(0, "language"), "0 languages");
  assert.equal(plural(43, "language"), "43 languages");
});

test("an irregular plural is given explicitly", () => {
  assert.equal(plural(1, "entry", "entries"), "1 entry");
  assert.equal(plural(2, "entry", "entries"), "2 entries");
});

test("the noun can be formatted apart from its count", () => {
  assert.equal(pluralNoun(1, "Test"), "Test");
  assert.equal(pluralNoun(3, "Test"), "Tests");
});
