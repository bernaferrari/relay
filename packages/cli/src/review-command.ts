/**
 * `relay review`: go through changed and new screenshots in the terminal.
 * Images show inline in terminals that support it (iTerm2, WezTerm, Kitty,
 * Ghostty); elsewhere Relay saves the image and `o` opens it.
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { CaptureReviewAction, CaptureReviewItem, ReviewInboxResult } from "@relay/protocol";
import type { OutputStreams } from "./output.js";

export type ReviewClient = {
  invoke(operationId: string, input: unknown): Promise<unknown>;
  download(path: string): Promise<Response>;
};

type Card = { runId: string; title: string; target?: string; item: CaptureReviewItem };

type Env = Record<string, string | undefined>;

export type InlineImageProtocol = "iterm" | "kitty" | undefined;

export function inlineImageProtocol(env: Env): InlineImageProtocol {
  if (env.RELAY_INLINE_IMAGES === "0") return undefined;
  const program = env.TERM_PROGRAM ?? "";
  if (program === "iTerm.app" || program === "WezTerm" || env.LC_TERMINAL === "iTerm2") {
    return "iterm";
  }
  if (env.KITTY_WINDOW_ID || /kitty/u.test(env.TERM ?? "") || /ghostty/iu.test(program)) {
    return "kitty";
  }
  return undefined;
}

/** Escape sequence that draws a PNG inline, sized to `columns` cells wide. */
export function inlineImage(
  png: Buffer,
  protocol: Exclude<InlineImageProtocol, undefined>,
  columns = 80,
): string {
  const data = png.toString("base64");
  if (protocol === "iterm") {
    return `\u001b]1337;File=inline=1;size=${png.byteLength};width=${columns};preserveAspectRatio=1:${data}\u0007\n`;
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < data.length; offset += 4096) {
    const chunk = data.slice(offset, offset + 4096);
    const more = offset + 4096 < data.length ? 1 : 0;
    chunks.push(
      offset === 0
        ? `\u001b_Gf=100,a=T,c=${columns},m=${more};${chunk}\u001b\\`
        : `\u001b_Gm=${more};${chunk}\u001b\\`,
    );
  }
  return `${chunks.join("")}\n`;
}

export function reviewCards(inbox: ReviewInboxResult): Card[] {
  return inbox.entries.flatMap((entry) =>
    entry.items.map((item) => ({
      runId: entry.runId,
      title: entry.title,
      ...(entry.targetName ? { target: entry.targetName } : {}),
      item,
    })),
  );
}

export function screenshotLabel(item: CaptureReviewItem): string {
  const caption = item.caption.trim();
  if (caption.startsWith("step:")) return caption.split(":").slice(2).join(":") || "Screenshot";
  if (caption.startsWith("app-map:")) return item.lookFor || "Screenshot";
  return caption || item.lookFor || "Screenshot";
}

export function changeLabel(item: CaptureReviewItem): string {
  const reference = item.reference;
  if (reference?.state === "changed") {
    if (reference.sizeChanged) return "Changed size";
    const bounds = reference.changedBounds;
    const where = bounds
      ? ` near the ${bounds.y + bounds.height / 2 < 0.34 ? "top" : bounds.y + bounds.height / 2 > 0.66 ? "bottom" : "middle"}${bounds.x + bounds.width / 2 < 0.34 ? " left" : bounds.x + bounds.width / 2 > 0.66 ? " right" : ""}`
      : "";
    return `Changed ${Math.max(0.1, (reference.changeRatio ?? 0) * 100).toFixed(1)}%${where}`;
  }
  return "New — no reference yet";
}

function readKey(stdin: Readable & { setRawMode?(raw: boolean): void }): Promise<string> {
  return new Promise((resolve) => {
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.once("data", (chunk) => {
      stdin.setRawMode?.(false);
      stdin.pause();
      resolve(String(chunk));
    });
  });
}

function readLine(stdin: Readable, prompt: string, streams: OutputStreams): Promise<string> {
  streams.stderr.write(prompt);
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (chunk: Buffer | string) => {
      buffer += String(chunk);
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      stdin.off("data", onData);
      stdin.pause();
      resolve(buffer.slice(0, newline).replace(/\r$/u, ""));
    };
    stdin.on("data", onData);
    stdin.resume();
  });
}

function openFile(path: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", path] : [path];
  spawn(command, args, { stdio: "ignore", detached: true }).unref();
}

