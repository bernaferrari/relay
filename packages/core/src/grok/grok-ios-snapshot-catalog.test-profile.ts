import {
  registerIosSnapshotCatalogProfile,
  type IosSnapshotCatalogProfile,
} from "../ios/ios-snapshot-chrome.js";

/** Product-shaped fixture profile retained only while legacy iOS catalog tests
 * still use Grok selector fixtures. Production core does not register it. */
export const GROK_IOS_SNAPSHOT_CATALOG_TEST_PROFILE: IosSnapshotCatalogProfile = {
  id: "grok-ios-test-fixture",
  bundleIds: ["ai.x.GrokApp"],
  homeChromeIdentifiers: [
    "ask.toolbar.textfield",
    "sidebar.open.button",
    "toolbar.model.selector.button",
    "voice.speak.button",
    "ask.toolbar.add.button",
  ],
  attachMenuIdentifiers: [
    "ask.toolbar.add.menu.camera",
    "ask.toolbar.add.menu.photos",
    "ask.toolbar.add.menu.files",
    "ask.toolbar.add.menu.connectors",
    "ask.toolbar.add.menu.skills",
  ],
  sidebarChromeIdentifiers: ["sidebar.settings.button", "sidebar.search.field"],
  homeChromeLabels: ["New temporary conversation"],
  sidebarChromeLabels: ["grok-compose", "grok-arrows-right", "grok-gear", "grok-3-dots"],
  sidebarOpenerIdentifier: "sidebar.open.button",
};

let unregisterTestProfile: (() => void) | undefined;

export function registerGrokIosSnapshotCatalogTestProfile(): void {
  if (unregisterTestProfile) return;
  unregisterTestProfile = registerIosSnapshotCatalogProfile(GROK_IOS_SNAPSHOT_CATALOG_TEST_PROFILE);
}
