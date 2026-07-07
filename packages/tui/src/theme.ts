const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  inverse: "\x1b[7m",
  underline: "\x1b[4m",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clearLine: "\x1b[2K",
  cursorUp: (n: number) => `\x1b[${n}A`,
  cursorToCol: (n: number) => `\x1b[${n}G`,
  fg: {
    primary: "\x1b[38;2;139;124;255m",
    text: "\x1b[38;2;244;244;247m",
    muted: "\x1b[38;2;154;154;173m",
    success: "\x1b[38;2;61;214;140m",
    error: "\x1b[38;2;255;107;107m",
    warning: "\x1b[38;2;240;180;41m",
  },
  bg: {
    selected: "\x1b[48;2;48;42;88m",
  },
};

function paint(code: string, s: string) {
  return `${code}${s}${c.reset}`;
}

export const ansi = {
  hideCursor: c.hideCursor,
  showCursor: c.showCursor,
  clearLine: c.clearLine,
  cursorUp: c.cursorUp,
  cursorToCol: c.cursorToCol,
  reset: c.reset,
};

export const theme = {
  primary: (s: string) => paint(c.fg.primary, s),
  text: (s: string) => paint(c.fg.text, s),
  muted: (s: string) => paint(c.fg.muted, s),
  success: (s: string) => paint(c.fg.success, s),
  error: (s: string) => paint(c.fg.error, s),
  warning: (s: string) => paint(c.fg.warning, s),
  bold: (s: string) => `${c.bold}${s}${c.reset}`,
  underline: (s: string) => `${c.underline}${s}${c.reset}`,
  selected: (s: string) => `${c.bg.selected}${c.fg.text}${c.bold}${s}${c.reset}`,
  pointer: (s: string) => paint(c.fg.primary, s),
};

export function banner(mode: string): string {
  const line = theme.muted("─".repeat(52));
  return [
    "",
    theme.primary(theme.bold("  Grok Device")),
    theme.muted("  App testing shell · agent-device"),
    theme.muted(`  ${mode}`),
    line,
  ].join("\n");
}

export function colorStatus(status: string): string {
  switch (status) {
    case "ok":
      return theme.success(status);
    case "healed":
      return theme.warning(status);
    case "error":
    case "cancelled":
      return theme.error(status);
    case "running":
      return theme.primary(status);
    case "paused":
      return theme.warning(status);
    case "queued":
      return theme.warning(status);
    default:
      return theme.muted(status);
  }
}

export function hint(keys: Array<[string, string]>): string {
  return keys
    .map(([k, label]) => `${theme.primary(k)} ${theme.muted(label)}`)
    .join(theme.muted("  ·  "));
}
