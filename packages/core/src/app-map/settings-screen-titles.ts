/**
 * Named Grok Settings pages. Child sheets often keep a toolbar title of
 * "Settings", so Relay must prefer these labels over hub chrome when deciding
 * whether two observations are the same screen.
 */
export const SETTINGS_CHILD_TITLES =
  /^(Appearance|Haptics|Widget|Usage|Advanced|Voice|Memory|Connectors|Skills|Customize Grok|NSFW Preferences|Shared Conversations|Data Controls|Help & Support|Kids Mode|Data & Information|Voice Library|Projects|Automations)$/i;

export const SETTINGS_HUB_OR_CHILD_TITLES =
  /^(Settings|Appearance|Haptics|Widget|Usage|Advanced|Voice|Memory|Connectors|Skills|Customize Grok|NSFW Preferences|Shared Conversations|Data Controls|Help & Support|Kids Mode)$/i;

/** True for a distinct Settings child page title (not the Settings hub). */
export function isSettingsChildTitle(title: string | undefined): boolean {
  const trimmed = title?.trim();
  return Boolean(trimmed && SETTINGS_CHILD_TITLES.test(trimmed));
}

/**
 * Distinct Settings pages must not share an App Map node just because chrome
 * fingerprints briefly collide (shared toolbar / nav identifiers).
 */
export function settingsScreenTitlesConflict(
  left: string | undefined,
  right: string | undefined,
): boolean {
  const a = left?.trim();
  const b = right?.trim();
  if (!a || !b || a === b) return false;
  const aHub = /^Settings$/i.test(a);
  const bHub = /^Settings$/i.test(b);
  const aChild = isSettingsChildTitle(a);
  const bChild = isSettingsChildTitle(b);
  if ((aHub && bChild) || (bHub && aChild)) return true;
  if (aChild && bChild) return true;
  return false;
}

/** Prefer a known Settings child label over a misleading hub toolbar title. */
export function preferSettingsChildTitle(
  observedTitle: string | undefined,
  preferredLabel: string | undefined,
): string | undefined {
  const title = observedTitle?.trim();
  const label = preferredLabel?.trim();
  if (label && isSettingsChildTitle(label) && (!title || /^Settings$/i.test(title))) {
    return label;
  }
  return title || label || undefined;
}
