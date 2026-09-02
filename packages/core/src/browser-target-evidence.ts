import { createHash } from "node:crypto";
import type { Page, Request, Response } from "playwright-core";
import type { SnapshotNode } from "./device.js";

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

const INTERACTIVE =
  'button, a[href], input, textarea, select, [role], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
const SEMANTIC_SNAPSHOT = `${INTERACTIVE}, [id], [data-testid], h1, h2, h3, p, label`;
const MAX_EVIDENCE_ENTRIES = 1_000;
const MAX_NETWORK_BODY_BYTES = 256 * 1024;

export function attachBrowserEvidence(session: BrowserEvidenceSession, page: Page): void {
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

export async function snapshotBrowserPage(page: Page, maxNodes = 256): Promise<SnapshotNode[]> {
  return await page.locator(SEMANTIC_SNAPSHOT).evaluateAll(
    (elements, options) => {
      const identifierCounts = new Map<string, number>();
      for (const element of elements) {
        const identifier = element.getAttribute("data-testid") || element.id;
        if (identifier)
          identifierCounts.set(identifier, (identifierCounts.get(identifier) ?? 0) + 1);
      }
      const visible = elements.filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
      });
      return visible.slice(0, options.limit).map((element, index) => {
        const html = element as HTMLElement;
        const input = element as HTMLInputElement;
        const rect = element.getBoundingClientRect();
        const role = element.getAttribute("role") || element.tagName.toLowerCase();
        const identifier = element.getAttribute("data-testid") || element.id || undefined;
        const hittable = element.matches(options.interactive);
        const label =
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          (input.labels?.[0]?.textContent ?? "") ||
          html.innerText?.trim() ||
          input.placeholder ||
          input.name ||
          "";
        return {
          index,
          role,
          type: role,
          label: label.slice(0, 500),
          value: input.type === "password" ? "••••••••" : String(input.value ?? "").slice(0, 500),
          identifier: identifier && identifierCounts.get(identifier) === 1 ? identifier : undefined,
          enabled: !(input.disabled || element.getAttribute("aria-disabled") === "true"),
          selected: element.getAttribute("aria-selected") === "true",
          focused: document.activeElement === element,
          visibleToUser: true,
          hittable,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      });
    },
    { limit: maxNodes, interactive: INTERACTIVE },
  );
}

/** Fingerprint the same bounded JPEG surface that the Browser Device paints. */
export async function browserPageVisualFingerprint(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: "jpeg", quality: 76, animations: "disabled" });
  return createHash("sha256").update(buffer).digest("base64url");
}
