// @refresh reload
/**
 * ThemeProvider — ported from AgentBoard / OpenCode (`@opencode-ai/ui` theme/context.tsx).
 * Injects OpenCode v1 + v2 tokens on :root (same as AgentBoard applyThemeCss).
 * Storage keys namespaced for relay.
 */

import { createEffect, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { createSimpleContext } from "../context/helper";
import oc2ThemeJson from "./themes/oc-2.json";
import relayThemeJson from "./themes/relay.json";
import { resolveThemeVariant, themeToCss } from "./resolve";
import { resolveThemeVariantV2, themeV2ToCss } from "./v2/resolve";
import type { DesktopTheme } from "./types";

export type ColorScheme = "light" | "dark" | "system";

const STORAGE_KEYS = {
  THEME_ID: "relay-theme-id",
  COLOR_SCHEME: "relay-color-scheme",
  THEME_CSS_LIGHT: "relay-theme-css-light",
  THEME_CSS_DARK: "relay-theme-css-dark",
} as const;

const THEME_STYLE_ID = "oc-theme";
let files: Record<string, () => Promise<{ default: DesktopTheme }>> | undefined;
let ids: string[] | undefined;
let known: Set<string> | undefined;

function getFiles() {
  if (files) return files;
  const lazy = import.meta.glob<{ default: DesktopTheme }>([
    "./themes/*.json",
    "!./themes/oc-2.json",
    "!./themes/relay.json",
  ]);
  files = {
    "./themes/relay.json": async () => ({ default: relayTheme }),
    "./themes/oc-2.json": async () => ({ default: oc2Theme }),
    ...lazy,
  };
  return files;
}

function themeIDs() {
  if (ids) return ids;
  ids = Object.keys(getFiles())
    .map((path) => path.slice("./themes/".length, -".json".length))
    .sort((a, b) => {
      const rank = (id: string) =>
        id === "relay" ? 0 : id === "oc-2" ? 1 : id === "opencode" ? 2 : 10;
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
  relay: "Relay",
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
const relayTheme = relayThemeJson as DesktopTheme;

function normalize(id: string | null | undefined) {
  if (id === "oc-1") return "oc-2";
  if (id === "grok") return "relay";
  return id;
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

export type ThemeAppliedDetail = {
  themeId: string;
  mode: "light" | "dark";
  background: string;
  theme: DesktopTheme;
};

function isDarkOnlyTheme(theme: DesktopTheme): boolean {
  // A theme is "dark-only" when its `light` variant carries a dark palette
  // (ink lighter than neutral) — e.g. Catppuccin Frappe/Macchiato, whose JSON
  // duplicates the dark palette into the light slot. Such themes have no
  // readable light variant (text resolves near the background), so we always
  // render the dark one instead of emitting unreadable light tokens.
  const palette = theme.light?.palette as { neutral?: string; ink?: string } | undefined;
  if (!palette?.neutral || !palette?.ink) return false;
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    if (Number.isNaN(n)) return -1;
    const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return (
      0.2126 * lin(((n >> 16) & 255) / 255) +
      0.7152 * lin(((n >> 8) & 255) / 255) +
      0.0722 * lin((n & 255) / 255)
    );
  };
  return lum(palette.ink) > lum(palette.neutral);
}

function applyThemeCss(
  theme: DesktopTheme,
  themeId: string,
  mode: "light" | "dark",
): ThemeAppliedDetail {
  if (mode === "light" && isDarkOnlyTheme(theme)) mode = "dark";
  const isDark = mode === "dark";
  const variant = isDark ? theme.dark : theme.light;
  const tokens = resolveThemeVariant(variant, isDark);
  const css = themeToCss(tokens);
  // AgentBoard applyThemeCss: inject v1 + v2 on :root.
  // Components use v1 class names (text-text-strong, bg-background-base);
  // v2 fills shell tokens (bg-v2-background-bg-deep).
  const v2 = themeV2ToCss(resolveThemeVariantV2(variant, isDark));

  // Cache non-default themes for FOUC preload (AgentBoard skips oc-2)
  if (themeId !== "oc-2") {
    write(
      mode === "dark" ? STORAGE_KEYS.THEME_CSS_DARK : STORAGE_KEYS.THEME_CSS_LIGHT,
      `${css}\n  ${v2}`,
    );
  }

  const fullCss = `:root {
  color-scheme: ${mode};
  --text-mix-blend-mode: ${isDark ? "plus-lighter" : "multiply"};
  ${css}
  ${v2}
}`;

  document.getElementById("relay-theme-preload")?.remove();
  document.getElementById("gd-theme-preload")?.remove();
  document.getElementById("oc-theme-preload")?.remove();
  ensureThemeStyleElement().textContent = fullCss;
  document.documentElement.dataset.theme = themeId;
  document.documentElement.dataset.colorScheme = mode;

  // AgentBoard applyThemeCss: hard FOUC plate (theme tokens live in :root CSS)
  const background = isDark ? "#080808" : "#fafafa";
  document.documentElement.style.backgroundColor = background;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", background);

  const detail: ThemeAppliedDetail = { themeId, mode, background, theme };
  window.dispatchEvent(new CustomEvent<ThemeAppliedDetail>("relay:theme-applied", { detail }));
  return detail;
}

function cacheThemeVariants(theme: DesktopTheme, themeId: string) {
  if (themeId === "oc-2") return;
  const darkOnly = isDarkOnlyTheme(theme);
  for (const mode of ["light", "dark"] as const) {
    // Dark-only themes have no readable light variant — cache the dark CSS
    // under both keys so the FOUC preload never flashes unreadable text.
    const isDark = mode === "dark" || darkOnly;
    const variant = isDark ? theme.dark : theme.light;
    const tokens = resolveThemeVariant(variant, isDark);
    const css = themeToCss(tokens);
    const v2 = themeV2ToCss(resolveThemeVariantV2(variant, isDark));
    write(isDark ? STORAGE_KEYS.THEME_CSS_DARK : STORAGE_KEYS.THEME_CSS_LIGHT, `${css}\n  ${v2}`);
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
    const themeId = normalize(read(STORAGE_KEYS.THEME_ID) ?? props.defaultTheme) ?? "relay";
    const colorScheme =
      (read(STORAGE_KEYS.COLOR_SCHEME) as ColorScheme | null) ??
      props.defaultColorScheme ??
      "system";
    const mode = colorScheme === "system" ? getSystemMode() : colorScheme;

    const [store, setStore] = createStore({
      themes: {
        "oc-2": oc2Theme,
        relay: relayTheme,
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

      void load(savedTheme)
        .then((theme) => {
          if (!theme) return;
          cacheThemeVariants(theme, savedTheme);
        })
        .finally(() => setStore("ready", true));

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
