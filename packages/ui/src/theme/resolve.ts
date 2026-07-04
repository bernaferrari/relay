/**
 * Resolve OpenCode DesktopTheme palettes → CSS variables for our product shell.
 * Mapping follows OpenCode intent: neutral=canvas, ink=text, primary=accent action.
 */
import type { DesktopTheme, ResolvedCssVars, ThemePaletteColors, ThemeVariant } from "./types";

function hex(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  const s = String(v).trim();
  if (s.startsWith("var(")) return s;
  return s.startsWith("#") ? s : `#${s}`;
}

function mixHint(a: string, b: string, t: number): string {
  // Prefer modern CSS mixing so we don't need a color runtime
  if (a.startsWith("var(") || b.startsWith("var(")) return a;
  return `color-mix(in srgb, ${a} ${Math.round((1 - t) * 100)}%, ${b})`;
}

/** Expand an OpenCode palette into product + Stage CSS tokens. */
export function resolvePalette(p: ThemePaletteColors): ResolvedCssVars {
  const neutral = hex(p.neutral, "#1d1f27");
  const ink = hex(p.ink, "#eeefe9");
  const primary = hex(p.primary, "#1d4aff");
  const success = hex(p.success, "#42d392");
  const warning = hex(p.warning ?? p.accent, "#f7a501");
  const error = hex(p.error, "#f54e00");
  const info = hex(p.info, primary);
  const accent = hex(p.accent, warning);

  const bg = neutral;
  const text = ink;
  // surface: slight lift off neutral toward ink (readable panels)
  const surface = mixHint(neutral, ink, 0.07);
  const border = mixHint(neutral, ink, 0.16);
  const textMuted = mixHint(ink, neutral, 0.42);
  const stage = mixHint(neutral, "#000000", 0.12);

  return {
    // OpenCode-native semantic names (for parity / future UI)
    "--oc-neutral": neutral,
    "--oc-ink": ink,
    "--oc-primary": primary,
    "--oc-success": success,
    "--oc-warning": warning,
    "--oc-error": error,
    "--oc-info": info,
    "--oc-accent": accent,

    // canonical product tokens
    "--color-bg": bg,
    "--color-surface": surface,
    "--color-text": text,
    "--color-text-muted": textMuted,
    "--color-primary": primary,
    "--color-success": success,
    "--color-warning": warning,
    "--color-error": error,
    "--color-border": border,
    "--color-info": info,
    "--color-accent": accent,

    // Stage / PostHog-shell aliases (consume OC tokens)
    "--bg": bg,
    "--bg-light": surface,
    "--stage": stage,
    "--panel": surface,
    "--raise": surface,
    "--raise-2": border,
    "--line": border,
    "--line2": border,
    "--text": text,
    "--dim": textMuted,
    "--faint": textMuted,
    "--muted": textMuted,
    "--acc": primary,
    "--acc-hover": primary,
    "--acc-soft": `color-mix(in srgb, ${primary} 16%, transparent)`,
    "--acc-line": `color-mix(in srgb, ${primary} 42%, transparent)`,
    "--acc-text": primary,
    "--pass": success,
    "--pass-soft": `color-mix(in srgb, ${success} 14%, transparent)`,
    "--heal": warning,
    "--heal-soft": `color-mix(in srgb, ${warning} 14%, transparent)`,
    "--fail": error,
    "--fail-soft": `color-mix(in srgb, ${error} 14%, transparent)`,

    "--surface": surface,
    "--primary": primary,
    "--success": success,
    "--warning": warning,
    "--error": error,
    "--border": border,
  };
}

export function resolveThemeVariant(variant: ThemeVariant): ResolvedCssVars {
  // seeds-only variants: treat seeds as a minimal palette if present
  const palette =
    variant.palette ??
    ({
      neutral: (variant.seeds as { neutral?: string } | undefined)?.neutral ?? "#111",
      ink: "#eee",
      primary: (variant.seeds as { primary?: string } | undefined)?.primary ?? "#1d4aff",
      success: (variant.seeds as { success?: string } | undefined)?.success ?? "#3d9a57",
      warning: (variant.seeds as { warning?: string } | undefined)?.warning ?? "#d68c27",
      error: (variant.seeds as { error?: string } | undefined)?.error ?? "#d1383d",
    } as ThemePaletteColors);

  const base = resolvePalette(palette);

  // Apply OpenCode text/surface style overrides when they map cleanly
  const o = variant.overrides ?? {};
  if (typeof o["text-weak"] === "string") {
    base["--dim"] = o["text-weak"];
    base["--faint"] = o["text-weak"];
    base["--color-text-muted"] = o["text-weak"];
  }
  if (typeof o["text-base"] === "string") {
    base["--dim"] = o["text-base"];
    base["--color-text-muted"] = o["text-base"];
  }
  if (typeof o["text-strong"] === "string") {
    base["--text"] = o["text-strong"];
    base["--color-text"] = o["text-strong"];
  }
  if (typeof o["surface-base"] === "string") {
    base["--panel"] = o["surface-base"];
    base["--color-surface"] = o["surface-base"];
    base["--bg-light"] = o["surface-base"];
  }
  if (typeof o["border-weak-base"] === "string") {
    base["--line"] = o["border-weak-base"];
    base["--border"] = o["border-weak-base"];
    base["--color-border"] = o["border-weak-base"];
  }

  return base;
}

export function themeToCss(vars: ResolvedCssVars): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}:${value};`)
    .join("");
}

export function themeToRootCss(theme: DesktopTheme, mode: "light" | "dark"): string {
  const variant = mode === "dark" ? theme.dark : theme.light;
  return `:root{color-scheme:${mode};${themeToCss(resolveThemeVariant(variant))}}`;
}

export function resolveTheme(theme: DesktopTheme, mode: "light" | "dark"): ResolvedCssVars {
  return resolveThemeVariant(mode === "dark" ? theme.dark : theme.light);
}

/** Background color for Electron native chrome / FOUC. */
export function themeBackground(theme: DesktopTheme, mode: "light" | "dark"): string {
  const p = (mode === "dark" ? theme.dark : theme.light).palette;
  if (p?.neutral) return hex(p.neutral, mode === "dark" ? "#0a0a0a" : "#ffffff");
  return mode === "dark" ? "#0a0a0a" : "#ffffff";
}
