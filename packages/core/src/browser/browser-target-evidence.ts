import { createHash } from "node:crypto";
import type { Page, Request, Response } from "playwright-core";
import type { SnapshotNode } from "../device/device.js";
import { installBrowserConsentOverlayHandler } from "./browser-consent-overlay.js";
import {
  isBrowserExecutionContextDestroyed,
  snapshotBrowserPageNodes,
} from "./browser-snapshot-nodes.js";

export { isBrowserExecutionContextDestroyed } from "./browser-snapshot-nodes.js";

/** A bounded network event retained for Browser Device evidence. */
export type BrowserNetworkEntry = {
  method: string;
  url: string;
  status?: number;
  /** Playwright requestfailed is distinct from an HTTP error response. */
  failed?: boolean;
  failureText?: string;
  at: number;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseBodyEncoding?: "utf8" | "base64";
  responseBodyTruncated?: boolean;
};

/**
 * The evidence collector deliberately depends on a small structural session
 * shape. Keeping it here means Browser Device lifecycle code does not also
 * carry the bounded console/network/snapshot implementation.
 */
export type BrowserEvidenceSession = {
  console: Array<{ level: string; text: string; at: number }>;
  network: BrowserNetworkEntry[];
  networkByRequest: WeakMap<Request, BrowserNetworkEntry>;
  networkInclude: "summary" | "headers" | "body" | "all";
  networkPending: Set<Promise<void>>;
  crashes: Array<{ at: number; source: string; message: string }>;
  pageErrors: Array<{ at: number; source: string; message: string }>;
  pageErrorsDropped: number;
  crashCapture: boolean;
  consoleDropped: number;
  networkDropped: number;
};

const MAX_EVIDENCE_ENTRIES = 1_000;
const MAX_NETWORK_BODY_BYTES = 256 * 1024;

/** An immediate after-click frame can straddle document replacement and stall
 * Chromium's capture. Bound that read, then reacquire the current owned page
 * once. This never re-dispatches the action or manufactures missing evidence. */
export async function captureBrowserViewportScreenshot(
  currentPage: () => Promise<Page>,
  path?: string,
): Promise<Buffer> {
  const options = { ...(path ? { path } : {}), fullPage: false, timeout: 3_000 };
  try {
    return await (await currentPage()).screenshot(options);
  } catch (error) {
    if (
      (error instanceof Error && error.name === "AbortError") ||
      (!isBrowserExecutionContextDestroyed(error) &&
        !(
          error instanceof Error &&
          error.name === "TimeoutError" &&
          error.message.includes("page.screenshot")
        ))
    )
      throw error;
    const page = await currentPage();
    await page.waitForLoadState("domcontentloaded", { timeout: 3_000 });
    return await page.screenshot(options);
  }
}

export function attachBrowserEvidence(session: BrowserEvidenceSession, page: Page): void {
  void installBrowserConsentOverlayHandler(page);
  page.on("console", (message) => {
    if (session.console.length >= MAX_EVIDENCE_ENTRIES) {
      session.console.shift();
      session.consoleDropped += 1;
    }
    session.console.push({ level: message.type(), text: message.text(), at: Date.now() });
  });
  page.on("pageerror", (error) => {
    if (session.pageErrors.length >= MAX_EVIDENCE_ENTRIES) {
      session.pageErrors.shift();
      session.pageErrorsDropped += 1;
    }
    session.pageErrors.push({
      at: Date.now(),
      source: "browser-pageerror",
      message: error.message,
    });
    if (session.crashCapture) {
      if (session.crashes.length >= MAX_EVIDENCE_ENTRIES) session.crashes.shift();
      session.crashes.push({ at: Date.now(), source: "browser-pageerror", message: error.message });
    }
  });
  page.on("request", (request) => {
    if (session.network.length >= MAX_EVIDENCE_ENTRIES) {
      session.network.shift();
      session.networkDropped += 1;
    }
    const includeHeaders = session.networkInclude === "headers" || session.networkInclude === "all";
    const includeBody = session.networkInclude === "body" || session.networkInclude === "all";
    const entry: BrowserNetworkEntry = {
      method: request.method(),
      url: request.url(),
      at: Date.now(),
      ...(includeHeaders ? { requestHeaders: request.headers() } : {}),
      ...(includeBody && request.postData() ? { requestBody: request.postData()! } : {}),
    };
    session.network.push(entry);
    session.networkByRequest.set(request, entry);
  });
  page.on("response", (response) => {
    const entry = session.networkByRequest.get(response.request());
    if (!entry) return;
    entry.status = response.status();
    if (session.networkInclude === "headers" || session.networkInclude === "all") {
      entry.responseHeaders = response.headers();
    }
    if (session.networkInclude === "body" || session.networkInclude === "all") {
      const pending = captureResponseBody(response, entry);
      session.networkPending.add(pending);
      void pending.finally(() => session.networkPending.delete(pending));
    }
  });
  page.on("requestfailed", (request) => {
    const entry = session.networkByRequest.get(request);
    if (!entry) return;
    entry.failed = true;
    const failureText = request.failure()?.errorText?.trim();
    if (failureText) entry.failureText = failureText.slice(0, 512);
  });
}

async function captureResponseBody(response: Response, entry: BrowserNetworkEntry): Promise<void> {
  try {
    const body = await response.body();
    const truncated = body.byteLength > MAX_NETWORK_BODY_BYTES;
    const bounded = body.subarray(0, MAX_NETWORK_BODY_BYTES);
    const contentType = response.headers()["content-type"] ?? "";
    const textual = /(?:json|text|javascript|xml|html|css|form-urlencoded)/i.test(contentType);
    entry.responseBody = textual ? bounded.toString("utf8") : bounded.toString("base64");
    entry.responseBodyEncoding = textual ? "utf8" : "base64";
    if (truncated) entry.responseBodyTruncated = true;
  } catch {
    // Redirects, cached responses, and streaming bodies may not be readable.
  }
}

/** Bounded semantic snapshot of the page. The cross-document collector in
 * browser-snapshot-nodes owns frame traversal, viewport prioritization, and
 * occlusion filtering; this export keeps the evidence module its single
 * public entry point. */
export async function snapshotBrowserPage(page: Page, maxNodes = 256): Promise<SnapshotNode[]> {
  return snapshotBrowserPageNodes(page, maxNodes);
}

/** Fingerprint the same bounded JPEG surface that the Browser Device paints. */
export async function browserPageVisualFingerprint(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: "jpeg", quality: 76, animations: "disabled" });
  return createHash("sha256").update(buffer).digest("base64url");
}
