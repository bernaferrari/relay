/**
 * Settings screen identity, in the words the app profiles supply.
 *
 * A child sheet often keeps the hub's toolbar title, so Relay has to prefer the
 * page's own name when deciding whether two observations are the same screen.
 * Which names those are is app knowledge and lives in `discovery-app-profiles`,
 * not here: this module only owns the comparison.
 */
import {
  isSettingsChildTitle as isProfileSettingsChildTitle,
  isSettingsHubTitle,
} from "../discovery-app-profiles.js";

/** True for a distinct Settings child page title (not the Settings hub). */
export function isSettingsChildTitle(title: string | undefined): boolean {
  const trimmed = title?.trim();
  return Boolean(trimmed && !isSettingsHubTitle(trimmed) && isProfileSettingsChildTitle(trimmed));
}

/** True for the Settings hub itself or any of its named child pages. */
export function isSettingsHubOrChildTitle(title: string | undefined): boolean {
  const trimmed = title?.trim();
  return Boolean(trimmed && (isSettingsHubTitle(trimmed) || isProfileSettingsChildTitle(trimmed)));
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
  const aHub = isSettingsHubTitle(a);
  const bHub = isSettingsHubTitle(b);
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
  if (label && isSettingsChildTitle(label) && (!title || isSettingsHubTitle(title))) {
    return label;
  }
  return title || label || undefined;
}
