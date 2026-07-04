/**
 * ANSI color map matching @grok-device/ui theme/themes/grok.json (dark palette).
 */
export const palette = {
  bg: "#050507",
  surface: "#121218",
  text: "#f4f4f7",
  textMuted: "#9a9aad",
  primary: "#8b7cff",
  success: "#3dd68c",
  warning: "#f0b429",
  error: "#ff6b6b",
  border: "#2a2a36",
} as const;

function rgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return `${r};${g};${b}`;
}

function fg(hex: string): string {
  return `\x1b[38;2;${rgb(hex)}m`;
}

function bg(hex: string): string {
  return `\x1b[48;2;${rgb(hex)}m`;
}

export const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  underline: "\x1b[4m",
  inverse: "\x1b[7m",

  text: fg(palette.text),
  muted: fg(palette.textMuted),
  primary: fg(palette.primary),
  success: fg(palette.success),
  warning: fg(palette.warning),
  error: fg(palette.error),
  border: fg(palette.border),

  bg: bg(palette.bg),
  surface: bg(palette.surface),
} as const;

/** Theme token names used by UI — parallel ANSI accessors. */
export const theme = {
  ...ansi,
  palette,
  names: {
    bg: "bg",
    surface: "surface",
    text: "text",
    textMuted: "textMuted",
    primary: "primary",
    success: "success",
    warning: "warning",
    error: "error",
    border: "border",
  },
} as const;

export function paint(color: keyof typeof ansi, text: string): string {
  const code = ansi[color];
  if (typeof code !== "string" || color === "reset") return text;
  return `${code}${text}${ansi.reset}`;
}

export function banner(title = "Grok Device"): string {
  const line = "─".repeat(Math.max(24, title.length + 8));
  const head = `${ansi.primary}${ansi.bold}  ${title}${ansi.reset}`;
  const sub = `${ansi.muted}  device actions · terminal UI${ansi.reset}`;
  return [
    `${ansi.border}${line}${ansi.reset}`,
    head,
    sub,
    `${ansi.border}${line}${ansi.reset}`,
  ].join("\n");
}

export function categoryLabel(category: string): string {
  switch (category) {
    case "play-store":
      return paint("primary", "Play Store");
    case "grok":
      return paint("success", "Grok app");
    default:
      return paint("muted", category);
  }
}
