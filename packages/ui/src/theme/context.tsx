// @refresh reload

import { createEffect, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { createSimpleContext } from "../context/helper";
import grokThemeJson from "./themes/grok.json";
import { resolveThemeVariant, themeBackground, themeToCss } from "./resolve";
import type { ColorScheme, DesktopTheme } from "./types";

export type { ColorScheme, DesktopTheme as Theme };

const STORAGE_KEYS = {
  THEME_ID: "grok-device-theme-id",
  COLOR_SCHEME: "grok-device-color-scheme",
  THEME_CSS_LIGHT: "grok-device-theme-css-light",
  THEME_CSS_DARK: "grok-device-theme-css-dark",
} as const;

const THEME_STYLE_ID = "gd-theme";
/** Default product theme; OpenCode themes available in the picker. */
const DEFAULT_THEME_ID = "grok";

const NAMES: Record<string, string> = {
  grok: "Grok",
  "oc-2": "OC-2",
  opencode: "OpenCode",
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

let files: Record<string, () => Promise<{ default: DesktopTheme }>> | undefined;
let cachedIds: string[] | undefined;
let known: Set<string> | undefined;

function getFiles() {
  if (files) return files;
  files = import.meta.glob<{ default: DesktopTheme }>("./themes/*.json");
  return files;
}

function themeIDs() {
  if (cachedIds) return cachedIds;
  cachedIds = Object.keys(getFiles())
    .map((path) => path.slice("./themes/".length, -".json".length))
    .sort((a, b) => {
      const rank = (id: string) =>
        id === "grok" ? 0 : id === "opencode" ? 1 : id === "oc-2" ? 2 : 10;
      const d = rank(a) - rank(b);
      return d !== 0 ? d : a.localeCompare(b);
    });
  return cachedIds;
}

function knownThemes() {
  if (known) return known;
  known = new Set(themeIDs());
  return known;
}

const grokTheme = grokThemeJson as DesktopTheme;

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
};

function applyThemeCss(theme: DesktopTheme, themeId: string, mode: "light" | "dark") {
  const variant = mode === "dark" ? theme.dark : theme.light;
  const tokens = resolveThemeVariant(variant);
  const css = themeToCss(tokens);
  const bg = themeBackground(theme, mode);

  write(mode === "dark" ? STORAGE_KEYS.THEME_CSS_DARK : STORAGE_KEYS.THEME_CSS_LIGHT, css);

  ensureThemeStyleElement().textContent = `:root {
  color-scheme: ${mode};
  ${css}
}`;

  document.getElementById("gd-theme-preload")?.remove();
  document.documentElement.dataset.theme = themeId;
  document.documentElement.dataset.colorScheme = mode;
  document.documentElement.style.backgroundColor = bg;
  if (document.body) document.body.style.backgroundColor = bg;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", bg);

  window.dispatchEvent(
    new CustomEvent<ThemeAppliedDetail>("grok-device:theme-applied", {
      detail: { themeId, mode, background: bg },
    }),
  );
}

function cacheThemeVariants(theme: DesktopTheme) {
  for (const mode of ["light", "dark"] as const) {
    const variant = mode === "dark" ? theme.dark : theme.light;
    write(
      mode === "dark" ? STORAGE_KEYS.THEME_CSS_DARK : STORAGE_KEYS.THEME_CSS_LIGHT,
      themeToCss(resolveThemeVariant(variant)),
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
    const themeId = read(STORAGE_KEYS.THEME_ID) ?? props.defaultTheme ?? DEFAULT_THEME_ID;
    const colorScheme =
      (read(STORAGE_KEYS.COLOR_SCHEME) as ColorScheme | null) ??
      props.defaultColorScheme ??
      "system";
    const mode = colorScheme === "system" ? getSystemMode() : colorScheme;

    const [store, setStore] = createStore({
      themes: { grok: grokTheme } as Record<string, DesktopTheme>,
      themeId,
      colorScheme,
      mode,
      ready: false,
    });

    const loads = new Map<string, Promise<DesktopTheme | undefined>>();

    const load = (id: string) => {
      const hit = store.themes[id];
      if (hit) return Promise.resolve(hit);
      const pending = loads.get(id);
      if (pending) return pending;
      const file = getFiles()[`./themes/${id}.json`];
      if (!file) return Promise.resolve(undefined);
      const task = file()
        .then((mod) => {
          const theme = mod.default;
          setStore("themes", id, theme);
          return theme;
        })
        .finally(() => loads.delete(id));
      loads.set(id, task);
      return task;
    };

    const ids = () => themeIDs();

    const loadThemes = () => Promise.all(themeIDs().map(load)).then(() => store.themes);

    const name = (id: string) => store.themes[id]?.name ?? NAMES[id] ?? id;

    /** Swatches from OpenCode palette (neutral + primary). */
    const swatches = (id: string) => {
      const t = store.themes[id];
      if (!t) return null;
      const p = (store.mode === "dark" ? t.dark : t.light).palette;
      if (!p) return null;
      return {
        bg: p.neutral,
        primary: p.primary,
        text: p.ink,
        surface: p.neutral,
      };
    };

    onMount(() => {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const onMedia = () => {
        if (store.colorScheme !== "system") return;
        setStore("mode", getSystemMode());
      };
      mediaQuery.addEventListener("change", onMedia);

      const onStorage = (e: StorageEvent) => {
        if (e.key === STORAGE_KEYS.THEME_ID && e.newValue) {
          if (!knownThemes().has(e.newValue) && !store.themes[e.newValue]) return;
          setStore("themeId", e.newValue);
          void load(e.newValue).then((theme) => {
            if (!theme || store.themeId !== e.newValue) return;
            cacheThemeVariants(theme);
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

      void loadThemes().then(() => setStore("ready", true));
      void load(store.themeId).then((theme) => {
        if (!theme) return;
        cacheThemeVariants(theme);
      });

      return () => {
        mediaQuery.removeEventListener("change", onMedia);
        window.removeEventListener("storage", onStorage);
      };
    });

    createEffect(() => {
      const theme = store.themes[store.themeId];
      if (!theme) return;
      applyThemeCss(theme, store.themeId, store.mode);
      props.onThemeApplied?.({
        themeId: store.themeId,
        mode: store.mode,
        background: themeBackground(theme, store.mode),
      });
    });

    const setTheme = (id: string) => {
      if (!knownThemes().has(id) && !store.themes[id]) {
        console.warn(`Theme "${id}" not found`);
        return;
      }
      setStore("themeId", id);
      void load(id).then((theme) => {
        if (!theme || store.themeId !== id) return;
        cacheThemeVariants(theme);
        write(STORAGE_KEYS.THEME_ID, id);
      });
    };

    const setColorScheme = (scheme: ColorScheme) => {
      setStore("colorScheme", scheme);
      write(STORAGE_KEYS.COLOR_SCHEME, scheme);
      setStore("mode", scheme === "system" ? getSystemMode() : scheme);
    };

    return {
      themeId: () => store.themeId,
      colorScheme: () => store.colorScheme,
      mode: () => store.mode,
      ready: () => store.ready,
      ids,
      name,
      swatches,
      loadThemes,
      themes: () => store.themes,
      setTheme,
      setColorScheme,
      registerTheme: (theme: DesktopTheme) => setStore("themes", theme.id, theme),
    };
  },
});
