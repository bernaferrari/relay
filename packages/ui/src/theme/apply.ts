export type RelayColorScheme = "light" | "dark" | "system";

/** FOUC preload and appearance settings both read this unprefixed key. */
export const RELAY_COLOR_SCHEME_STORAGE_KEY = "relay-color-scheme";
const THEME_STYLE_ID = "relay-theme";
const PRELOAD_STYLE_ID = "relay-theme-preload";
const CACHED_THEME_CSS_KEYS = [
  "relay-theme-css-light",
  "relay-theme-css-dark",
  "grok-device-theme-css-light",
  "grok-device-theme-css-dark",
] as const;

export function resolvedColorScheme(preference: RelayColorScheme): "light" | "dark" {
  if (preference === "light" || preference === "dark") return preference;
  if (typeof window !== "object") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Apply Light/Dark for the React product. Chrome comes from ui-react
 * globals.css via `.dark` / `data-color-scheme`. This does not inject a
 * generated token sheet.
 */
export function applyRelayColorScheme(preference: RelayColorScheme): "light" | "dark" {
  const mode = resolvedColorScheme(preference);
  const isDark = mode === "dark";
  const root = document.documentElement;

  document.getElementById(THEME_STYLE_ID)?.remove();
  document.getElementById(PRELOAD_STYLE_ID)?.remove();

  root.dataset.theme = "relay";
  root.dataset.colorScheme = mode;
  root.dataset.colorSchemePreference = preference;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = mode;
  root.style.removeProperty("background-color");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", isDark ? "#252525" : "#ffffff");

  persistPreference(preference);
  clearCachedThemeCss();
  bindSystemPreferenceListener();
  return mode;
}

function persistPreference(preference: RelayColorScheme): void {
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
    const stored = readStoredPreference();
    if (stored === "system") applyRelayColorScheme("system");
  });
}

function readStoredPreference(): RelayColorScheme {
  try {
    const value =
      localStorage.getItem(RELAY_COLOR_SCHEME_STORAGE_KEY) ??
      localStorage.getItem("relay:appearance.colorScheme");
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}
