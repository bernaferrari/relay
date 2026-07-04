// @refresh reload

import { createEffect, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { createSimpleContext } from "../context/helper";
import grokThemeJson from "./themes/grok.json";
import { resolveThemeVariant, themeToCss } from "./resolve";
import type { ColorScheme, Theme } from "./types";

export type { ColorScheme, Theme };

const STORAGE_KEYS = {
  THEME_ID: "grok-device-theme-id",
  COLOR_SCHEME: "grok-device-color-scheme",
  THEME_CSS_LIGHT: "grok-device-theme-css-light",
  THEME_CSS_DARK: "grok-device-theme-css-dark",
} as const;

const THEME_STYLE_ID = "gd-theme";
const DEFAULT_THEME_ID = "grok";

let files: Record<string, () => Promise<{ default: Theme }>> | undefined;
let ids: string[] | undefined;
let known: Set<string> | undefined;

function getFiles() {
  if (files) return files;
  files = import.meta.glob<{ default: Theme }>("./themes/*.json");
  return files;
}

function themeIDs() {
  if (ids) return ids;
  ids = Object.keys(getFiles())
    .map((path) => path.slice("./themes/".length, -".json".length))
    .sort();
  return ids;
}

function knownThemes() {
  if (known) return known;
  known = new Set(themeIDs());
  return known;
}

const names: Record<string, string> = {
  grok: "Grok",
  dracula: "Dracula",
  nord: "Nord",
};

const grokTheme = grokThemeJson as Theme;

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
    /* ignore quota / private mode */
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

function applyThemeCss(theme: Theme, themeId: string, mode: "light" | "dark") {
  const isDark = mode === "dark";
  const variant = isDark ? theme.dark : theme.light;
  const tokens = resolveThemeVariant(variant);
  const css = themeToCss(tokens);

  write(isDark ? STORAGE_KEYS.THEME_CSS_DARK : STORAGE_KEYS.THEME_CSS_LIGHT, css);

  const fullCss = `:root {
  color-scheme: ${mode};
  ${css}
}`;

  document.getElementById("gd-theme-preload")?.remove();
  ensureThemeStyleElement().textContent = fullCss;
  document.documentElement.dataset.theme = themeId;
  document.documentElement.dataset.colorScheme = mode;
  document.documentElement.style.backgroundColor = variant.palette.bg;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", variant.palette.bg);
}

function cacheThemeVariants(theme: Theme) {
  for (const mode of ["light", "dark"] as const) {
    const variant = mode === "dark" ? theme.dark : theme.light;
    const css = themeToCss(resolveThemeVariant(variant));
    write(mode === "dark" ? STORAGE_KEYS.THEME_CSS_DARK : STORAGE_KEYS.THEME_CSS_LIGHT, css);
  }
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: { defaultTheme?: string; defaultColorScheme?: ColorScheme }) => {
    const themeId = read(STORAGE_KEYS.THEME_ID) ?? props.defaultTheme ?? DEFAULT_THEME_ID;
    const colorScheme =
      (read(STORAGE_KEYS.COLOR_SCHEME) as ColorScheme | null) ??
      props.defaultColorScheme ??
      "system";
    const mode = colorScheme === "system" ? getSystemMode() : colorScheme;

    const [store, setStore] = createStore({
      themes: {
        grok: grokTheme,
      } as Record<string, Theme>,
      themeId,
      colorScheme,
      mode,
    });

    const loads = new Map<string, Promise<Theme | undefined>>();

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
        .finally(() => {
          loads.delete(id);
        });
      loads.set(id, task);
      return task;
    };

    const applyTheme = (theme: Theme, id: string, nextMode: "light" | "dark") => {
      applyThemeCss(theme, id, nextMode);
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
      applyTheme(theme, store.themeId, store.mode);
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
      ids,
      name: (id: string) => store.themes[id]?.name ?? names[id] ?? id,
      loadThemes,
      themes: () => store.themes,
      setTheme,
      setColorScheme,
      registerTheme: (theme: Theme) => setStore("themes", theme.id, theme),
    };
  },
});
