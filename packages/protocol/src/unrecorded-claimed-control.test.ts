import assert from "node:assert/strict";
import test from "node:test";
import {
  claimedAbsentControlReason,
  claimedBlockedHeavyGeneration,
  recipeRecordedLabels,
  unrecordedProductName,
} from "./unrecorded-claimed-control.js";

test("UNRECORDED, DRAFT, and still-absent names are not Ready product naming", () => {
  assert.equal(unrecordedProductName("UNRECORDED — Start Thread (absent from tree)"), true);
  assert.equal(unrecordedProductName("DRAFT — Delete persist"), true);
  assert.equal(
    unrecordedProductName("Header More on existing chat (Start Thread still absent)"),
    true,
  );
  assert.equal(unrecordedProductName("Imagine Speed image generation signed-in"), true);
  assert.equal(unrecordedProductName("UNRECORDED — Chat Heavy (no Non-QA Heavy account)"), true);
  assert.equal(unrecordedProductName("Inspect model choices"), false);
  assert.equal(unrecordedProductName("Header More on existing chat"), false);
  assert.equal(unrecordedProductName("Older conversation then 2+2 signed-in"), false);
});

test("Imagine/video/Heavy generation is compile-blocked without a Non-QA Heavy account", () => {
  assert.equal(
    claimedBlockedHeavyGeneration("Imagine Speed image generation signed-in"),
    "No Non-QA SuperGrok Heavy account — do not burn the QA lab fixture on Imagine/video/Heavy — unrecorded.",
  );
  assert.equal(
    claimedBlockedHeavyGeneration("UNRECORDED — Chat Heavy (no Non-QA Heavy account)"),
    "No Non-QA SuperGrok Heavy account — do not burn the QA lab fixture on Imagine/video/Heavy — unrecorded.",
  );
  assert.equal(
    claimedBlockedHeavyGeneration("Inspect model choices\nexpect Fast/Auto/Expert/Heavy"),
    undefined,
  );
  assert.equal(claimedBlockedHeavyGeneration("Header More on existing chat"), undefined);
});

test("Start Thread in the title without a recorded node is unrecorded, not Ready", () => {
  assert.equal(
    claimedAbsentControlReason("Header More on existing chat (Start Thread still absent)", [
      "More",
      "Create share link",
    ]),
    "Start Thread is absent from the recorded tree — unrecorded.",
  );
  assert.equal(claimedAbsentControlReason("Start Thread", ["Start Thread", "More"]), undefined);
  assert.equal(claimedAbsentControlReason("Header More on existing chat", ["More"]), undefined);
});

test("recorded labels come from taps and expect-set, not invented Settings nav", () => {
  assert.deepEqual(
    recipeRecordedLabels([
      { kind: "tap", target: { label: "More" }, fallbackTargets: [{ label: "More actions" }] },
      { kind: "expect-set", labels: ["Copy response", "Create share link"] },
    ]),
    ["More", "More actions", "Copy response", "Create share link"],
  );
});
