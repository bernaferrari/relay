import assert from "node:assert/strict";
import test from "node:test";
import { InvalidInteractInputError, normalizeInteractInput } from "./interact-input.js";

test("text-match accepts the neighbouring text field instead of crashing", () => {
  assert.deepEqual(normalizeInteractInput({ kind: "text-match", text: "Dismiss" }), {
    kind: "text-match",
    match: "Dismiss",
  });
});

test("a missing selector is a typed input error with an example", () => {
  assert.throws(
    () => normalizeInteractInput({ kind: "text-match" }),
    (error: unknown) =>
      error instanceof InvalidInteractInputError &&
      /needs "match".*Thought for/.test(error.message),
  );
  assert.throws(() => normalizeInteractInput({ kind: "type" }), InvalidInteractInputError);
  assert.throws(() => normalizeInteractInput({ kind: "replace", text: "x" }), /needs "target"/);
});

test("keys keep backspace, back, and hide-keyboard distinct", () => {
  assert.deepEqual(normalizeInteractInput({ kind: "key", key: "hide-keyboard" }), {
    kind: "key",
    key: "hide-keyboard",
  });
  assert.throws(() => normalizeInteractInput({ kind: "key", key: "escape" }), /hide-keyboard/);
});

test("type keeps an optional field target", () => {
  assert.deepEqual(
    normalizeInteractInput({ kind: "type", text: "hi", target: { identifier: "chat_text_input" } }),
    { kind: "type", text: "hi", target: { identifier: "chat_text_input" } },
  );
});
