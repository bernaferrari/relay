import assert from "node:assert/strict";
import test from "node:test";
import {
  iosSnapshotCatalogProfileForBundle,
  registerIosSnapshotCatalogProfile,
} from "./ios-snapshot-chrome.js";

const exampleProfile = {
  id: "example-ios-catalog-test",
  bundleIds: ["com.example.app"],
  homeChromeIdentifiers: ["example.home"],
  sidebarChromeIdentifiers: ["example.sidebar"],
  attachMenuIdentifiers: [],
  homeChromeLabels: [],
  sidebarChromeLabels: [],
  sidebarOpenerIdentifier: "example.sidebar.open",
} as const;

test("iOS snapshot catalog profiles register by exact bundle and unregister cleanly", () => {
  assert.equal(iosSnapshotCatalogProfileForBundle("com.example.app"), undefined);
  const unregister = registerIosSnapshotCatalogProfile(exampleProfile);
  assert.equal(iosSnapshotCatalogProfileForBundle("com.example.app")?.id, exampleProfile.id);
  assert.throws(() => registerIosSnapshotCatalogProfile(exampleProfile), /Duplicate/u);
  unregister();
  assert.equal(iosSnapshotCatalogProfileForBundle("com.example.app"), undefined);
});
