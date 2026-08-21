/**
 * A target-free, serializable preview of the exact locale cases a matrix will
 * create. The same planner is used by core and the product so a restore locale
 * can never become an invisible, unbound extra case at admission time.
 */

export const LOCALE_MATRIX_MATERIALIZATION_SCHEMA_VERSION = 1 as const;

/** Transport-safe subset of a taught locale scope. Navigation is intentionally
 * opaque here: its target-specific interpretation remains in core. */
export type LocaleMatrixMaterializedScope = {
  locales: string[];
  app?: string;
  /** Android's per-app locale API. When present, no accessibility picker is
   * needed and the run is constrained to Android. */
  appLocale?: string;
  relaunch?: boolean;
  entryPath?: unknown[];
  languagePath?: unknown[];
  /** Recorded route from the picker back to the Test's source screen. */
  exitPath?: unknown[];
  languageOptions?: Record<string, string | { label?: string; identifier?: string; text?: string }>;
  restoreLocale?: string;
  restoreAfterEach?: boolean;
  restoreAtEnd?: boolean;
  screenshotEachLocale?: boolean;
};

export type LocaleMatrixMaterializationInput = {
  recipe?: string;
  appMapId?: string;
  flowId?: string;
  /** A saved graph Test is a first-class locale body, never a client-side
   * recipe approximation. `variableId` names the saved language Variable
   * whose apply contract supplies the locale prelude. */
  testId?: string;
  variableId?: string;
  /** Start-only optimistic concurrency guard returned by an App Map Test
   * materialization. It prevents a later map edit from silently changing the
   * Test graph or selected Variable between planning and admission. */
  expectedAppMapRevision?: number;
  locales?: string[];
  profileId?: string;
  preset?: "grok";
  scope?: LocaleMatrixMaterializedScope;
  /** Must match the authenticated project when supplied. */
  projectId?: string;
};

/** A case is keyed by its generated index as well as its visible locale. A
 * restore can intentionally repeat an earlier locale, so locale text alone is
 * never enough to bind a target. */
export type LocaleMatrixCase = {
  caseIndex: number;
  locale: string;
};

export type LocaleMatrixDurationCohort = {
  testId: string;
  action: string;
};

export type LocaleMatrixMaterialization = {
  schemaVersion: typeof LOCALE_MATRIX_MATERIALIZATION_SCHEMA_VERSION;
  materializedAt: number;
  source:
    | { kind: "recipe"; recipeId: string }
    | {
        kind: "app-map-flow";
        appMapId: string;
        flowId: string;
        appMapRevision: number;
        recipeId: string;
      }
    | {
        kind: "app-map-test";
        appMapId: string;
        testId: string;
        variableId: string;
        appMapRevision: number;
        recipeId: string;
      };
  /** Send this exact resolved scope with a later explicit-target start. */
  scope: LocaleMatrixMaterializedScope;
  /** Sorted by caseIndex and complete, including a final restore case. */
  cases: LocaleMatrixCase[];
  durationCohort: LocaleMatrixDurationCohort;
  /** A taught switcher profile can be OS-specific. This is a hard execution
   * constraint, not a hint: both the target picker and server admission must
   * reject a binding on the other platform. */
  targetPlatform?: "ios" | "android";
};

/** Match core's bounded locale normalization before any target is assigned. */
export function normalizeLocaleMatrixLocales(locales: readonly string[]): string[] {
  const normalized = [...new Set(locales.map((locale) => locale.trim()).filter(Boolean))];
  if (!normalized.length) throw new Error("at least one locale is required");
  if (normalized.length > 250) throw new Error("at most 250 locales per run");
  return normalized;
}

/**
 * Derive every generated case deterministically. `restoreAtEnd` defaults to
 * true, exactly as the execution planner does. A restore locale is appended
 * only when it would change the final device state.
 */
export function materializeLocaleMatrixCases(input: {
  locales: readonly string[];
  restoreLocale?: string;
  restoreAtEnd?: boolean;
}): LocaleMatrixCase[] {
  const locales = normalizeLocaleMatrixLocales(input.locales);
  const restore = input.restoreAtEnd !== false ? input.restoreLocale?.trim() : undefined;
  if (restore && locales.at(-1) !== restore) locales.push(restore);
  if (locales.length > 250) {
    throw new Error("at most 250 locale cases per run, including a final restore");
  }
  return locales.map((locale, caseIndex) => ({ caseIndex, locale }));
}
