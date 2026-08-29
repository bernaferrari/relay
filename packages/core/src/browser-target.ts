import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrowserContext, Page, Request, Video } from "playwright-core";
import type { BrowserCaseProfile } from "@relay/protocol";
import type { Device, SnapshotNode } from "./device.js";
import { createBrowserContextFactory, type BrowserContextPurpose } from "./browser-context.js";
import { createDeviceObservationFacade } from "./device-observation-membrane.js";
import { browserProfileDir, readTarget } from "./targets.js";

type BrowserSession = {
  context: BrowserContext;
  close: () => Promise<void>;
  page: Page;
  targetId: string;
  purpose: BrowserContextPurpose;
  profile: BrowserCaseProfile;
  headless: boolean;
  recordingUnavailable?: string;
  recordingPath?: string;
  recordingVideo?: Video | null;
  console: Array<{ level: string; text: string; at: number }>;
  network: BrowserNetworkEntry[];
  networkByRequest: WeakMap<Request, BrowserNetworkEntry>;
  networkInclude: "summary" | "headers" | "body" | "all";
  networkPending: Set<Promise<void>>;
  crashes: Array<{ at: number; source: string; message: string }>;
  crashCapture: boolean;
  consoleDropped: number;
  networkDropped: number;
};

type BrowserNetworkEntry = {
  method: string;
  url: string;
  status?: number;
  at: number;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseBodyEncoding?: "utf8" | "base64";
  responseBodyTruncated?: boolean;
};

const sessions = new Map<string, Promise<BrowserSession>>();
const INTERACTIVE =
  'button, a[href], input, textarea, select, [role], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
const MAX_EVIDENCE_ENTRIES = 1_000;
const MAX_NETWORK_BODY_BYTES = 256 * 1024;

async function createSession(
  targetId: string,
  options: {
    headless?: boolean;
    mode: BrowserContextPurpose;
    profile?: BrowserCaseProfile;
  },
): Promise<BrowserSession> {
  const target = await readTarget(targetId);
  if (!target?.browser) throw new Error(`managed browser target not found: ${targetId}`);
  const factory = createBrowserContextFactory(target);
  const profile = options.profile ?? factory.profile;
  const recordingDir = join(
    browserProfileDir(targetId),
    options.mode === "authoring" ? "recordings" : "proof-recordings",
  );
  let recordingUnavailable: string | undefined;
  let contextHandle;
  try {
    contextHandle =
      options.mode === "authoring"
        ? await factory.openAuthoring({
            headless: options.headless,
            recordVideoDir: recordingDir,
          })
        : await factory.openProof(profile, {
            headless: options.headless,
            recordVideoDir: recordingDir,
          });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ffmpeg|video rendering|recordvideo/i.test(message)) throw error;
    recordingUnavailable =
      "Video recording is unavailable on this machine. Screenshots, steps, and logs are still captured.";
    contextHandle =
      options.mode === "authoring"
        ? await factory.openAuthoring({ headless: options.headless })
        : await factory.openProof(profile, { headless: options.headless });
  }
  const context = contextHandle.context;
  const page = context.pages()[0] ?? (await context.newPage());
  const session: BrowserSession = {
    context,
    close: contextHandle.close,
    page,
    targetId,
    purpose: options.mode,
    profile: contextHandle.profile,
    headless: options.headless ?? target.browser.headless ?? false,
    ...(recordingUnavailable ? { recordingUnavailable } : {}),
    console: [],
    network: [],
    networkByRequest: new WeakMap(),
    networkInclude: "summary",
    networkPending: new Set(),
    crashes: [],
    crashCapture: false,
    consoleDropped: 0,
    networkDropped: 0,
  };
  attachEvidence(session, page);
  if (page.url() === "about:blank") {
    await page.goto(target.browser.startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }
  return session;
}

