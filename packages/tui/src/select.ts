/**
 * Interactive keyboard UI: arrows/j/k + Enter (no "Select [1-N]" prompts).
 */
import { stdin as input, stdout as output } from "node:process";
import { ansi, theme, hint } from "./theme.js";

export type SelectItem = {
  label: string;
  description?: string;
  disabled?: boolean;
  value?: string;
};

export type SelectOptions = {
  title: string;
  items: SelectItem[];
  /** Initial cursor index (default 0, or first enabled). */
  initial?: number;
  /** Allow Esc/q to cancel and return null (default true). */
  cancelable?: boolean;
  /** Footer hint override. */
  footer?: string;
};

function ensureTty(): void {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Interactive TUI requires a TTY (run in a real terminal).");
  }
}

function firstEnabled(items: SelectItem[], from = 0): number {
  for (let i = from; i < items.length; i++) if (!items[i]!.disabled) return i;
  for (let i = 0; i < from; i++) if (!items[i]!.disabled) return i;
  return Math.max(0, Math.min(from, items.length - 1));
}

function move(items: SelectItem[], cursor: number, delta: number): number {
  if (items.length === 0) return 0;
  let next = cursor;
  for (let step = 0; step < items.length; step++) {
    next = (next + delta + items.length) % items.length;
    if (!items[next]!.disabled) return next;
  }
  return cursor;
}

function write(s: string): void {
  output.write(s);
}

function clearRendered(lineCount: number): void {
  if (lineCount <= 0) return;
  // Move to start of block and clear each line
  write(ansi.cursorUp(lineCount - 1));
  for (let i = 0; i < lineCount; i++) {
    write(ansi.clearLine);
    write(ansi.cursorToCol(1));
    if (i < lineCount - 1) write("\n");
  }
  write(ansi.cursorUp(lineCount - 1));
  write(ansi.cursorToCol(1));
}

function readKey(): Promise<string> {
  return new Promise((resolve) => {
    const onData = (buf: Buffer) => {
      input.off("data", onData);
      resolve(buf.toString("utf8"));
    };
    input.on("data", onData);
  });
}

async function withRawMode<T>(fn: () => Promise<T>): Promise<T> {
  ensureTty();
  const wasRaw = input.isRaw;
  write(ansi.hideCursor);
  if (!wasRaw) input.setRawMode(true);
  input.resume();
  try {
    return await fn();
  } finally {
    if (!wasRaw) input.setRawMode(false);
    write(ansi.showCursor);
  }
}

function renderList(opts: {
  title: string;
  items: SelectItem[];
  cursor: number;
  footer: string;
}): number {
  const lines: string[] = [];
  lines.push("");
  lines.push(theme.bold(theme.text(`  ${opts.title}`)));
  lines.push("");

  for (let i = 0; i < opts.items.length; i++) {
    const item = opts.items[i]!;
    const active = i === opts.cursor;
    const pointer = active ? theme.pointer("›") : theme.muted(" ");
    const label = item.disabled
      ? theme.muted(item.label)
      : active
        ? theme.selected(` ${item.label} `)
        : theme.text(` ${item.label} `);
    const desc = item.description
      ? active
        ? theme.muted(`  ${item.description}`)
        : theme.muted(`  ${item.description}`)
      : "";
    lines.push(`  ${pointer} ${label}${desc}`);
  }

  lines.push("");
  lines.push(`  ${opts.footer}`);
  lines.push("");

  write(lines.join("\n"));
  return lines.length;
}

/**
 * Arrow/j/k navigate, Enter selects, Esc/q cancels (null).
 * Returns selected index, or null if cancelled.
 */
