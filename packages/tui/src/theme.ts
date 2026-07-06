const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  fg: {
    primary: "\x1b[38;2;139;124;255m",
    text: "\x1b[38;2;244;244;247m",
    muted: "\x1b[38;2;154;154;173m",
    success: "\x1b[38;2;61;214;140m",
    error: "\x1b[38;2;255;107;107m",
    warning: "\x1b[38;2;240;180;41m",
  },
};

function paint(code: string, s: string) {
  return `${code}${s}${c.reset}`;
}

export const theme = {
  primary: (s: string) => paint(c.fg.primary, s),
  text: (s: string) => paint(c.fg.text, s),
  muted: (s: string) => paint(c.fg.muted, s),
  success: (s: string) => paint(c.fg.success, s),
  error: (s: string) => paint(c.fg.error, s),
  warning: (s: string) => paint(c.fg.warning, s),
  bold: (s: string) => `${c.bold}${s}${c.reset}`,
};

export function banner(mode: string): string {
  const line = theme.muted("─".repeat(48));
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
