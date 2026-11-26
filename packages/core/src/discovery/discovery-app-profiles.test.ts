import assert from "node:assert/strict";
import test from "node:test";
import {
  isProfilePageTitle,
  profileForBundleId,
  registerDiscoveryAppProfile,
  type DiscoveryAppProfile,
} from "./discovery-app-profiles.js";

const exampleProfile: DiscoveryAppProfile = {
  id: "example",
  bundleIds: ["com.example.app"],
  appTitle: "Example",
  settingsHubRows: ["Account", "Privacy"],
  settingsHubTitle: "Preferences",
  settingsChildTitles: ["Notifications"],
  topLevelTitles: ["Home"],
  chromeTitles: ["Home", "Back"],
  weakTitles: ["Example"],
  chromePrefixes: ["example-"],
  chromeLabels: ["Open menu"],
  chromeIdentifiers: ["menu.open"],
  backAffordances: ["example-back"],
  closeAffordances: ["example-close"],
  stableSurfaceTerms: ["Membership"],
  systemSettingsNoise: ["allow example"],
};

test("discovery vocabulary is empty until a host registers a product profile", () => {
  assert.equal(isProfilePageTitle("Account"), false);
  assert.equal(profileForBundleId("com.example.app"), undefined);
  const unregister = registerDiscoveryAppProfile(exampleProfile);
  try {
    assert.equal(isProfilePageTitle("Account"), true);
    assert.equal(profileForBundleId("com.example.app")?.id, "example");
    assert.throws(() => registerDiscoveryAppProfile(exampleProfile), /Duplicate/u);
  } finally {
    unregister();
  }
  assert.equal(isProfilePageTitle("Account"), false);
  assert.equal(profileForBundleId("com.example.app"), undefined);
});
