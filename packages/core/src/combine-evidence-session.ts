/**
 * The evidence shape `analyzeCombineEvidence` reads.
 *
 * Kept beside the analyzer rather than in @relay/protocol: the protocol surface
 * ships only what crosses a process boundary (the analysis report and its
 * findings), while this input is assembled by core's own pack readers.
 */
export type CombineEvidenceControl = {
  id: string;
  label: string;
  /** Locale-stable control key when identifiers or LocalizedStringKey exist. */
  stableKey: string;
  role?: string;
  target: {
    identifier?: string;
    ref?: string;
    label?: string;
    text?: string;
    point?: { x: number; y: number };
  };
  /**
   * Where the control sat when it was observed. Kept per locale so a review can
   * see that a translated string had to fit the same box as the original.
   */
  rect?: { x: number; y: number; width: number; height: number };
  /**
   * Recorded so its copy can be compared, but never activated by an automatic
   * crawl: app chrome, a way out of the screen, or a row a crawl must not
   * exercise. Whether a crawl should tap a control and whether its text should
   * be compared are separate questions; conflating them made the filter a
   * function of the language on screen.
   */
  skipCrawl?: true;
};

/** One concrete screen observation, always bound to a locale. */
export type CombineEvidenceScreen = {
  id: string;
  /** Locale-stable structural identity shared across language passes. */
  canonicalKey: string;
  /** Full semantic fingerprint for this locale's copy. */
  fingerprint: string;
  locale: string;
  depth: number;
  /** Slash-joined path labels from the corpus root (localized). */
  path: string[];
  /** Stable path keys when available (identifiers / string keys). */
  pathKeys: string[];
  title?: string;
  capturedAt: number;
  screenshotPath?: string;
  snapshotDigest?: string;
  controls?: CombineEvidenceControl[];
  /** Localized labels observed on this screen, keyed by stable control key. */
  localizedLabels?: Record<string, string>;
};

export type CombineEvidenceSession = {
  id: string;
  name: string;
  targetId: string;
  scope: {
    locales: string[];
    mapLocale?: string;
  };
  status: string;
  createdAt: number;
  updatedAt: number;
  screens: CombineEvidenceScreen[];
};
