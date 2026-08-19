import assert from "node:assert/strict";
import test from "node:test";
import {
  isSettingsChildTitle,
  preferSettingsChildTitle,
  settingsScreenTitlesConflict,
} from "./settings-screen-titles.js";

test("Settings child titles stay distinct from each other and the hub", () => {
  assert.equal(isSettingsChildTitle("Memory"), true);
  assert.equal(isSettingsChildTitle("Kids Mode"), true);
  assert.equal(isSettingsChildTitle("NSFW Preferences"), true);
  assert.equal(isSettingsChildTitle("Settings"), false);
  assert.equal(settingsScreenTitlesConflict("Memory", "Kids Mode"), true);
  assert.equal(settingsScreenTitlesConflict("Memory", "NSFW Preferences"), true);
  assert.equal(settingsScreenTitlesConflict("Settings", "Memory"), true);
  assert.equal(settingsScreenTitlesConflict("Memory", "Memory"), false);
  assert.equal(settingsScreenTitlesConflict("Home", "Cart"), false);
});

test("preferSettingsChildTitle wins over a misleading Settings toolbar title", () => {
  assert.equal(preferSettingsChildTitle("Settings", "Memory"), "Memory");
  assert.equal(preferSettingsChildTitle("Kids Mode", "Memory"), "Kids Mode");
  assert.equal(preferSettingsChildTitle(undefined, "NSFW Preferences"), "NSFW Preferences");
});
