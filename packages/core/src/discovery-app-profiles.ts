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
  /**
   * Settings pages below the hub list that own their own toolbar title. Child
   * sheets often keep the hub's header, so these labels decide screen identity.
   */
  settingsChildTitles: string[];
  /** Top-level destinations that are pages in their own right, not settings. */
  topLevelTitles: string[];
  /** Labels that are app chrome and must never become a page title. */
  chromeTitles: string[];
  /**
   * Titles too weak to tell two screens apart: the app's own name and the
   * default landing tab, which the platform reports for unrelated pages.
   */
  weakTitles: string[];
  /**
   * Identifier and label prefixes the app stamps on its own chrome, such as an
   * icon button exposed to accessibility under a branded name.
   */
  chromePrefixes: string[];
  /** Chrome controls a crawl must not mistake for content rows. */
  chromeLabels: string[];
  /**
   * Accessibility identifiers of the same chrome. An identifier is the same in
   * every language, so this is what a locale sweep can filter on: deciding
   * chrome from `chromeLabels` alone filters the locale the words happen to be
   * written in and nothing else.
   */
  chromeIdentifiers: string[];
  /** The app's own back affordance labels, tried before the generic ones. */
  backAffordances: string[];
  /** The app's own dismiss affordance labels. */
  closeAffordances: string[];
  /** Product nouns whose hidden surface is stable enough to capture in full. */
  stableSurfaceTerms: string[];
  /** Rows this app adds to the OS settings tree — noise during a picker scan. */
  systemSettingsNoise: string[];
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
  // Measured on the physical iPad. `navigation.tab.*` is deliberately absent:
  // the tabs are destinations, and they only ever appeared to be chrome because
  // "Ask" and "Build" are also titles this app must not name a screen after.
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

export const DISCOVERY_APP_PROFILES: readonly DiscoveryAppProfile[] = [GROK_DISCOVERY_PROFILE];

function lexicon(pick: (profile: DiscoveryAppProfile) => string[]): Set<string> {
  return new Set(
    DISCOVERY_APP_PROFILES.flatMap(pick).map((label) => label.toLocaleLowerCase().trim()),
  );
}

const SETTINGS_HUB_ROWS = lexicon((profile) => profile.settingsHubRows);
const SETTINGS_CHILD_TITLES = lexicon((profile) => [
  ...profile.settingsHubRows,
  ...profile.settingsChildTitles,
]);
const PAGE_TITLES = lexicon((profile) => [
  profile.settingsHubTitle,
  ...profile.settingsHubRows,
  ...profile.settingsChildTitles,
  ...profile.topLevelTitles,
]);
const CHROME_TITLES = lexicon((profile) => profile.chromeTitles);
const CHROME_LABELS = lexicon((profile) => [
  ...profile.chromeLabels,
  ...profile.backAffordances,
  ...profile.closeAffordances,
]);
const CHROME_PREFIXES = [...lexicon((profile) => profile.chromePrefixes)] as readonly string[];
const CHROME_IDENTIFIERS = lexicon((profile) => profile.chromeIdentifiers);
const STABLE_SURFACE_TERMS = [
  ...lexicon((profile) => profile.stableSurfaceTerms),
] as readonly string[];
const HUB_TITLES = lexicon((profile) => [profile.settingsHubTitle, ...profile.settingsHubRows]);
const HUB_ONLY_TITLES = lexicon((profile) => [profile.settingsHubTitle]);
const APP_TITLES = lexicon((profile) => [profile.appTitle]);
const WEAK_TITLES = lexicon((profile) => profile.weakTitles);

/** A row that only ever appears on a settings hub list. */
export function isSettingsHubRow(label: string): boolean {
  return SETTINGS_HUB_ROWS.has(label.toLocaleLowerCase().trim());
}

/** The name a profile gives its settings hub list. */
export function isSettingsHubTitle(label: string): boolean {
  return HUB_ONLY_TITLES.has(label.toLocaleLowerCase().trim());
}

/** A named settings page below the hub, hub list rows included. */
export function isSettingsChildTitle(label: string): boolean {
  return SETTINGS_CHILD_TITLES.has(label.toLocaleLowerCase().trim());
}

/** The app's own back affordances, most specific first. */
export function profileBackAffordances(): readonly string[] {
  return DISCOVERY_APP_PROFILES.flatMap((profile) => profile.backAffordances);
}

/** The app's own dismiss affordances. */
export function profileCloseAffordances(): readonly string[] {
  return DISCOVERY_APP_PROFILES.flatMap((profile) => profile.closeAffordances);
}

/** Rows an app adds to the OS settings tree, for a scanner's noise filter. */
export function profileSystemSettingsNoise(): readonly string[] {
  return DISCOVERY_APP_PROFILES.flatMap((profile) => profile.systemSettingsNoise);
}

/** A branded chrome identifier or label: `grok-arrow-left`, `supergrok-branding`. */
export function hasProfileChromePrefix(value: string): boolean {
  const label = value.toLocaleLowerCase().trim();
  return CHROME_PREFIXES.some((prefix) => label.startsWith(prefix));
}

/** A chrome control a crawl must not mistake for a content row. */
export function isProfileChromeLabel(value: string): boolean {
  const label = value.toLocaleLowerCase().trim();
  return CHROME_LABELS.has(label) || hasProfileChromePrefix(label);
}

/** A chrome control named by its accessibility identifier, in any language. */
export function isProfileChromeIdentifier(value: string): boolean {
  const identifier = value.toLocaleLowerCase().trim();
  return CHROME_IDENTIFIERS.has(identifier) || hasProfileChromePrefix(identifier);
}

/** A product noun whose hidden surface is worth capturing in full. */
export function hasProfileStableSurfaceTerm(value: string): boolean {
  const label = value.toLocaleLowerCase();
  return STABLE_SURFACE_TERMS.some((term) => label.includes(term));
}

/** The name a profile gives its app, as it appears in a tree. */
export function isProfileAppTitle(label: string): boolean {
  return APP_TITLES.has(label.toLocaleLowerCase().trim());
}

/** A title too weak to tell two screens apart: the app name or its home tab. */
export function isProfileWeakTitle(label: string): boolean {
  return WEAK_TITLES.has(label.toLocaleLowerCase().trim());
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