export async function selectIndex(options: SelectOptions): Promise<number | null> {
  const { title, items } = options;
  if (items.length === 0) throw new Error(`Nothing to select: ${title}`);

  const cancelable = options.cancelable !== false;
  const enabled = items.filter((i) => !i.disabled);
  if (enabled.length === 0) throw new Error(`All options disabled: ${title}`);

  // Non-TTY fallback: auto-pick single, else error with guidance
  if (!input.isTTY || !output.isTTY) {
    if (enabled.length === 1) return items.indexOf(enabled[0]!);
    throw new Error(`Need TTY to pick among ${items.length} options for: ${title}`);
  }

  const footer =
    options.footer ??
    hint([
      ["↑↓/jk", "move"],
      ["enter", "select"],
      ...(cancelable ? ([["esc", "back"]] as Array<[string, string]>) : []),
    ]);

  return withRawMode(async () => {
    let cursor = firstEnabled(items, options.initial ?? 0);
    let lineCount = 0;

    const paint = () => {
      if (lineCount > 0) clearRendered(lineCount);
      lineCount = renderList({ title, items, cursor, footer });
    };

    paint();

    for (;;) {
      const key = await readKey();

      // Ctrl+C
      if (key === "\u0003") {
        write("\n");
        throw new Error("Interrupted");
      }

      // Enter / return
      if (key === "\r" || key === "\n") {
        if (items[cursor]?.disabled) continue;
        // leave list on screen, move past it
        write("\n");
        return cursor;
      }

      // Esc (bare or as start of sequence — bare esc often arrives alone)
      if (key === "\x1b" || key === "q" || key === "Q") {
        if (!cancelable) continue;
        if (lineCount > 0) clearRendered(lineCount);
        write(theme.muted("  (cancelled)\n"));
        return null;
      }

      // Arrow up / k
      if (key === "\x1b[A" || key === "k" || key === "K") {
        cursor = move(items, cursor, -1);
        paint();
        continue;
      }

      // Arrow down / j
      if (key === "\x1b[B" || key === "j" || key === "J") {
        cursor = move(items, cursor, 1);
        paint();
        continue;
      }

      // Home
      if (key === "\x1b[H" || key === "\x1b[1~") {
        cursor = firstEnabled(items, 0);
        paint();
        continue;
      }

      // End
      if (key === "\x1b[F" || key === "\x1b[4~") {
        cursor = firstEnabled(items, items.length - 1);
        // walk to last enabled
        for (let i = items.length - 1; i >= 0; i--) {
          if (!items[i]!.disabled) {
            cursor = i;
            break;
          }
        }
        paint();
        continue;
      }
    }
  });
}

export async function selectItem<T extends SelectItem>(
  options: Omit<SelectOptions, "items"> & { items: T[] },
): Promise<T | null> {
  const i = await selectIndex(options);
  if (i === null) return null;
  return options.items[i] ?? null;
}

/** Yes/No with Enter on highlighted choice (default No or Yes). */
export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const items: SelectItem[] = [
    { label: "Yes", value: "yes" },
    { label: "No", value: "no" },
  ];
  const i = await selectIndex({
    title: question,
    items,
    initial: defaultYes ? 0 : 1,
    cancelable: true,
    footer: hint([
      ["↑↓", "move"],
      ["enter", "confirm"],
      ["esc", "no"],
    ]),
  });
  if (i === null) return false;
  return i === 0;
}

/** Single-line text prompt in raw mode. Esc / Ctrl+C → null. */
export async function promptText(
  question: string,
  opts: { defaultValue?: string; allowEmpty?: boolean } = {},
): Promise<string | null> {
  ensureTty();
  const def = opts.defaultValue?.trim();

  for (;;) {
    const suffix = def ? theme.muted(` [${def}]`) : "";
    write(`\n  ${theme.text(question)}${suffix}\n  ${theme.primary("›")} `);

    const value = await withRawMode(async () => {
      write(ansi.showCursor);
      let buf = "";
      for (;;) {
        const key = await readKey();
        if (key === "\u0003") {
          write("\n");
          return null;
        }
        // bare esc only (not arrow sequences)
        if (key === "\x1b") {
          write(theme.muted(" (cancelled)\n"));
          return null;
        }
        if (key === "\r" || key === "\n") {
          write("\n");
          return buf.trim() || def || "";
        }
        if (key === "\u007f" || key === "\b") {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            write("\b \b");
          }
          continue;
        }
        // ignore other control / multi-byte sequences
        if (key.startsWith("\x1b")) continue;
        if (key.length === 1 && key >= " ") {
          buf += key;
          write(key);
        }
      }
    });

    if (value === null) return null;
    if (!value && !opts.allowEmpty) {
      write(theme.error("  Value required.\n"));
      continue;
    }
    return value;
  }
}

/** Brief status line helper. */
export function statusLine(parts: string[]): void {
  write(`\n  ${parts.join(theme.muted("  ·  "))}\n`);
}
