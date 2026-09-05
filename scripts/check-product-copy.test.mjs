import assert from "node:assert/strict";
import test from "node:test";
import { findForbiddenPrimaryCopy } from "./check-product-copy.mjs";

test("rejects engine vocabulary in ordinary JSX copy", () => {
  assert.deepEqual(
    findForbiddenPrimaryCopy("<p>Choose a Variable before you run.</p>", "routes/home-page.tsx"),
    ["Variable"],
  );
  assert.deepEqual(findForbiddenPrimaryCopy("<h1>Variable</h1>", "routes/devices-page.tsx"), [
    "Variable",
  ]);
});

test("allows documented Advanced/Audit technical surfaces", () => {
  assert.deepEqual(
    findForbiddenPrimaryCopy(
      "<p>Inspect the Variable binding.</p>",
      "components/test-editor-step.tsx",
    ),
    [],
  );
  assert.deepEqual(
    findForbiddenPrimaryCopy("<p>Run this Test on a Device.</p>", "routes/home-page.tsx"),
    [],
  );
});
