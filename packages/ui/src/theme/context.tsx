// @refresh reload
/**
 * ThemeProvider — ported from OpenCode (`@opencode-ai/ui` theme/context.tsx).
 * Uses full resolve + v2/resolve token pipelines. Storage keys namespaced for grok-device.
 */

import { createEffect, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { createSimpleContext } from "../context/helper";
import oc2ThemeJson from "./themes/oc-2.json";
import grokThemeJson from "./themes/grok.json";
import { resolveThemeVariant, themeToCss } from "./resolve";
import { resolveThemeVariantV2, themeV2ToCss } from "./v2/resolve";
import type { DesktopTheme, HexColor } from "./types";

export type ColorScheme = "light" | "dark" | "system";

const STORAGE_KEYS = {
  THEME_ID: "grok-device-theme-id",
  COLOR_SCHEME: "grok-device-color-scheme",
  THEME_CSS_LIGHT: "grok-device-theme-css-light",
  THEME_CSS_DARK: "grok-device-theme-css-dark",
} as const;

const THEME_STYLE_ID = "oc-theme";
let files: Record<string, () => Promise<{ default: DesktopTheme }>> | undefined;
let ids: string[] | undefined;
let known: Set<string> | undefined;

function getFiles() {
  if (files) return files;
  files = import.meta.glob<{ default: DesktopTheme }>("./themes/*.json");
  return files;
}

function themeIDs() {
  if (ids) return ids;
  ids = Object.keys(getFiles())
    .map((path) => path.slice("./themes/".length, -".json".length))
    .sort((a, b) => {
      const rank = (id: string) =>
        id === "grok" ? 0 : id === "oc-2" ? 1 : id === "opencode" ? 2 : 10;
      const d = rank(a) - rank(b);
      return d !== 0 ? d : a.localeCompare(b);
    });
  return ids;
}

function knownThemes() {
  if (known) return known;
  known = new Set(themeIDs());
  return known;
}

const names: Record<string, string> = {
  grok: "Grok",
  "oc-2": "OC-2",
  amoled: "AMOLED",
  aura: "Aura",
  ayu: "Ayu",
  carbonfox: "Carbonfox",
  catppuccin: "Catppuccin",
  "catppuccin-frappe": "Catppuccin Frappe",
  "catppuccin-macchiato": "Catppuccin Macchiato",
  cobalt2: "Cobalt2",
  cursor: "Cursor",
  dracula: "Dracula",
  everforest: "Everforest",
  flexoki: "Flexoki",
  github: "GitHub",
  gruvbox: "Gruvbox",
  kanagawa: "Kanagawa",
  "lucent-orng": "Lucent Orng",
  material: "Material",
  matrix: "Matrix",
  mercury: "Mercury",
  monokai: "Monokai",
  nightowl: "Night Owl",
  nord: "Nord",
  "one-dark": "One Dark",
  onedarkpro: "One Dark Pro",
  opencode: "OpenCode",
  orng: "Orng",
  "osaka-jade": "Osaka Jade",
  palenight: "Palenight",
  rosepine: "Rose Pine",
  shadesofpurple: "Shades of Purple",
  solarized: "Solarized",
  synthwave84: "Synthwave '84",
  tokyonight: "Tokyonight",
  vercel: "Vercel",
  vesper: "Vesper",
  zenburn: "Zenburn",
};

const oc2Theme = oc2ThemeJson as DesktopTheme;
const grokTheme = grokThemeJson as DesktopTheme;

function normalize(id: string | null | undefined) {
  return id === "oc-1" ? "oc-2" : id;
}

function read(key: string) {
  if (typeof localStorage !== "object") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  if (typeof localStorage !== "object") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function drop(key: string) {
  if (typeof localStorage !== "object") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function clearCssCache() {
  drop(STORAGE_KEYS.THEME_CSS_LIGHT);
  drop(STORAGE_KEYS.THEME_CSS_DARK);
}

function ensureThemeStyleElement(): HTMLStyleElement {
  const existing = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  if (existing) return existing;
  const element = document.createElement("style");
  element.id = THEME_STYLE_ID;
  document.head.appendChild(element);
  return element;
}

function getSystemMode(): "light" | "dark" {
  if (typeof window !== "object") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Product shell aliases so Stage/PostHog-ish CSS keeps working on top of OpenCode tokens.
 * OpenCode remains the token source; these are pure var() bridges.
 */
function productAliasCss(): string {
  return `
  --bg: var(--background-base);
  --bg-light: var(--surface-base, var(--background-base));
  --stage: var(--background-base);
  --panel: var(--surface-raised-base, var(--surface-base, var(--background-base)));
  --raise: var(--surface-raised-base, var(--surface-base, var(--background-stronger, var(--background-base))));
  --raise-2: var(--border-weak-base, var(--border-base, var(--background-stronger)));
  --line: var(--border-weak-base, var(--border-base));
  --line2: var(--border-base, var(--border-strong-base));
  --text: var(--text-strong);
  --dim: var(--text-base, var(--text-weak));
  --faint: var(--text-weak, var(--text-weaker));
  --muted: var(--text-weaker, var(--text-weak));
  --acc: var(--icon-info-base, var(--text-info-base, var(--button-primary-base)));
  --acc-hover: var(--button-primary-hover, var(--acc));
  --acc-soft: color-mix(in srgb, var(--acc) 16%, transparent);
  --acc-line: color-mix(in srgb, var(--acc) 40%, transparent);
  --acc-text: var(--acc);
  --pass: var(--text-success-base, var(--icon-success-base));
  --pass-soft: var(--surface-success-base, color-mix(in srgb, var(--pass) 14%, transparent));
  --heal: var(--text-warning-base, var(--icon-warning-base));
  --heal-soft: var(--surface-warning-base, color-mix(in srgb, var(--heal) 14%, transparent));
  --fail: var(--text-critical-base, var(--icon-critical-base, var(--text-error-base)));
  --fail-soft: var(--surface-critical-base, color-mix(in srgb, var(--fail) 14%, transparent));
  --color-bg: var(--background-base);
  --color-surface: var(--panel);
  --color-text: var(--text-strong);
  --color-text-muted: var(--text-weak);
  --color-primary: var(--acc);
  --color-success: var(--pass);
  --color-warning: var(--heal);
  --color-error: var(--fail);
  --color-border: var(--line);
  --surface: var(--panel);
  --primary: var(--acc);
  --success: var(--pass);
  --warning: var(--heal);
  --error: var(--fail);
  --border: var(--line);
`;
}

export type ThemeAppliedDetail = {
  themeId: string;
  mode: "light" | "dark";
  background: string;
  theme: DesktopTheme;
};

function backgroundFromTokens(cssBlock: string, isDark: boolean): string {
  const m = cssBlock.match(/--background-base:\s*([^;]+);/);
  if (m?.[1]) {
    const v = m[1].trim();
    if (v.startsWith("#")) return v;
  }
  return isDark ? "#080808" : "#fafafa";
}

function applyThemeCss(
  theme: DesktopTheme,
  themeId: string,
  mode: "light" | "dark",
): ThemeAppliedDetail {
  const isDark = mode === "dark";
  const variant = isDark ? theme.dark : theme.light;
  const tokens = resolveThemeVariant(variant, isDark);
  const css = themeToCss(tokens);
  const v2 = themeV2ToCss(resolveThemeVariantV2(variant, isDark));
  const aliases = productAliasCss();

  // Cache non-default themes for FOUC preload (OpenCode skips oc-2)
  if (themeId !== "oc-2") {
    write(
      isDark ? STORAGE_KEYS.THEME_CSS_DARK : STORAGE_KEYS.THEME_CSS_LIGHT,
      `${css}\n  ${v2}\n  ${aliases}`,
    );
  }

  const fullCss = `:root {
  color-scheme: ${mode};
  --text-mix-blend-mode: ${isDark ? "plus-lighter" : "multiply"};
  ${css}
  ${v2}
  ${aliases}
}`;

  document.getElementById("gd-theme-preload")?.remove();
  document.getElementById("oc-theme-preload")?.remove();
  ensureThemeStyleElement().textContent = fullCss;
  document.documentElement.dataset.theme = themeId;
  document.documentElement.dataset.colorScheme = mode;

  const background = backgroundFromTokens(css, isDark);
  document.documentElement.style.backgroundColor = background;
  if (document.body) document.body.style.backgroundColor = background;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", background);

  const detail: ThemeAppliedDetail = { themeId, mode, background, theme };
  window.dispatchEvent(
    new CustomEvent<ThemeAppliedDetail>("grok-device:theme-applied", { detail }),
  );
  return detail;
}

function cacheThemeVariants(theme: DesktopTheme, themeId: string) {
  if (themeId === "oc-2") return;
  for (const mode of ["light", "dark"] as const) {
    const isDark = mode === "dark";
    const variant = isDark ? theme.dark : theme.light;
    const tokens = resolveThemeVariant(variant, isDark);
    const css = themeToCss(tokens);
    const v2 = themeV2ToCss(resolveThemeVariantV2(variant, isDark));
    const aliases = productAliasCss();
    write(
      isDark ? STORAGE_KEYS.THEME_CSS_DARK : STORAGE_KEYS.THEME_CSS_LIGHT,
      `${css}\n  ${v2}\n  ${aliases}`,
    );
  }
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  gate: false,
  init: (props: {
    defaultTheme?: string;
    defaultColorScheme?: ColorScheme;
    onThemeApplied?: (detail: ThemeAppliedDetail) => void;
  }) => {
    const themeId = normalize(read(STORAGE_KEYS.THEME_ID) ?? props.defaultTheme) ?? "grok";
    const colorScheme =
      (read(STORAGE_KEYS.COLOR_SCHEME) as ColorScheme | null) ??
      props.defaultColorScheme ??
      "system";
    const mode = colorScheme === "system" ? getSystemMode() : colorScheme;

    const [store, setStore] = createStore({
      themes: {
        "oc-2": oc2Theme,
        grok: grokTheme,
      } as Record<string, DesktopTheme>,
      themeId,
      colorScheme,
      mode,
      previewThemeId: null as string | null,
      previewScheme: null as ColorScheme | null,
      ready: false,
    });

    const loads = new Map<string, Promise<DesktopTheme | undefined>>();

    const load = (id: string) => {
      const next = normalize(id);
      if (!next) return Promise.resolve(undefined);
      const hit = store.themes[next];
      if (hit) return Promise.resolve(hit);
      const pending = loads.get(next);
      if (pending) return pending;
      const file = getFiles()[`./themes/${next}.json`];
      if (!file) return Promise.resolve(undefined);
      const task = file()
        .then((mod) => {
          const theme = mod.default;
          setStore("themes", next, theme);
          return theme;
        })
        .finally(() => {
          loads.delete(next);
        });
      loads.set(next, task);
      return task;
    };

    const applyTheme = (theme: DesktopTheme, id: string, nextMode: "light" | "dark") => {
      const detail = applyThemeCss(theme, id, nextMode);
      props.onThemeApplied?.(detail);
    };

    const ids = () => {
      const extra = Object.keys(store.themes)
        .filter((id) => !knownThemes().has(id))
        .sort();
      const all = themeIDs();
      if (extra.length === 0) return all;
      return [...all, ...extra];
    };

    const loadThemes = () => Promise.all(themeIDs().map(load)).then(() => store.themes);

    onMount(() => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onMedia = () => {
        if (store.colorScheme !== "system") return;
        setStore("mode", getSystemMode());
      };
      mq.addEventListener("change", onMedia);

      const onStorage = (e: StorageEvent) => {
        if (e.key === STORAGE_KEYS.THEME_ID && e.newValue) {
          const next = normalize(e.newValue);
          if (!next) return;
          if (!knownThemes().has(next) && !store.themes[next]) return;
          setStore("themeId", next);
          void load(next).then((theme) => {
            if (!theme || store.themeId !== next) return;
            cacheThemeVariants(theme, next);
          });
        }
        if (e.key === STORAGE_KEYS.COLOR_SCHEME && e.newValue) {
          setStore("colorScheme", e.newValue as ColorScheme);
          setStore(
            "mode",
            e.newValue === "system" ? getSystemMode() : (e.newValue as "light" | "dark"),
          );
        }
      };
      window.addEventListener("storage", onStorage);

      const rawTheme = read(STORAGE_KEYS.THEME_ID);
      const savedTheme = normalize(rawTheme) ?? themeId;
      const savedScheme = (read(STORAGE_KEYS.COLOR_SCHEME) as ColorScheme | null) ?? colorScheme;
      if (savedTheme && savedTheme !== rawTheme) {
        write(STORAGE_KEYS.THEME_ID, savedTheme);
      }
      setStore("themeId", savedTheme);
      setStore("colorScheme", savedScheme);
      setStore("mode", savedScheme === "system" ? getSystemMode() : savedScheme);

      void loadThemes().then(() => setStore("ready", true));
      void load(savedTheme).then((theme) => {
        if (!theme) return;
        cacheThemeVariants(theme, savedTheme);
      });

      return () => {
        mq.removeEventListener("change", onMedia);
        window.removeEventListener("storage", onStorage);
      };
    });

    createEffect(() => {
      const id = store.previewThemeId ?? store.themeId;
      const scheme = store.previewScheme ?? store.colorScheme;
      const nextMode = scheme === "system" ? getSystemMode() : scheme;
      const theme = store.themes[id];
      if (!theme) return;
      applyTheme(theme, id, nextMode);
    });

    const setTheme = (value: string | ((prev: string) => string)) => {
      clearCssCache();
      if (typeof value === "function") {
        const next = normalize(value(store.themeId));
        if (!next) return;
        if (!knownThemes().has(next) && !store.themes[next]) {
          console.warn(`Theme "${next}" not found`);
          return;
        }
        setStore("themeId", next);
        void load(next).then((theme) => {
          if (!theme || store.themeId !== next) return;
          cacheThemeVariants(theme, next);
          write(STORAGE_KEYS.THEME_ID, next);
        });
        return;
      }
      const next = normalize(value);
      if (!next) return;
      if (!knownThemes().has(next) && !store.themes[next]) {
        console.warn(`Theme "${next}" not found`);
        return;
      }
      setStore("themeId", next);
      void load(next).then((theme) => {
        if (!theme || store.themeId !== next) return;
        cacheThemeVariants(theme, next);
        write(STORAGE_KEYS.THEME_ID, next);
      });
    };

    const setColorScheme = (scheme: ColorScheme) => {
      setStore("colorScheme", scheme);
      write(STORAGE_KEYS.COLOR_SCHEME, scheme);
      setStore("mode", scheme === "system" ? getSystemMode() : scheme);
    };

    const all = () =>
      ids().map((id) => ({
        id,
        name: store.themes[id]?.name ?? names[id] ?? id,
      }));

    const swatches = (id: string) => {
      const t = store.themes[id];
      if (!t) return null;
      const p = (store.mode === "dark" ? t.dark : t.light).palette as
        | { neutral?: string; ink?: string; primary?: string }
        | undefined;
      if (!p?.neutral) return null;
      return {
        bg: p.neutral,
        primary: p.primary ?? p.neutral,
        text: p.ink ?? "#fff",
        surface: p.neutral,
      };
    };

    return {
      themeId: () => store.themeId,
      colorScheme: () => store.colorScheme,
      mode: () => store.mode,
      ready: () => store.ready,
      themes: () => store.themes,
      theme: () => store.themes[store.themeId],
      ids,
      all,
      name: (id: string) => store.themes[id]?.name ?? names[id] ?? id,
      swatches,
      loadThemes,
      setTheme,
      setColorScheme,
      // OpenCode preview API (hover themes in settings)
      previewThemeId: () => store.previewThemeId,
      previewScheme: () => store.previewScheme,
      setPreviewTheme: (id: string | null) => {
        if (id === null) {
          setStore("previewThemeId", null);
          return;
        }
        const next = normalize(id);
        if (!next) return;
        if (store.themes[next]) {
          setStore("previewThemeId", next);
          return;
        }
        void load(next).then((theme) => {
          if (!theme) return;
          setStore("previewThemeId", next);
        });
      },
      setPreviewScheme: (scheme: ColorScheme | null) => setStore("previewScheme", scheme),
      registerTheme: (theme: DesktopTheme) => {
        clearCssCache();
        setStore("themes", theme.id, theme);
      },
    };
  },
});
