import type { TargetProfile } from "./target-contract.js";

export type CorpusScope = {
  /** Maximum navigation depth from the corpus root (0 = root only). */
  maxDepth: number;
  maxScreens: number;
  maxTransitions: number;
  maxDurationMs: number;
  /** Locales to capture. First is the map locale unless mapLocale is set. */
  locales: string[];
  /**
   * map-once-replay (default): DFS the tree once in the map locale, then switch
   * language and replay the same path plan for every other locale.
   * crawl-each: independent DFS per locale (legacy).
   */
  strategy?: "map-once-replay" | "crawl-each";
  /** Locale used to discover the tree. Defaults to locales[0]. */
  mapLocale?: string;
  /** App to open / relaunch between locale passes (bundle id or name). */
  app?: string;
  /** Optional path from the current screen to the corpus root (e.g. open Settings). */
  entryPath?: CorpusNavStep[];
  /**
   * Path from the corpus root to the in-app language picker. Used before each
   * non-map locale so the next language can be chosen.
   */
  languagePath?: CorpusNavStep[];
  /**
   * Per-locale selection steps inside the language picker. Keys are locale tags
   * from `locales` (e.g. "pt-BR"). Prefer accessibility identifiers over labels.
   */
  languageOptions?: Record<string, CorpusNavStep[]>;
  /**
   * Explicit stateful journeys recorded once in the map locale. Capture steps
   * preserve dialogs, toggles, sheets, and scrolled viewports that a page-only
   * crawl cannot infer safely.
   */
  journeys?: CorpusJourney[];
  allowSensitiveControls?: boolean;
};

export type CorpusStatus = "draft" | "running" | "paused" | "complete" | "stopped" | "failed";

export type CorpusNavStep =
  | {
      kind: "tap";
      target: {
        stableKey?: string;
        identifier?: string;
        label?: string;
        text?: string;
        point?: { x: number; y: number };
      };
    }
  | { kind: "back" }
  | { kind: "wait"; ms: number }
  | { kind: "scroll"; direction: "up" | "down"; amount?: number }
  | { kind: "relaunch" }
  /** Open/switch foreground app without requiring relaunch (deep-link handoff). */
  | { kind: "openApp"; app: string; relaunch?: boolean };

export type CorpusJourneyStep =
  | CorpusNavStep
  | {
      kind: "capture";
      /** Human-readable evidence name, e.g. “Birth Year dialog”. */
      name: string;
      /** Locale-independent identity. Defaults to a slug of name. */
      key?: string;
    };

export type CorpusJourney = {
  id: string;
  name: string;
  /** Starts from app + entryPath; may contain multiple capture checkpoints. */
  steps: CorpusJourneyStep[];
};