async function image(client: ReviewClient, card: Card, kind: "diff" | "capture"): Promise<Buffer> {
  const run = `/runs/${encodeURIComponent(card.runId)}`;
  const path =
    kind === "diff"
      ? `${run}/capture-reference/diff?captureId=${encodeURIComponent(card.item.captureId)}`
      : `${run}/frames/${encodeURIComponent((card.item.framePath ?? "").split("/").pop() ?? "")}`;
  const response = await client.download(path);
  if (!response.ok) throw new Error(`Screenshot unavailable (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export async function runInteractiveReview(input: {
  client: ReviewClient;
  streams: OutputStreams;
  stdin: Readable & { isTTY?: boolean; setRawMode?(raw: boolean): void };
  env: Env;
  appMapId?: string;
}): Promise<number> {
  const { client, streams, stdin, env } = input;
  const out = (text: string) => streams.stderr.write(text);
  const inbox = (await client.invoke(
    "review.inbox.list",
    input.appMapId ? { appMapId: input.appMapId } : {},
  )) as ReviewInboxResult;
  const cards = reviewCards(inbox).sort(
    (left, right) =>
      Number(right.item.reference?.state === "changed") -
      Number(left.item.reference?.state === "changed"),
  );
  if (!cards.length) {
    out(
      `Nothing to review.${inbox.totals.unchanged ? ` ${inbox.totals.unchanged} screenshots matched their references.` : ""}\n`,
    );
    return 0;
  }
  if (!stdin.isTTY) {
    for (const card of cards) {
      streams.stdout.write(
        `${card.title} › ${screenshotLabel(card.item)}${card.target ? ` · ${card.target}` : ""} · ${changeLabel(card.item)}\n`,
      );
    }
    out(`${cards.length} to review. Run \`relay review\` in a terminal to decide them.\n`);
    return 10;
  }
  const protocol = inlineImageProtocol(env);
  const directory = await mkdtemp(join(tmpdir(), "relay-review-"));
  const tally = { accepted: 0, issues: 0, skipped: 0 };
  for (const [index, card] of cards.entries()) {
    const kind = card.item.reference?.state === "changed" ? "diff" : "capture";
    out(
      `\n\u001b[1m[${index + 1}/${cards.length}] ${card.title} › ${screenshotLabel(card.item)}\u001b[22m${card.target ? ` · ${card.target}` : ""}\n`,
    );
    out(
      `${changeLabel(card.item)}${card.item.lookFor ? ` · look for: ${card.item.lookFor}` : ""}\n`,
    );
    let file: string | undefined;
    try {
      const png = await image(client, card, kind);
      file = join(directory, `${index + 1}-${kind}.png`);
      await writeFile(file, png);
      if (protocol)
        out(
          inlineImage(
            png,
            protocol,
            Math.min(100, (streams.stderr as { columns?: number }).columns ?? 80),
          ),
        );
      else out(`Saved ${kind === "diff" ? "highlighted changes" : "screenshot"}: ${file}\n`);
    } catch (error) {
      out(`${error instanceof Error ? error.message : String(error)}\n`);
    }
    let decided = false;
    while (!decided) {
      out("[a] looks correct  [r] report issue  [o] open image  [s] skip  [q] quit › ");
      const key = (await readKey(stdin)).toLowerCase();
      out("\n");
      if (key === "q" || key === "\u0003") {
        out(summary(tally, cards.length - index));
        return tally.issues ? 1 : 0;
      }
      if (key === "o" && file) {
        openFile(file);
        continue;
      }
      if (key === "s") {
        tally.skipped += 1;
        decided = true;
        continue;
      }
      if (key === "a" || key === "r") {
        const action: CaptureReviewAction = key === "a" ? "accept" : "report-issue";
        const note = key === "r" ? await readLine(stdin, "What’s wrong? ", streams) : undefined;
        try {
          await client.invoke("run.capture.review", {
            runId: card.runId,
            captureId: card.item.captureId,
            action,
            ...(card.item.imageSha256 ? { imageSha256: card.item.imageSha256 } : {}),
            ...(note?.trim() ? { note: note.trim() } : {}),
            ...(card.item.reviewVersion !== undefined
              ? { expectedReviewVersion: card.item.reviewVersion }
              : {}),
          });
          if (action === "accept") tally.accepted += 1;
          else tally.issues += 1;
          out(
            action === "accept" ? "✓ Saved — this is now the reference.\n" : "✗ Issue reported.\n",
          );
          decided = true;
        } catch (error) {
          out(`Not saved: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
    }
  }
  out(summary(tally, 0));
  return tally.issues ? 1 : 0;
}

function summary(
  tally: { accepted: number; issues: number; skipped: number },
  left: number,
): string {
  return `\n${[
    `${tally.accepted} looked correct`,
    tally.issues ? `${tally.issues} issues reported` : undefined,
    tally.skipped ? `${tally.skipped} skipped` : undefined,
    left ? `${left} left` : undefined,
  ]
    .filter(Boolean)
    .join(" · ")}\n`;
}

/** `relay review [--app <id>]` opens the interactive review; `review list` stays an operation. */
export function isInteractiveReview(argv: readonly string[]): boolean {
  const first = argv.find((token) => !token.startsWith("-"));
  return first === "review" && !argv.includes("list") && !argv.includes("--help");
}

export async function runReviewCommand(
  argv: readonly string[],
  input: {
    streams: OutputStreams;
    env: Env;
    stdin: Readable & { isTTY?: boolean; setRawMode?(raw: boolean): void };
    /** Build a client from equivalent `review list` arguments (connection flags). */
    client(args: readonly string[]): ReviewClient;
  },
): Promise<number> {
  const appIndex = argv.indexOf("--app");
  const appMapId = appIndex >= 0 ? argv[appIndex + 1] : undefined;
  const rest = argv.filter(
    (token, index) =>
      token !== "review" && index !== appIndex && (appIndex < 0 || index !== appIndex + 1),
  );
  return runInteractiveReview({
    client: input.client(["review", "list", ...rest]),
    streams: input.streams,
    stdin: input.stdin,
    env: input.env,
    ...(appMapId ? { appMapId } : {}),
  });
}
