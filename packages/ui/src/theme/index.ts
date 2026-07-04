export type {
  ColorScheme,
  ColorValue,
  DesktopTheme,
  HexColor,
  ResolvedCssVars,
  Theme,
  ThemePaletteColors,
  ThemeVariant,
} from "./types";

export {
  resolvePalette,
  resolveTheme,
  resolveThemeVariant,
  themeBackground,
  themeToCss,
  themeToRootCss,
} from "./resolve";

export { ThemeProvider, useTheme, type ThemeAppliedDetail } from "./context";
