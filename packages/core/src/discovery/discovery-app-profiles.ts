/**
 * Per-app vocabulary the discovery heuristics need.
 *
 * Screen titling and header chrome must not carry one product's nouns inline.
 * Keeping the words behind registered profile data means teaching Relay another
 * app is data, and it keeps the heuristics in `discovery.ts` about structure
 * rather than about one product.
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

const registeredDiscoveryAppProfiles: DiscoveryAppProfile[] = [];

/** Live registered profile catalog. Product packages add profiles explicitly. */
export const DISCOVERY_APP_PROFILES: readonly DiscoveryAppProfile[] =
  registeredDiscoveryAppProfiles;

let discoveryProfileRevision = 0;

/** Register one product's discovery vocabulary. Generic core ships no product profile. */
export function registerDiscoveryAppProfile(profile: DiscoveryAppProfile): () => void {
  if (!profile.id.trim()) throw new Error("Discovery app profile id must be non-empty");
  if (registeredDiscoveryAppProfiles.some((existing) => existing.id === profile.id)) {
    throw new Error(`Duplicate discovery app profile: ${profile.id}`);
  }
  registeredDiscoveryAppProfiles.push(profile);
  discoveryProfileRevision += 1;
  return () => {
    const index = registeredDiscoveryAppProfiles.indexOf(profile);
    if (index >= 0) {
      registeredDiscoveryAppProfiles.splice(index, 1);
      discoveryProfileRevision += 1;
    }
  };
}

function lexicon(
  profiles: readonly DiscoveryAppProfile[],
  pick: (profile: DiscoveryAppProfile) => string[],
): Set<string> {
  return new Set(profiles.flatMap(pick).map((label) => label.toLocaleLowerCase().trim()));
}

type DiscoveryVocabulary = {
  settingsHubRows: Set<string>;
  settingsChildTitles: Set<string>;
  pageTitles: Set<string>;
  chromeTitles: Set<string>;
  chromeLabels: Set<string>;
  chromePrefixes: readonly string[];
  chromeIdentifiers: Set<string>;
  stableSurfaceTerms: readonly string[];
  hubTitles: Set<string>;
  hubOnlyTitles: Set<string>;
  appTitles: Set<string>;
  weakTitles: Set<string>;
};

let vocabularyRevision = -1;
let vocabularyCache: DiscoveryVocabulary | undefined;

function vocabulary(): DiscoveryVocabulary {
  if (vocabularyCache && vocabularyRevision === discoveryProfileRevision) return vocabularyCache;
  const profiles = registeredDiscoveryAppProfiles;
  vocabularyCache = {
    settingsHubRows: lexicon(profiles, (profile) => profile.settingsHubRows),
    settingsChildTitles: lexicon(profiles, (profile) => [
      ...profile.settingsHubRows,
      ...profile.settingsChildTitles,
    ]),
    pageTitles: lexicon(profiles, (profile) => [
      profile.settingsHubTitle,
      ...profile.settingsHubRows,
      ...profile.settingsChildTitles,
      ...profile.topLevelTitles,
    ]),
    chromeTitles: lexicon(profiles, (profile) => profile.chromeTitles),
    chromeLabels: lexicon(profiles, (profile) => [
      ...profile.chromeLabels,
      ...profile.backAffordances,
      ...profile.closeAffordances,
    ]),
    chromePrefixes: [...lexicon(profiles, (profile) => profile.chromePrefixes)],
    chromeIdentifiers: lexicon(profiles, (profile) => profile.chromeIdentifiers),
    stableSurfaceTerms: [...lexicon(profiles, (profile) => profile.stableSurfaceTerms)],
    hubTitles: lexicon(profiles, (profile) => [
      profile.settingsHubTitle,
      ...profile.settingsHubRows,
    ]),
    hubOnlyTitles: lexicon(profiles, (profile) => [profile.settingsHubTitle]),
    appTitles: lexicon(profiles, (profile) => [profile.appTitle]),
    weakTitles: lexicon(profiles, (profile) => profile.weakTitles),
  };
  vocabularyRevision = discoveryProfileRevision;
  return vocabularyCache;
}

/** A row that only ever appears on a settings hub list. */
export function isSettingsHubRow(label: string): boolean {
  return vocabulary().settingsHubRows.has(label.toLocaleLowerCase().trim());
}

/** The name a profile gives its settings hub list. */
export function isSettingsHubTitle(label: string): boolean {
  return vocabulary().hubOnlyTitles.has(label.toLocaleLowerCase().trim());
}

/** A named settings page below the hub, hub list rows included. */
export function isSettingsChildTitle(label: string): boolean {
  return vocabulary().settingsChildTitles.has(label.toLocaleLowerCase().trim());
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

/** A branded chrome identifier or label supplied by a registered product profile. */
export function hasProfileChromePrefix(value: string): boolean {
  const label = value.toLocaleLowerCase().trim();
  return vocabulary().chromePrefixes.some((prefix) => label.startsWith(prefix));
}

/** A chrome control a crawl must not mistake for a content row. */
export function isProfileChromeLabel(value: string): boolean {
  const label = value.toLocaleLowerCase().trim();
  return vocabulary().chromeLabels.has(label) || hasProfileChromePrefix(label);
}

/** A chrome control named by its accessibility identifier, in any language. */
export function isProfileChromeIdentifier(value: string): boolean {
  const identifier = value.toLocaleLowerCase().trim();
  return vocabulary().chromeIdentifiers.has(identifier) || hasProfileChromePrefix(identifier);
}

/** A product noun whose hidden surface is worth capturing in full. */
export function hasProfileStableSurfaceTerm(value: string): boolean {
  const label = value.toLocaleLowerCase();
  return vocabulary().stableSurfaceTerms.some((term) => label.includes(term));
}

/** The name a profile gives its app, as it appears in a tree. */
export function isProfileAppTitle(label: string): boolean {
  return vocabulary().appTitles.has(label.toLocaleLowerCase().trim());
}

/** A title too weak to tell two screens apart: the app name or its home tab. */
export function isProfileWeakTitle(label: string): boolean {
  return vocabulary().weakTitles.has(label.toLocaleLowerCase().trim());
}

/**
 * A hub page whose fingerprint drifts as it scrolls or animates.
 *
 * These are re-observed constantly, so matching them by title keeps one screen
 * per page instead of a new capture for every scroll offset.
 */
export function isDriftingHubTitle(label: string): boolean {
  return vocabulary().hubTitles.has(label.toLocaleLowerCase().trim());
}

/** A label a profile claims as a page name rather than an incidental row. */
export function isProfilePageTitle(label: string): boolean {
  return vocabulary().pageTitles.has(label.toLocaleLowerCase().trim());
}

/** A label that is app chrome: a tab, the app name, or a dismiss affordance. */
export function isProfileChromeTitle(label: string): boolean {
  return vocabulary().chromeTitles.has(label.toLocaleLowerCase().trim());
}

/** The profile owning a bundle id, when the snapshot names one. */
export function profileForBundleId(bundleId: string | undefined): DiscoveryAppProfile | undefined {
  if (!bundleId) return undefined;
  return DISCOVERY_APP_PROFILES.find((profile) => profile.bundleIds.includes(bundleId));
}
