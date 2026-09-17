import type { Platform } from "../platform/types";

export type ColorSchemePreference = "light" | "dark" | "system";

export const APPEARANCE_STORAGE_KEY = "appearance.colorScheme";
export const RELAY_COLOR_SCHEME_STORAGE_KEY = "relay-color-scheme";

const THEME_STYLE_ID = "relay-theme";
const PRELOAD_STYLE_ID = "relay-theme-preload";
const CACHED_THEME_CSS_KEYS = [
  "relay-theme-css-light",
  "relay-theme-css-dark",
  "grok-device-theme-css-light",
  "grok-device-theme-css-dark",
] as const;

let appliedVersion = 0;
export function colorSchemeVersion(): number {
  return appliedVersion;
}

export function validColorScheme(value: string | null | undefined): ColorSchemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolvedColorScheme(preference: ColorSchemePreference): "light" | "dark" {
  if (preference === "light" || preference === "dark") return preference;
  if (typeof window !== "object") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyColorScheme(value: ColorSchemePreference): void {
  appliedVersion += 1;
  const mode = resolvedColorScheme(value);
  const isDark = mode === "dark";
  const root = document.documentElement;

  document.getElementById(THEME_STYLE_ID)?.remove();
  document.getElementById(PRELOAD_STYLE_ID)?.remove();

  root.dataset.theme = "relay";
  root.dataset.colorScheme = mode;
  root.dataset.colorSchemePreference = value;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = mode;
  root.style.removeProperty("background-color");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", isDark ? "#252525" : "#ffffff");

  persistPreference(value);
  clearCachedThemeCss();
  bindSystemPreferenceListener();
}

export async function readColorScheme(platform: Platform): Promise<ColorSchemePreference> {
  return validColorScheme(await Promise.resolve(platform.storage.get(APPEARANCE_STORAGE_KEY)));
}

function persistPreference(preference: ColorSchemePreference): void {
  try {
    localStorage.setItem(RELAY_COLOR_SCHEME_STORAGE_KEY, preference);
  } catch {
    /* Storage is optional in locked-down browser contexts. */
  }
}

function clearCachedThemeCss(): void {
  try {
    for (const key of CACHED_THEME_CSS_KEYS) localStorage.removeItem(key);
  } catch {
    /* Storage is optional in locked-down browser contexts. */
  }
}

let systemPreferenceListenerBound = false;

function bindSystemPreferenceListener(): void {
  if (systemPreferenceListenerBound || typeof window !== "object") return;
  systemPreferenceListenerBound = true;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (validColorScheme(readStoredPreference()) === "system") applyColorScheme("system");
  });
}

function readStoredPreference(): string | null {
  try {
    return (
      localStorage.getItem(RELAY_COLOR_SCHEME_STORAGE_KEY) ??
      localStorage.getItem("relay:appearance.colorScheme")
    );
  } catch {
    return null;
  }
}
