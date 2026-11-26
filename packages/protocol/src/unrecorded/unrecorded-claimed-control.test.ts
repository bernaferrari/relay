import assert from "node:assert/strict";
import test from "node:test";
import {
  claimedAbsentControlReason,
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
  assert.equal(unrecordedProductName("Imagine Speed image generation signed-in"), false);
  assert.equal(unrecordedProductName("UNRECORDED — Chat Heavy (no Non-QA Heavy account)"), true);
  assert.equal(unrecordedProductName("Inspect model choices"), false);
  assert.equal(unrecordedProductName("Header More on existing chat"), false);
  assert.equal(unrecordedProductName("Older conversation then 2+2 signed-in"), false);
});

test("feature names do not imply missing recording evidence or account permission", () => {
  for (const name of [
    "Imagine Speed image generation signed-in",
    "Speed-mode Imagine",
    "Generate a speed image",
    "Chat Heavy",
    "Video generation 1080p",
  ]) {
    assert.equal(unrecordedProductName(name), false);
    assert.equal(unrecordedProductName(`UNRECORDED — ${name}`), true);
    assert.equal(unrecordedProductName(`DRAFT — ${name}`), true);
  }
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
