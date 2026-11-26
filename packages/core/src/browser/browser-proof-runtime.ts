import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BrowserCaseProfile } from "@relay/protocol";
import {
  activePage,
  browserProofSessionForTarget,
  type BrowserNetworkEntry,
} from "./browser-target.js";

/** Server-only projection of one Playwright proof session. It exposes bounded
 * observations and file-producing operations, never a Page handle, so a
 * persisted Run can close over browser evidence without widening the
 * renderer or recipe Device contract. */
export type BrowserProofRuntime = Readonly<{
  profile: BrowserCaseProfile;
  version: string;
  screenshot: (path: string) => Promise<void>;
  ariaSnapshot: () => Promise<string>;
  pages: () => Promise<{
    pages: ReadonlyArray<{
      id: string;
      kind: "page" | "popup";
      title: string;
      url: string;
      active: boolean;
      closed: boolean;
    }>;
    dropped: number;
  }>;
  console: ReadonlyArray<{ level: string; text: string; at: number }>;
  consoleDropped: number;
  pageErrors: ReadonlyArray<{ at: number; source: string; message: string }>;
  pageErrorsDropped: number;
  network: ReadonlyArray<BrowserNetworkEntry>;
  networkDropped: number;
  stopTrace: (path: string) => Promise<void>;
}>;

/** Project the active server-owned proof session after asynchronous network
 * response-body work has settled. No browser handle crosses this seam. */
export async function browserProofRuntimeForTarget(targetId: string): Promise<BrowserProofRuntime> {
  const session = await browserProofSessionForTarget(targetId);
  const browser = session.context.browser();
  const version = browser?.version().trim();
  if (!version) throw new Error("Playwright browser version is unavailable for proof evidence");
  // Response-body capture is intentionally asynchronous. Drain every batch
  // before projecting network evidence so a completed Run cannot claim a
  // captured summary while body/error fields are still being populated.
  while (session.networkPending.size > 0) {
    await Promise.allSettled(session.networkPending);
  }
  return {
    profile: structuredClone(session.profile),
    version,
    screenshot: async (path) => {
      await mkdir(dirname(path), { recursive: true });
      await (await activePage(session)).screenshot({ path, fullPage: false });
    },
    ariaSnapshot: async () => (await activePage(session)).locator("body").ariaSnapshot(),
    pages: async () => {
      const allPages = session.context.pages();
      const pages = allPages.slice(0, 128);
      return {
        pages: await Promise.all(
          pages.map(async (page, index) => ({
            id: `page-${index + 1}`,
            kind: page === session.page ? ("page" as const) : ("popup" as const),
            title: await page.title().catch(() => ""),
            url: page.url(),
            active: page === session.page,
            closed: page.isClosed(),
          })),
        ),
        // A hostile page can open unbounded popups. Preserve a bounded
        // topology and make the loss visible to the proof collector instead
        // of allowing schema parsing to fail after collecting every channel.
        dropped: Math.max(0, allPages.length - pages.length),
      };
    },
    console: [...session.console],
    consoleDropped: session.consoleDropped,
    pageErrors: [...session.pageErrors],
    pageErrorsDropped: session.pageErrorsDropped,
    network: [...session.network],
    networkDropped: session.networkDropped,
    stopTrace: async (path) => {
      if (!session.traceStarted)
        throw new Error("Playwright tracing was not started for this proof");
      session.traceStarted = false;
      await mkdir(dirname(path), { recursive: true });
      await session.context.tracing.stop({ path });
    },
  };
}
