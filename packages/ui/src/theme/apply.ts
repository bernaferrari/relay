import relayThemeJson from "./themes/relay.json";
import { resolveThemeVariant, themeToCss } from "./resolve";
import type { DesktopTheme } from "./types";
import { resolveThemeVariantV2, themeV2ToCss } from "./v2/resolve";

export type RelayColorScheme = "light" | "dark" | "system";

/** FOUC preload and ThemeProvider both read this unprefixed key. */
export const RELAY_COLOR_SCHEME_STORAGE_KEY = "relay-color-scheme";
const THEME_STYLE_ID = "relay-theme";
const PRELOAD_STYLE_ID = "relay-theme-preload";
const relayTheme = relayThemeJson as DesktopTheme;

export function resolvedColorScheme(preference: RelayColorScheme): "light" | "dark" {
  if (preference === "light" || preference === "dark") return preference;
  if (typeof window !== "object") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Apply the Relay palette for a color-scheme preference. Tokens land on
 * `html[data-color-scheme]` so Light/Dark beat OS `prefers-color-scheme`.
 */
export function applyRelayColorScheme(preference: RelayColorScheme): "light" | "dark" {
  const mode = resolvedColorScheme(preference);
  const variant = mode === "dark" ? relayTheme.dark : relayTheme.light;
  const css = themeToCss(resolveThemeVariant(variant, mode === "dark"));
  const v2 = themeV2ToCss(resolveThemeVariantV2(variant, mode === "dark"));
  const background = mode === "dark" ? "#080808" : "#fafafa";
  const style = ensureThemeStyle();
  style.textContent = `html[data-color-scheme="${mode}"] {
  color-scheme: ${mode};
  --text-mix-blend-mode: ${mode === "dark" ? "plus-lighter" : "multiply"};
  ${css}
  ${v2}
}`;
  document.getElementById(PRELOAD_STYLE_ID)?.remove();
  document.documentElement.dataset.theme = "relay";
  document.documentElement.dataset.colorScheme = mode;
  document.documentElement.dataset.colorSchemePreference = preference;
  document.documentElement.style.colorScheme = mode;
  document.documentElement.style.backgroundColor = background;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
  persistPreference(preference);
  persistCachedCss(mode, css, v2);
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

function persistCachedCss(mode: "light" | "dark", css: string, v2: string): void {
  try {
    localStorage.setItem(`relay-theme-css-${mode}`, `${css}\n  ${v2}`);
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

function ensureThemeStyle(): HTMLStyleElement {
  const existing = document.getElementById(THEME_STYLE_ID);
  if (existing instanceof HTMLStyleElement) {
    document.head.appendChild(existing);
    return existing;
  }
  const element = document.createElement("style");
  element.id = THEME_STYLE_ID;
  document.head.appendChild(element);
  return element;
}
