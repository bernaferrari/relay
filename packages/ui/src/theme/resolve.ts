import type { ResolvedCssVars, Theme, ThemeVariant } from "./types";

/** Map a theme variant palette to CSS custom properties. */
export function resolveThemeVariant(variant: ThemeVariant): ResolvedCssVars {
  const p = variant.palette;
  return {
    "--color-bg": p.bg,
    "--color-surface": p.surface,
    "--color-text": p.text,
    "--color-text-muted": p.textMuted,
    "--color-primary": p.primary,
    "--color-success": p.success,
    "--color-warning": p.warning,
    "--color-error": p.error,
    "--color-border": p.border,
    "--bg": p.bg,
    "--surface": p.surface,
    "--text": p.text,
    "--text-muted": p.textMuted,
    "--primary": p.primary,
    "--success": p.success,
    "--warning": p.warning,
    "--error": p.error,
    "--border": p.border,
  };
}

/** Serialize resolved tokens into a CSS declarations string (no selector). */
export function themeToCss(vars: ResolvedCssVars): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}:${value};`)
    .join("");
}

/** Build a full `:root` stylesheet for a theme + mode. */
export function themeToRootCss(theme: Theme, mode: "light" | "dark"): string {
  const variant = mode === "dark" ? theme.dark : theme.light;
  const vars = resolveThemeVariant(variant);
  const css = themeToCss(vars);
  return `:root{color-scheme:${mode};${css}}`;
}

export function resolveTheme(theme: Theme, mode: "light" | "dark"): ResolvedCssVars {
  return resolveThemeVariant(mode === "dark" ? theme.dark : theme.light);
}
