/**
 * Per-app vocabulary the discovery heuristics need.
 *
 * Screen titling and header chrome used to carry Grok's nouns inline, which made
 * every app Grok-shaped and every new app a code change. Keeping the words in a
 * profile table means teaching Relay a second app is data, and it keeps the
 * heuristics in `discovery.ts` about structure rather than about one product.
 */
export type DiscoveryAppProfile = {
  id: string;
  /** Bundle / package ids that identify the app in a snapshot. */
  bundleIds: string[];
  /** Last-resort title when nothing else in the tree names the screen. */
  appTitle: string;
  /**
   * Settings hub rows. Two or more visible means the list itself, not a child
   * page, so a scrolled hub is never titled after whichever row sits on top.
   */
  settingsHubRows: string[];
  /** What the hub list itself is called. */
  settingsHubTitle: string;
  /** Page names that beat a nearby list row when titling a screen. */
  pageTitles: string[];
  /** Labels that are app chrome and must never become a page title. */
  chromeTitles: string[];
  /**
   * Header layout: the tab labels the unlabeled icons flank, and what those
   * icons open. The first two anchors must be present for the header to be
   * recognised, which is also what keeps one app's chrome off another's screen.
   */
  header?: {
    tabAnchors: string[];
    leadingAffordance: string;
    trailingAffordance: string;
  };
};

export const GROK_DISCOVERY_PROFILE: DiscoveryAppProfile = {
  id: "grok",
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
  pageTitles: [
    "Settings",
    "Projects",
    "Automations",
    "Pinned",
    "Imagine",
    "Build",
    "Ask",
    "NSFW Preferences",
    "Shared Conversations",
    "Data Controls",
    "Help & Support",
    "Kids Mode",
    "Data & Information",
    "Voice Library",
  ],
  chromeTitles: ["Ask", "Imagine", "Build", "Grok", "Back", "Close"],
  header: {
    tabAnchors: ["Ask", "Imagine", "Build"],
    leadingAffordance: "Menu",
    trailingAffordance: "Private",
  },
};

export const DISCOVERY_APP_PROFILES: readonly DiscoveryAppProfile[] = [GROK_DISCOVERY_PROFILE];

function lexicon(pick: (profile: DiscoveryAppProfile) => string[]): Set<string> {
  return new Set(
    DISCOVERY_APP_PROFILES.flatMap(pick).map((label) => label.toLocaleLowerCase().trim()),
  );
}

const SETTINGS_HUB_ROWS = lexicon((profile) => profile.settingsHubRows);
const PAGE_TITLES = lexicon((profile) => [...profile.pageTitles, ...profile.settingsHubRows]);
const CHROME_TITLES = lexicon((profile) => profile.chromeTitles);
const HUB_TITLES = lexicon((profile) => [profile.settingsHubTitle, ...profile.settingsHubRows]);

/** A row that only ever appears on a settings hub list. */
export function isSettingsHubRow(label: string): boolean {
  return SETTINGS_HUB_ROWS.has(label.toLocaleLowerCase().trim());
}

/**
 * A hub page whose fingerprint drifts as it scrolls or animates.
 *
 * These are re-observed constantly, so matching them by title keeps one screen
 * per page instead of a new capture for every scroll offset.
 */
export function isDriftingHubTitle(label: string): boolean {
  return HUB_TITLES.has(label.toLocaleLowerCase().trim());
}

/** A label a profile claims as a page name rather than an incidental row. */
export function isProfilePageTitle(label: string): boolean {
  return PAGE_TITLES.has(label.toLocaleLowerCase().trim());
}

/** A label that is app chrome: a tab, the app name, or a dismiss affordance. */
export function isProfileChromeTitle(label: string): boolean {
  return CHROME_TITLES.has(label.toLocaleLowerCase().trim());
}

/** The profile owning a bundle id, when the snapshot names one. */
export function profileForBundleId(bundleId: string | undefined): DiscoveryAppProfile | undefined {
  if (!bundleId) return undefined;
  return DISCOVERY_APP_PROFILES.find((profile) => profile.bundleIds.includes(bundleId));
}