function attachEvidence(session: BrowserSession, page: Page): void {
  page.on("console", (message) => {
    if (session.console.length >= MAX_EVIDENCE_ENTRIES) {
      session.console.shift();
      session.consoleDropped += 1;
    }
    session.console.push({ level: message.type(), text: message.text(), at: Date.now() });
  });
  page.on("pageerror", (error) => {
    if (!session.crashCapture) return;
    if (session.crashes.length >= MAX_EVIDENCE_ENTRIES) session.crashes.shift();
    session.crashes.push({ at: Date.now(), source: "browser-pageerror", message: error.message });
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
}

async function captureResponseBody(
  response: import("playwright-core").Response,
  entry: BrowserNetworkEntry,
): Promise<void> {
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

export async function performBrowserFind(
  locator: { count: () => Promise<number>; click: () => Promise<unknown> },
  query: string,
  action?: string,
): Promise<{ ok: true; exists?: true }> {
  if (action === "exists") {
    if ((await locator.count()) === 0) throw new Error(`No match for ${query}`);
    return { ok: true, exists: true };
  }
  if (action === undefined || action === "press" || action === "click") {
    await locator.click();
    return { ok: true };
  }
  throw new Error(`unsupported browser find action: ${action}`);
}

async function sessionFor(
  targetId: string,
  options: {
    headless?: boolean;
    mode?: BrowserContextPurpose;
    profile?: BrowserCaseProfile;
  } = {},
): Promise<BrowserSession> {
  const mode = options.mode ?? "authoring";
  const key = `${mode}:${targetId}`;
  const existing = sessions.get(key);
  if (existing) {
    const session = await existing;
    // Proof contexts are deliberately one-shot. Even if a caller forgot to
    // close the prior handle, never reuse its cookies/storage for another Run.
    if (
      mode === "authoring" &&
      (options.headless === undefined || session.headless === options.headless)
    )
      return session;
    sessions.delete(key);
    await session.close().catch(() => undefined);
  }
  const pending = createSession(targetId, { ...options, mode }).catch((error) => {
    sessions.delete(key);
    throw error;
  });
  sessions.set(key, pending);
  return pending;
}

export type OpenBrowserTargetResult = {
  targetId: string;
  name: string;
  url: string;
};

/**
 * Opens a visible Relay-owned browser profile so a person can complete login,
 * consent, MFA, or any other setup that should not be encoded into a test.
 * The same isolated profile is reused by later app, CLI, and scheduled runs.
 */
export async function openBrowserTarget(targetId: string): Promise<OpenBrowserTargetResult> {
  const target = await readTarget(targetId);
  if (!target?.browser) throw new Error(`managed browser target not found: ${targetId}`);
  const session = await sessionFor(targetId, { headless: false, mode: "authoring" });
  const page = await activePage(session);
  if (page.url() === "about:blank") {
    await page.goto(target.browser.startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }
  await page.bringToFront();
  return { targetId, name: target.name, url: page.url() };
}

async function activePage(session: BrowserSession): Promise<Page> {
  if (!session.page.isClosed()) return session.page;
  session.page = await session.context.newPage();
  attachEvidence(session, session.page);
  return session.page;
}

async function snapshotPage(page: Page): Promise<SnapshotNode[]> {
  return await page.locator(INTERACTIVE).evaluateAll((elements) =>
    elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
      })
      .map((element, index) => {
        const html = element as HTMLElement;
        const input = element as HTMLInputElement;
        const rect = element.getBoundingClientRect();
        const role = element.getAttribute("role") || element.tagName.toLowerCase();
        const label =
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          (input.labels?.[0]?.textContent ?? "") ||
          html.innerText?.trim() ||
          input.placeholder ||
          input.name ||
          "";
        return {
          ref: `@browser-${index}`,
          index,
          role,
          type: role,
          label: label.slice(0, 500),
          value: input.type === "password" ? "••••••••" : String(input.value ?? "").slice(0, 500),
          identifier: element.id || element.getAttribute("data-testid") || undefined,
          enabled: !(input.disabled || element.getAttribute("aria-disabled") === "true"),
          selected: element.getAttribute("aria-selected") === "true",
          focused: document.activeElement === element,
          visibleToUser: true,
          hittable: true,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }),
  );
}

function indexFromRef(ref?: string): number | undefined {
  const match = ref?.match(/browser-(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function quotedSelector(selector: string): { kind: "exact" | "contains"; value: string } | null {
  const match = selector.match(/label(\*?)="((?:\\.|[^"])*)"/);
  if (!match) return null;
  return {
    kind: match[1] === "*" ? "contains" : "exact",
    value: (match[2] ?? "").replaceAll('\\"', '"'),
  };
}

async function locatorFor(page: Page, input: { ref?: string; selector?: string }) {
  const index = indexFromRef(input.ref);
  if (index !== undefined) return page.locator(INTERACTIVE).nth(index);
  const parsed = input.selector ? quotedSelector(input.selector) : null;
  if (parsed) {
    const exact = parsed.kind === "exact";
    return page
      .getByLabel(parsed.value, { exact })
      .or(page.getByText(parsed.value, { exact }))
      .first();
  }
  throw new Error("browser interaction requires a recorded element or label");
}

function unsupported(capability: string): never {
  throw new Error(`capability unavailable for managed browser: ${capability}`);
}

/**
 * Adapts a managed browser to Relay's existing device contract. This keeps the
 * canonical recipe IR target-neutral while richer TargetAdapter APIs evolve.
 */
export type BrowserDeviceOptions = {
  mode?: BrowserContextPurpose;
  profile?: BrowserCaseProfile;
};

export async function getBrowserDevice(
  targetId: string,
  options: BrowserDeviceOptions = {},
): Promise<Device> {
  const session = await sessionFor(targetId, options);
  const identifiers = { serial: targetId, appPath: "managed-browser" };
  const api = {
    devices: {
      list: async () => [
        {
          id: targetId,
          name: "Managed browser",
          platform: "web",
          target: "desktop",
          kind: "device",
          identifiers,
        },
      ],
      boot: async () => {
        throw new Error("Browser targets open on demand; there is nothing to boot");
      },
    },
    apps: {
      open: async (input: { url?: string; app?: string; relaunch?: boolean }) => {
        const page = await activePage(session);
        if (input.url) await page.goto(input.url, { waitUntil: "domcontentloaded" });
        else if (input.app?.startsWith("http"))
          await page.goto(input.app, { waitUntil: "domcontentloaded" });
        return { appId: input.app ?? input.url ?? targetId };
      },
      close: async () => {
        await (await activePage(session)).close();
        return { session: targetId, identifiers };
      },
    },
    capture: {
      snapshot: async () => ({
        nodes: await snapshotPage(await activePage(session)),
        truncated: false,
        identifiers,
      }),
      screenshot: async (input?: { path?: string }) => {
        const path = input?.path;
        if (path) await mkdir(dirname(path), { recursive: true });
        const buffer = await (await activePage(session)).screenshot({ path, fullPage: false });
        return {
          path: path ?? "",
          base64: path ? undefined : buffer.toString("base64"),
          identifiers,
        };
      },
    },
    interactions: {
      press: async (input: { ref?: string; selector?: string; x?: number; y?: number }) => {
        const page = await activePage(session);
        if (input.x !== undefined && input.y !== undefined)
          await page.mouse.click(input.x, input.y);
        else await (await locatorFor(page, input)).click();
        return { ok: true };
      },
      longPress: async (input: {
        ref?: string;
        selector?: string;
        x?: number;
        y?: number;
        durationMs?: number;
      }) => {
        const page = await activePage(session);
        if (input.x !== undefined && input.y !== undefined) {
          await page.mouse.move(input.x, input.y);
          await page.mouse.down();
          await page.waitForTimeout(input.durationMs ?? 700);
          await page.mouse.up();
        } else {
          const locator = await locatorFor(page, input);
          const box = await locator.boundingBox();
          if (!box) throw new Error("target is not visible");
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(input.durationMs ?? 700);
          await page.mouse.up();
        }
        return { ok: true };
      },
      fill: async (input: {
        text: string;
        ref?: string;
        selector?: string;
        x?: number;
        y?: number;
      }) => {
        const page = await activePage(session);
        if (input.ref || input.selector) {
          await (await locatorFor(page, input)).fill(input.text);
        } else if (input.x !== undefined && input.y !== undefined) {
          await page.mouse.click(input.x, input.y);
          await page.keyboard.press("ControlOrMeta+A");
          await page.keyboard.insertText(input.text);
        } else {
          throw new Error("replace text requires a target");
        }
        return { ok: true };
      },
      type: async (input: { text: string; ref?: string; selector?: string }) => {
        const page = await activePage(session);
        if (input.ref || input.selector) await (await locatorFor(page, input)).fill(input.text);
        else await page.keyboard.insertText(input.text);
        return { ok: true };
      },
      find: async (input: { query: string; action?: string }) => {
        const page = await activePage(session);
        const locator = page.getByText(input.query, { exact: false }).first();
        return await performBrowserFind(locator, input.query, input.action);
      },
      scroll: async (input: { direction?: string; amount?: number }) => {
        const page = await activePage(session);
        const viewportHeight = page.viewportSize()?.height ?? 1_000;
        const distance = viewportHeight * (input.amount ?? 0.5);
        const y = input.direction === "up" ? -distance : distance;
        await page.mouse.wheel(0, y);
        return { ok: true };
      },
      swipe: async (input: { from: { x: number; y: number }; to: { x: number; y: number } }) => {
        const page = await activePage(session);
        await page.mouse.move(input.from.x, input.from.y);
        await page.mouse.down();
        await page.mouse.move(input.to.x, input.to.y, { steps: 12 });
        await page.mouse.up();
        return { ok: true };
      },
      pan: async (input: { x: number; y: number; dx: number; dy: number; durationMs?: number }) => {
        const page = await activePage(session);
        await page.mouse.move(input.x, input.y);
        await page.mouse.down();
        await page.mouse.move(input.x + input.dx, input.y + input.dy, {
          steps: Math.max(12, Math.round((input.durationMs ?? 250) / 20)),
        });
        await page.mouse.up();
        return { ok: true };
      },
    },
    command: {
      wait: async (input: { durationMs?: number; text?: string; selector?: string }) => {
        const page = await activePage(session);
        if (input.text) await page.getByText(input.text, { exact: false }).first().waitFor();
        else if (input.selector) await page.locator(input.selector).first().waitFor();
        else await page.waitForTimeout(input.durationMs ?? 0);
        return { ok: true };
      },
      back: async () => {
        await (await activePage(session)).goBack();
        return { action: "back", mode: "global", message: "Back" };
      },
      home: async () => {
        const target = await readTarget(targetId);
        if (!target?.browser) throw new Error("browser target no longer exists");
        await (await activePage(session)).goto(target.browser.startUrl);
        return { action: "home", message: "Home" };
      },
      clipboard: async (input: {
        action: "read" | "write" | "paste" | "copy";
        text?: string;
        selectorKey?: "id" | "label" | "text" | "value";
        selectorValue?: string;
        expectedText?: string;
      }) => {
        if (input.action === "paste" || input.action === "copy") {
          throw new Error(
            "atomic system clipboard copy/paste currently requires a physical iOS target",
          );
        }
        const page = await activePage(session);
        if (input.action === "write") {
          await page.evaluate((text) => navigator.clipboard.writeText(text), input.text ?? "");
          return { action: "write", textLength: (input.text ?? "").length, message: "Written" };
        }
        return { action: "read", text: await page.evaluate(() => navigator.clipboard.readText()) };
      },
      appState: async () => ({
        platform: "android" as const,
        package: "managed-browser",
        activity: (await activePage(session)).url(),
      }),
      keyboard: async (input?: { action?: "dismiss" | "enter" }) => {
        await (
          await activePage(session)
        ).keyboard.press(input?.action === "enter" ? "Enter" : "Escape");
        return { platform: "android", action: input?.action ?? "dismiss" };
      },
      alert: async () => unsupported("native alerts"),
      appSwitcher: async () => unsupported("app switcher"),
      rotate: async () => unsupported("rotation"),
      prepare: async () => unsupported("native device runner"),
    },
    settings: { update: async () => unsupported("device settings") },
    observability: {
      perf: async () => {
        const page = await activePage(session);
        return await page.evaluate(() => ({
          url: location.href,
          title: document.title,
          navigation: performance.getEntriesByType("navigation")[0]?.toJSON?.() ?? null,
          resources: performance.getEntriesByType("resource").length,
        }));
      },
      logs: async (input?: Parameters<Device["observability"]["logs"]>[0]) => {
        if (input?.action === "start" || input?.action === "clear") {
          session.console = [];
          session.consoleDropped = 0;
        }
        return { entries: [...session.console], dropped: session.consoleDropped };
      },
      network: async (input?: Parameters<Device["observability"]["network"]>[0]) => {
        if (input?.action === "log") {
          session.network = [];
          session.networkDropped = 0;
          session.networkInclude = input.include ?? "summary";
          return { started: true, include: session.networkInclude };
        }
        await Promise.allSettled(session.networkPending);
        return { entries: [...session.network], dropped: session.networkDropped };
      },
      audio: async () => unsupported("browser audio probe"),
      crashes: async (input: Parameters<Device["observability"]["crashes"]>[0]) => {
        if (input.action === "start") {
          session.crashes = [];
          session.crashCapture = true;
        }
        if (input.action === "dump") session.crashCapture = false;
        return {
          platform: "browser" as const,
          since: input.since,
          entries:
            input.action === "start"
              ? []
              : session.crashes.filter((entry) => entry.at >= input.since),
          truncated: false,
        };
      },
    },
    recording: {
      record: async (input: { action: "start" | "stop"; path?: string }) => {
        if (input.action === "start") {
          session.recordingPath = input.path;
          session.console = [];
          session.network = [];
          session.consoleDropped = 0;
          session.networkDropped = 0;
          if (session.recordingUnavailable) {
            return { started: false, warning: session.recordingUnavailable };
          }
          // Persistent cookies survive, but a fresh page creates a strict
          // recording boundary so setup/login activity is excluded.
          const previous = await activePage(session);
          const returnUrl = previous.url();
          await previous.close();
          session.page = await session.context.newPage();
          attachEvidence(session, session.page);
          if (returnUrl && returnUrl !== "about:blank") {
            await session.page.goto(returnUrl, { waitUntil: "domcontentloaded" });
          }
          session.recordingVideo = session.page.video();
          return { started: Boolean(session.recordingVideo) };
        }
        const page = await activePage(session);
        const returnUrl = page.url();
        const output = session.recordingPath?.replace(/\.mp4$/i, ".webm");
        await page.close();
        if (output && session.recordingVideo) {
          await mkdir(dirname(output), { recursive: true });
          await session.recordingVideo.saveAs(output);
        }
        session.page = await session.context.newPage();
        attachEvidence(session, session.page);
        if (returnUrl && returnUrl !== "about:blank") {
          await session.page.goto(returnUrl, { waitUntil: "domcontentloaded" });
        }
        session.recordingVideo = null;
        return { stopped: true, path: output };
      },
    },
  };
  return createDeviceObservationFacade(api);
}

export async function closeBrowserTarget(
  targetId?: string,
  options: { mode?: BrowserContextPurpose } = {},
): Promise<void> {
  const entries = [...sessions.entries()].filter(([key]) => {
    const separator = key.indexOf(":");
    const mode = key.slice(0, separator);
    const id = key.slice(separator + 1);
    return (
      (targetId === undefined || id === targetId) &&
      (options.mode === undefined || mode === options.mode)
    );
  });
  for (const [key, pending] of entries) {
    if (!pending) continue;
    sessions.delete(key);
    const session = await pending.catch(() => null);
    await session?.close().catch(() => undefined);
  }
}
