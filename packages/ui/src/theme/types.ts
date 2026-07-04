export type HexColor = `#${string}`;

export type ThemePalette = {
  bg: HexColor;
  surface: HexColor;
  text: HexColor;
  textMuted: HexColor;
  primary: HexColor;
  success: HexColor;
  warning: HexColor;
  error: HexColor;
  border: HexColor;
};

export type ThemeVariant = {
  palette: ThemePalette;
};

export type Theme = {
  id: string;
  name: string;
  light: ThemeVariant;
  dark: ThemeVariant;
};

export type ColorScheme = "light" | "dark" | "system";

export type ResolvedCssVars = Record<string, string>;
