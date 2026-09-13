/** A normalized finding produced from frozen Combine evidence. */
export type CombineEvidenceFindingCode =
  | "SCREEN_MISSING"
  | "POSSIBLE_LOCALE_NOT_APPLIED"
  | "CONTROL_MISSING"
  | "POSSIBLE_UNTRANSLATED_TEXT"
  /** Translated text that the control it landed in probably cannot show in full. */
  | "POSSIBLE_TEXT_CLIPPED"
  /** Expired, revoked, or signed-out account fixture. Infra, not a product failure. */
  | "ACCOUNT_NEEDS_RELOGIN";

export type CombineEvidenceFinding = {
  id: string;
  code: CombineEvidenceFindingCode;
  severity: "critical" | "warning";
  confidence: "high" | "medium";
  canonicalKey: string;
  screenLabel: string;
  locale: string;
  baselineLocale: string;
  stableKey?: string;
  expected?: string;
  observed?: string;
  detail: string;
};

/**
 * A bounded, explainable review over evidence captured by a Combine run.
 * Possible linguistic defects stay explicitly qualified rather than being
 * presented as proven translation failures.
 */
export type CombineEvidenceAnalysis = {
  schemaVersion: 1;
  sessionId: string;
  generatedAt: number;
  baselineLocale: string;
  findings: CombineEvidenceFinding[];
  critical: number;
  warnings: number;
  affectedScreens: number;
};

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
