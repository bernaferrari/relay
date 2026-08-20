import assert from "node:assert/strict";
import test from "node:test";
import { bindingForCell, upsertCellRuntimeProfile } from "./app-map-combine-profiles";

test("profile binding is explicit per Test × values and never inferred", () => {
  const first = upsertCellRuntimeProfile([], {
    testId: "settings",
    values: { language: "it" },
    targetProfileId: "pixel-it",
  });
  assert.equal(bindingForCell(first, "settings", { language: "en" }), undefined);
  assert.equal(bindingForCell(first, "settings", { language: "it" })?.targetProfileId, "pixel-it");
  const replaced = upsertCellRuntimeProfile(first, {
    testId: "settings",
    values: { language: "it" },
    targetProfileId: "pixel-pt",
  });
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0]?.targetProfileId, "pixel-pt");
});
