import assert from "node:assert/strict";
import test from "node:test";
import {
  capturePolicyForLens,
  combineIdFor,
  combineLensName,
  isCombineLensInput,
} from "./app-map-combine-id.js";

test("Combine ids stay stable slugs of Variable then Test ids", () => {
  assert.equal(combineIdFor(["language"], ["settings-tour"]), "matrix-language-to-settings-tour");
  assert.equal(
    combineIdFor(["Language", "Theme"], ["Smoke Test"]),
    "matrix-language-theme-to-smoke-test",
  );
  assert.equal(combineIdFor([], []), "matrix-to");
});

test("visual and smoke map onto existing capture policies", () => {
  assert.deepEqual(capturePolicyForLens("visual"), { mode: "every-screen" });
  assert.deepEqual(capturePolicyForLens("smoke"), { mode: "failures-only" });
  assert.deepEqual(capturePolicyForLens("every-screen"), { mode: "every-screen" });
  assert.deepEqual(capturePolicyForLens("final-screen"), { mode: "final-screen" });
  assert.equal(combineLensName("every-screen"), "visual");
  assert.equal(combineLensName("failures-only"), "smoke");
  assert.equal(isCombineLensInput("visual"), true);
  assert.equal(isCombineLensInput("checkpoints"), false);
});
