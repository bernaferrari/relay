import type { Page } from "playwright-core";
import type { BrowserPageTool, BrowserPageToolResult } from "@relay/protocol";
const tools = new WeakMap<
  Page,
  { zoom: number; query: string; index: number; history: { url: string; title: string }[] }
>();

function stateFor(page: Page) {
  let state = tools.get(page);
  if (state) return state;
  state = { zoom: 1, query: "", index: -1, history: [] };
  tools.set(page, state);
  const current = state;
  const observe = async () => {
    if (page.isClosed()) return;
    const url = page.url();
    if (/^https?:\/\//u.test(url) && current.history.at(-1)?.url !== url) {
      current.history.push({
        url: url.slice(0, 4096),
        title: (await page.title().catch(() => url)).slice(0, 512),
      });
      current.history = current.history.slice(-100);
    }
    if (current.zoom !== 1)
      await page.evaluate((factor) => {
        document.documentElement.style.zoom = String(factor);
      }, current.zoom);
  };
  page.on("domcontentloaded", () => {
    void observe().catch(() => undefined);
  });
  void observe().catch(() => undefined);
  return state;
}
export function observeBrowserPageTools(page: Page): void {
  stateFor(page);
}

/** Immediate manual browser commands; the caller owns input admission and fresh-frame checks. */
export async function applyBrowserPageTool(
  page: Page,
  command: BrowserPageTool,
): Promise<BrowserPageToolResult> {
  const state = stateFor(page);
  if (command.kind === "browser.zoom") {
    if (command.factor !== undefined) {
      await page.evaluate((factor) => {
        document.documentElement.style.zoom = String(factor);
      }, command.factor);
      state.zoom = command.factor;
    }
    return { zoom: state.zoom };
  }
  if (command.kind === "browser.history") {
    let history = state.history;
    // Chromium gives us its actual back/forward entries, including in-page navigations.
    let connection;
    try {
      connection = await page.context().newCDPSession(page);
      const result = await connection.send("Page.getNavigationHistory");
      history = result.entries
        .filter((entry) => /^https?:\/\//u.test(entry.url))
        .slice(-100)
        .map((entry) => ({ url: entry.url.slice(0, 4096), title: entry.title.slice(0, 512) }));
    } catch {
      /* Other engines retain the navigation events observed by this live session. */
    } finally {
      await connection?.detach().catch(() => undefined);
    }
    return { history: [...history].reverse(), zoom: state.zoom };
  }
  const query = command.query;
  const index =
    state.query === query && command.direction !== "first"
      ? state.index + (command.direction === "previous" ? -1 : 1)
      : 0;
  const found = await page.evaluate(
    ({ query, index }) => {
      const selection = window.getSelection();
      if (!query) {
        selection?.removeAllRanges();
        return { current: 0, total: 0, truncated: false };
      }
      const walker = document.createTreeWalker(
        document.body ?? document.documentElement,
        NodeFilter.SHOW_TEXT,
      );
      const matches: Range[] = [];
      let visited = 0,
        truncated = false;
      while (walker.nextNode()) {
        if (++visited > 20000 || matches.length >= 1000) {
          truncated = true;
          break;
        }
        const node = walker.currentNode,
          parent = node.parentElement;
        if (
          !parent ||
          parent.closest("script,style,noscript,input,textarea,select,[aria-hidden=true]") ||
          !parent.getClientRects().length ||
          getComputedStyle(parent).visibility === "hidden"
        )
          continue;
        const text = node.textContent ?? "";
        // Match against the original text so Unicode case folding cannot shift Range offsets.
        const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu");
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) && matches.length < 1000) {
          const start = match.index;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + match[0].length);
          matches.push(range);
        }
      }
      const current = matches.length
        ? ((index % matches.length) + matches.length) % matches.length
        : -1;
      selection?.removeAllRanges();
      if (current >= 0) {
        const match = matches[current]!;
        selection?.addRange(match);
        const parent = match.startContainer.parentElement;
        parent?.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      }
      return { current: current + 1, total: matches.length, truncated };
    },
    { query, index },
  );
  state.query = query;
  state.index = found.current - 1;
  return { find: { query, ...found }, zoom: state.zoom };
}
