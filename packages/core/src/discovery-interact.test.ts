import assert from "node:assert/strict";
import test from "node:test";
import { controlToInteractInput, discoveryInteraction } from "./discovery-interact.js";

test("discovery controls compile to identifier-first interact input", () => {
  assert.deepEqual(
    controlToInteractInput({
      id: "1",
      label: "Language",
      target: { identifier: "language-row" },
    }),
    { kind: "identifier", identifier: "language-row" },
  );
  assert.deepEqual(discoveryInteraction({ kind: "key", key: "back" }), {
    kind: "back",
    label: "Back",
  });
});
