import { registerDiscoveryAppProfile, type DiscoveryAppProfile } from "./discovery-app-profiles.js";

/**
 * Test-local mirror of the production Grok discovery pack that lives in
 * @relay/grok-qa. Core tests cannot depend on the host extension, so tests
 * that exercise profile-driven heuristics register this stand-in instead.
 */
export const GROK_DISCOVERY_TEST_PROFILE: DiscoveryAppProfile = {
  id: "grok-test",
  bundleIds: ["ai.x.grok", "ai.x.GrokApp"],
  appTitle: "Grok",
  settingsHubRows: [
    "Appearance",
    "Haptics",
    "Widget",
    "Usage",
    "Advanced",
    "Voice",
    "Memory",
    "Connectors",
    "Skills",
    "Customize Grok",
  ],
  settingsHubTitle: "Settings",
  settingsChildTitles: [
    "NSFW Preferences",
    "Shared Conversations",
    "Data Controls",
    "Help & Support",
    "Kids Mode",
    "Data & Information",
    "Voice Library",
    "Projects",
    "Automations",
  ],
  topLevelTitles: ["Pinned", "Imagine", "Build", "Ask"],
  chromeTitles: ["Ask", "Imagine", "Build", "Grok", "Back", "Close"],
  weakTitles: ["Grok", "Ask"],
  chromePrefixes: ["grok-", "grok_", "supergrok-branding"],
  chromeLabels: ["Open sidebar", "New Message", "Ask Anything", "Speak", "Attach", "Auto"],
  chromeIdentifiers: [
    "sidebar.open.button",
    "sidebar.search.field",
    "ask.toolbar.add.button",
    "voice.speak.button",
    "toolbar.back.button",
    "settings.language",
  ],
  backAffordances: ["grok-arrow-left"],
  closeAffordances: ["grok-close"],
  stableSurfaceTerms: ["SuperGrok"],
  systemSettingsNoise: ["allow grok to access", "allow grok", "grok settings"],
  header: {
    tabAnchors: ["Ask", "Imagine", "Build"],
    leadingAffordance: "Menu",
    trailingAffordance: "Private",
  },
};

/** Register the Grok test discovery profile, returning an unregister callback. */
export function registerGrokDiscoveryTestProfile(): () => void {
  return registerDiscoveryAppProfile(GROK_DISCOVERY_TEST_PROFILE);
}
