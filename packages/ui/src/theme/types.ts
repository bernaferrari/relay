/**
 * OpenCode desktop theme schema (source of truth).
 * @see https://opencode.ai/desktop-theme.json / packages/ui/src/theme/types.ts
 */

export type HexColor = `#${string}`;

export type CssVarRef = `var(--${string})`;

export type ColorValue = HexColor | CssVarRef | string;

/** OpenCode full-palette variant (most shipped themes). */
export type ThemePaletteColors = {
  neutral: HexColor | string;
  ink: HexColor | string;
  primary: HexColor | string;
  success: HexColor | string;
  warning: HexColor | string;
  error: HexColor | string;
  info?: HexColor | string;
  accent?: HexColor | string;
  interactive?: HexColor | string;
  diffAdd?: HexColor | string;
  diffDelete?: HexColor | string;
};

export type ThemeVariant = {
  palette: ThemePaletteColors;
  overrides?: Record<string, ColorValue>;
  v2Overrides?: Record<string, ColorValue>;
  /** legacy seeds form — optional, rarely used in our copy */
  seeds?: Record<string, string>;
};

/** OpenCode DesktopTheme */
export type DesktopTheme = {
  $schema?: string;
  name: string;
  id: string;
  light: ThemeVariant;
  dark: ThemeVariant;
};

/** Alias used throughout our app */
export type Theme = DesktopTheme;

export type ColorScheme = "light" | "dark" | "system";

export type ResolvedCssVars = Record<string, string>;