export type CorpusControl = {
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

/** One concrete screen observation inside a corpus, always bound to a locale. */
export type CorpusScreen = {
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
  /** Relative pack path written at export time, e.g. pt-BR/settings/app-language.png */
  artifactPath?: string;
  snapshotDigest?: string;
  /** Raw normalized accessibility snapshot captured beside the screenshot. */
  accessibilityPath?: string;
  accessibilityDigest?: string;
  controls?: CorpusControl[];
  /** Localized labels observed on this screen, keyed by stable control key. */
  localizedLabels?: Record<string, string>;
};

export type CorpusTransition = {
  id: string;
  fromScreenId: string;
  toScreenId?: string;
  locale: string;
  kind: "tap" | "scroll" | "back" | "relaunch" | "manual";
  label?: string;
  stableKey?: string;
  target?: CorpusControl["target"];
  depth: number;
  capturedAt: number;
  changedScreen: boolean;
};

/** One step recorded while mapping the tree in the map locale. */
export type CorpusMapAction =
  | {
      kind: "open";
      stableKey: string;
      label: string;
      target: CorpusControl["target"];
      depth: number;
      /** Stable path keys after this open (root → … → this control). */
      pathKeys: string[];
      /** Localized path labels from the map locale (display only). */
      path: string[];
      fromCanonicalKey: string;
      toCanonicalKey?: string;
    }
  | {
      kind: "back";
      depth: number;
      fromCanonicalKey: string;
    };

/** Deterministic tree plan produced by the map-locale DFS, replayed per locale. */
export type CorpusMapPlan = {
  mappedLocale: string;
  rootCanonicalKey?: string;
  /** Preorder open/back actions from the map crawl. */
  actions: CorpusMapAction[];
  mappedAt: number;
};

export type CorpusProgress = {
  phase:
    | "idle"
    | "opening"
    | "mapping"
    | "switching-language"
    | "replaying"
    | "crawling"
    | "exporting"
    | "complete"
    | "failed";
  locale?: string;
  depth?: number;
  path?: string[];
  screensCaptured: number;
  transitionsCaptured: number;
  /** Values whose complete mapped screen set has been captured. */
  completedLocales?: string[];
  message?: string;
  updatedAt: number;
};

export type CorpusPackManifest = {
  schemaVersion: 2;
  sessionId: string;
  name: string;
  generatedAt: number;
  locales: string[];
  rootDir: string;
  execution: {
    projectId?: string;
    organizationId?: string;
    status: CorpusStatus;
    createdAt: number;
    updatedAt: number;
    targetId: string;
    targetProfile?: TargetProfile;
    strategy: CorpusScope["strategy"];
    mapLocale: string;
    app?: string;
    completedLocales: string[];
    mapPlan?: CorpusMapPlan;
  };
  screens: Array<{
    id: string;
    locale: string;
    canonicalKey: string;
    depth: number;
    path: string[];
    pathKeys: string[];
    title?: string;
    file: string;
    sha256: string;
    accessibilityFile?: string;
    accessibilitySha256?: string;
  }>;
  /** canonicalKey → locale → relative PNG path for side-by-side compare */
  byCanonicalKey: Record<string, Record<string, string>>;
  /** Deterministic findings derived from the same frozen screenshots and UI trees. */
  analysis: CorpusAnalysisReport;
};

export type CorpusSession = {
  id: string;
  name: string;
  projectId?: string;
  organizationId?: string;
  targetId: string;
  targetProfile?: TargetProfile;
  scope: CorpusScope;
  status: CorpusStatus;
  createdAt: number;
  updatedAt: number;
  currentScreenId?: string;
  currentLocale?: string;
  progress: CorpusProgress;
  screens: CorpusScreen[];
  transitions: CorpusTransition[];
  /** Tree discovered in the map locale; replayed for every other language. */
  mapPlan?: CorpusMapPlan;
  /** Relative directory under .relay/corpus/<id>/pack when exported. */
  packRoot?: string;
  error?: string;
};

export type CorpusCoverageItem = {
  id: string;
  label: string;
  canonicalKey: string;
  observedLocales: string[];
  missingLocales: string[];
  screenIds: string[];
};

export type CorpusCoverageReport = {
  sessionId: string;
  name: string;
  generatedAt: number;
  locales: string[];
  screens: CorpusCoverageItem[];
  complete: number;
  partial: number;
  missing: number;
};

export type CorpusFindingCode =
  | "SCREEN_MISSING"
  | "POSSIBLE_LOCALE_NOT_APPLIED"
  | "CONTROL_MISSING"
  | "POSSIBLE_UNTRANSLATED_TEXT"
  /** Translated text that the control it landed in probably cannot show in full. */
  | "POSSIBLE_TEXT_CLIPPED";

export type CorpusFinding = {
  id: string;
  code: CorpusFindingCode;
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
 * A finding somebody has already looked at and accepted.
 *
 * Keyed by the finding's own id, which the analyzer derives from the code, the
 * screen, the locale and the control rather than from the sweep it was seen on.
 * That is what lets a forty-language sweep stay quiet about a clipped label
 * somebody accepted last week instead of reporting it as news.
 */
export type KnownLocaleFinding = {
  id: string;
  code: CorpusFindingCode;
  canonicalKey: string;
  screenLabel: string;
  locale: string;
  /**
   * `locale` accepts only this language. `control` accepts the same stable
   * untranslated control in every language. Older records omit this field and
   * are deliberately interpreted as locale-scoped.
   */
  scope?: "locale" | "control";
  /** What the finding said when it was accepted, so the list reads as prose. */
  detail: string;
  stableKey?: string;
  note?: string;
  markedAt: number;
  markedBy?: string;
};

export function knownLocaleFindingMatches(
  finding: CorpusFinding,
  known: KnownLocaleFinding,
): boolean {
  if (finding.id === known.id) return true;
  if ((known.scope ?? "locale") !== "control") return false;
  return Boolean(
    known.code === "POSSIBLE_UNTRANSLATED_TEXT" &&
    finding.code === known.code &&
    known.stableKey &&
    finding.stableKey === known.stableKey &&
    finding.canonicalKey === known.canonicalKey,
  );
}

/** A bounded, explainable localization review. This intentionally reports
 * possible translation defects instead of pretending deterministic heuristics
 * can prove linguistic correctness. */
export type CorpusAnalysisReport = {
  schemaVersion: 1;
  sessionId: string;
  generatedAt: number;
  baselineLocale: string;
  findings: CorpusFinding[];
  critical: number;
  warnings: number;
  affectedScreens: number;
};
