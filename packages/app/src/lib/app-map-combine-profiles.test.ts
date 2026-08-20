import assert from "node:assert/strict";
import test from "node:test";
import {
  bindingForCell,
  cellBindingStatus,
  filterRuntimeProfiles,
  suggestCompatibleProfiles,
  upsertCellRuntimeProfile,
  type CombineRuntimeProfileOption,
} from "./app-map-combine-profiles";

const profiles: CombineRuntimeProfileOption[] = [
  { id: "pixel-en", name: "Pixel 9 · English", targetId: "serial-a", platform: "android" },
  { id: "pixel-it", name: "Pixel 9 · Italiano", targetId: "serial-a", platform: "android" },
  { id: "pixel-pt", name: "Pixel 9 · Português", targetId: "serial-a", platform: "android" },
  { id: "ipad-en", name: "iPad · English", targetId: "serial-b", platform: "ios" },
];

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

test("missing and bound cells are distinguished by text, not color", () => {
  assert.equal(cellBindingStatus({ profiles }).state, "missing");
  assert.match(cellBindingStatus({ profiles }).label, /Missing profile/u);
  const bound = cellBindingStatus({
    profiles,
    binding: { testId: "settings", values: { language: "it" }, targetProfileId: "pixel-it" },
  });
  assert.equal(bound.state, "bound");
  assert.equal(bound.label, "Bound · Pixel 9 · Italiano");
  assert.equal(cellBindingStatus({ profiles: [] }).state, "no-saved-profiles");
});

test("compatible profile suggestions never become a persisted binding", () => {
  const suggested = suggestCompatibleProfiles({
    profiles,
    values: { language: "it" },
    device: { serial: "serial-a", platform: "android" },
  });
  assert.equal(suggested[0]?.id, "pixel-it");
  assert.match(suggested[0]?.reason ?? "", /matches it/u);
  assert.ok(suggested.every((item) => item.platform === "android"));
  assert.equal(
    bindingForCell([], "settings", { language: "it" }),
    undefined,
    "ranking a compatible profile must not write a cell binding",
  );
});

test("search scales past a handful of saved target profiles", () => {
  const many = Array.from({ length: 40 }, (_, index) => ({
    id: `locale-${String(index).padStart(2, "0")}`,
    name: `Locale ${index}`,
    targetId: "serial-a",
    platform: "android" as const,
  }));
  const filtered = filterRuntimeProfiles([...profiles, ...many], "portug");
  assert.deepEqual(
    filtered.map((item) => item.id),
    ["pixel-pt"],
  );
});
