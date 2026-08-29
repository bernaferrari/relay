import { createHash } from "node:crypto";
import type { Page } from "playwright-core";
import type {
  BrowserCaseProfile,
  BrowserDeviceFrame,
  BrowserDeviceInput,
  BrowserDevicePage,
  BrowserDeviceSession,
} from "@relay/protocol";
import {
  closeBrowserTarget,
  openBrowserAuthoringRuntime,
  type BrowserAuthoringRuntime,
} from "./browser-target.js";

export type BrowserDeviceRuntimeSession = Omit<BrowserDeviceSession, "ownership">;

export class BrowserDeviceConflictError extends Error {
  constructor(
    readonly code: "BROWSER_STALE_INPUT" | "BROWSER_PAGE_STALE" | "BROWSER_SESSION_STALE",
    message: string,
    readonly currentSequence?: number,
  ) {
    super(message);
    this.name = "BrowserDeviceConflictError";
  }
}

type SessionState = {
  runtime: BrowserAuthoringRuntime;
  startedAt: number;
  status: BrowserDeviceRuntimeSession["status"];
  issue?: string;
  sequence: number;
  activePageId: string;
  pageIds: WeakMap<Page, string>;
  pages: Map<string, Page>;
  attached: WeakSet<Page>;
  frame?: BrowserDeviceFrame;
  observedMutationVersion: number;
  needsFreshFrame: boolean;
  capture?: Promise<BrowserDeviceFrame>;
  input: Promise<unknown>;
};

const states = new Map<string, SessionState>();
const FRAME_DEGRADED_MS = 1_000;

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 480);
}

function stateForTarget(targetId: string): SessionState {
  const state = states.get(targetId);
  if (!state)
    throw new BrowserDeviceConflictError("BROWSER_SESSION_STALE", "Browser Device is not open");
  return state;
}

function pageId(state: SessionState, page: Page): string {
  const existing = state.pageIds.get(page);
  if (existing) return existing;
  const id = `page-${crypto.randomUUID()}`;
  state.pageIds.set(page, id);
  state.pages.set(id, page);
  return id;
}

function attachPage(state: SessionState, page: Page): string {
  const id = pageId(state, page);
  if (state.attached.has(page)) return id;
  state.attached.add(page);
  page.on("crash", () => {
    state.status = "crashed";
    state.issue = "The browser page crashed. Reload or reopen the Browser Device.";
    state.needsFreshFrame = true;
  });
  page.on("close", () => {
    state.needsFreshFrame = true;
    if (state.activePageId === id) {
      const replacement = [...state.pages.entries()].find(([, candidate]) => !candidate.isClosed());
      if (replacement) state.activePageId = replacement[0];
      else {
        state.status = "closed";
        state.issue = "Every browser page is closed. Reopen the Browser Device.";
      }
    }
  });
  return id;
}

async function pageProjection(state: SessionState, page: Page): Promise<BrowserDevicePage> {
  const id = attachPage(state, page);
  const opener = await page.opener().catch(() => null);
  return {
    id,
    kind: opener ? "popup" : "page",
    title: (page.isClosed()
      ? "Closed page"
      : await page.title().catch(() => "Untitled page")
    ).slice(0, 512),
    url: (page.isClosed() ? "" : page.url()).slice(0, 4_096),
    active: state.activePageId === id,
    closed: page.isClosed(),
  };
}

async function projection(state: SessionState): Promise<BrowserDeviceRuntimeSession> {
  const allPages = [...state.pages.values()];
  const projectedPages = allPages.slice(-32);
  const activePage = state.pages.get(state.activePageId);
  if (activePage && !projectedPages.includes(activePage)) {
    projectedPages.shift();
    projectedPages.unshift(activePage);
  }
  const pages = await Promise.all(projectedPages.map((page) => pageProjection(state, page)));
  return {
    schemaVersion: 1,
    sessionId: state.runtime.sessionId,
    targetId: state.runtime.targetId,
    status: state.status,
    sequence: state.sequence,
    activePageId: state.activePageId,
    pages,
    profile: state.runtime.profile,
    startedAt: state.startedAt,
    ...(state.frame ? { frameCapturedAt: state.frame.capturedAt } : {}),
    ...(state.issue ? { issue: state.issue } : {}),
  };
}

export async function openBrowserDeviceSession(
  targetId: string,
  profile?: BrowserCaseProfile,
): Promise<BrowserDeviceRuntimeSession> {
  const previous = states.get(targetId);
  if (
    previous?.status === "crashed" ||
    previous?.status === "closed" ||
    (previous?.status === "degraded" && previous.needsFreshFrame)
  ) {
    await closeBrowserDeviceSession(targetId);
  }
  const runtime = await openBrowserAuthoringRuntime(targetId, { headless: true, profile });
  const current = states.get(targetId);
  if (current?.runtime.sessionId === runtime.sessionId) return projection(current);
  const page = await runtime.activePage();
  const state: SessionState = {
    runtime,
    startedAt: Date.now(),
    status: "starting",
    sequence: 0,
    activePageId: "",
    pageIds: new WeakMap(),
    pages: new Map(),
    attached: new WeakSet(),
    needsFreshFrame: true,
    observedMutationVersion: runtime.mutationVersion(),
    input: Promise.resolve(),
  };
  state.activePageId = attachPage(state, page);
  for (const existing of runtime.context.pages()) attachPage(state, existing);
  runtime.context.on("page", (created) => {
    const createdId = attachPage(state, created);
    // Canonical recording creates a replacement page immediately after
    // closing its prior video boundary. Follow that explicit context-owned
    // replacement; closing the final tab without a replacement stays terminal.
    if (state.status === "closed") {
      state.status = "starting";
      state.issue = undefined;
      state.activePageId = createdId;
      state.runtime.setActivePage(created);
    }
    state.needsFreshFrame = true;
  });
  states.set(targetId, state);
  return projection(state);
}

export async function readBrowserDeviceSession(
  targetId: string,
): Promise<BrowserDeviceRuntimeSession> {
  return projection(stateForTarget(targetId));
}

async function capture(state: SessionState): Promise<BrowserDeviceFrame> {
  if (state.status === "crashed" || state.status === "closed") {
    throw new BrowserDeviceConflictError(
      "BROWSER_PAGE_STALE",
      state.issue ?? "The Browser Device must be reopened",
      state.sequence,
    );
  }
  const started = Date.now();
  let page = state.pages.get(state.activePageId);
  if (!page || page.isClosed()) {
    // Canonical recording deliberately replaces its page at start/stop to
    // create a clean video boundary. Follow that owned replacement only;
    // ordinary popups never steal the selected page.
    page = await state.runtime.activePage();
    state.activePageId = attachPage(state, page);
    state.needsFreshFrame = true;
  }
  try {
    const buffer = await page.screenshot({ type: "jpeg", quality: 76, animations: "disabled" });
    const capturedAt = Date.now();
    const digest = createHash("sha256").update(buffer).digest("base64url");
    // Sequence identifies an observation, not visual novelty. Two URLs or DOM
    // states may paint identical pixels, so every successful capture retires
    // the previously painted input boundary. The digest remains the stable
    // visual identity used for deduplication and review.
    state.sequence += 1;
    const viewport = page.viewportSize() ?? state.runtime.profile.viewport;
    state.frame = {
      sessionId: state.runtime.sessionId,
      sequence: state.sequence,
      pageId: state.activePageId,
      pageUrl: page.url().slice(0, 4_096),
      visualFingerprint: digest,
      capturedAt,
      mime: "image/jpeg",
      base64: buffer.toString("base64"),
      bytes: buffer.byteLength,
      width: viewport.width,
      height: viewport.height,
    };
    state.observedMutationVersion = state.runtime.mutationVersion();
    state.needsFreshFrame = false;
    if (capturedAt - started > FRAME_DEGRADED_MS) {
      state.status = "degraded";
      state.issue = `Browser frames are delayed (${capturedAt - started} ms). Input remains frame-checked.`;
    } else {
      state.status = "streaming";
      state.issue = undefined;
    }
    return state.frame;
  } catch (error) {
    state.status =
      (state.status as BrowserDeviceRuntimeSession["status"]) === "crashed"
        ? "crashed"
        : "degraded";
    state.issue = message(error);
    state.needsFreshFrame = true;
    throw error;
  }
}

/** Request-driven newest-frame transport: there is one capture in flight per
 * session, so slow renderers create backpressure instead of an unbounded JPEG
 * queue. Sequence gaps are derived by the caller from its last painted frame. */
export async function captureBrowserDeviceFrame(targetId: string): Promise<{
  session: BrowserDeviceRuntimeSession;
  frame: BrowserDeviceFrame;
}> {
  const state = stateForTarget(targetId);
  // Captures and input share one strict ordering boundary. A frame can never
  // finish between input validation and Playwright dispatch.
  await state.input;
  state.capture ??= capture(state).finally(() => {
    state.capture = undefined;
  });
  const frame = await state.capture;
  return { session: await projection(state), frame };
}

function assertInput(state: SessionState, input: BrowserDeviceInput): Page {
  if (input.sessionId !== state.runtime.sessionId) {
    throw new BrowserDeviceConflictError(
      "BROWSER_SESSION_STALE",
      "The Browser Device session changed",
    );
  }
  if (
    input.expectedSequence !== state.sequence ||
    state.needsFreshFrame ||
    state.observedMutationVersion !== state.runtime.mutationVersion()
  ) {
    throw new BrowserDeviceConflictError(
      "BROWSER_STALE_INPUT",
      "The browser changed after this frame. Wait for the current frame and try again.",
      state.sequence,
    );
  }
  if (input.pageId !== state.activePageId) {
    throw new BrowserDeviceConflictError("BROWSER_PAGE_STALE", "The selected browser tab changed");
  }
  const page = state.pages.get(input.pageId);
  if (!page || page.isClosed()) {
    throw new BrowserDeviceConflictError(
      "BROWSER_PAGE_STALE",
      "The selected browser page is closed",
    );
  }
  if (state.status === "crashed" || state.status === "closed") {
    throw new BrowserDeviceConflictError(
      "BROWSER_PAGE_STALE",
      state.issue ?? "Browser page unavailable",
    );
  }
  return page;
}

async function applyInput(state: SessionState, input: BrowserDeviceInput): Promise<void> {
  const page = assertInput(state, input);
  // Fail closed before dispatch: a rejected or uncertain Playwright mutation
  // still requires a new observation before any later input.
  state.needsFreshFrame = true;
  state.runtime.markMutation();
  if (input.kind === "click") await page.mouse.click(input.x, input.y);
  else if (input.kind === "wheel") {
    await page.mouse.move(input.x, input.y);
    await page.mouse.wheel(input.deltaX, input.deltaY);
  } else if (input.kind === "text") await page.keyboard.insertText(input.text);
  else if (input.kind === "key") await page.keyboard.press(input.key);
  else if (input.kind === "navigate") {
    const destination = new URL(input.url);
    if (destination.protocol !== "http:" && destination.protocol !== "https:") {
      throw new Error("Browser Device navigation requires an http or https URL");
    }
    await page.goto(destination.href, { waitUntil: "domcontentloaded" });
  } else if (input.kind === "history") {
    if (input.direction === "back") await page.goBack();
    else if (input.direction === "forward") await page.goForward();
    else await page.reload();
  } else {
    const selected = state.pages.get(input.targetPageId);
    if (!selected || selected.isClosed()) {
      throw new BrowserDeviceConflictError("BROWSER_PAGE_STALE", "That browser tab is closed");
    }
    if (input.kind === "page.close") await selected.close();
    else {
      state.activePageId = input.targetPageId;
      state.runtime.setActivePage(selected);
      await selected.bringToFront();
    }
  }
}

export async function controlBrowserDevice(
  targetId: string,
  input: BrowserDeviceInput,
  beforeDispatch?: () => Promise<void>,
): Promise<{ ok: true; session: BrowserDeviceRuntimeSession }> {
  const state = stateForTarget(targetId);
  const operation = state.input.then(async () => {
    if (state.capture) await state.capture;
    await beforeDispatch?.();
    await applyInput(state, input);
  });
  state.input = operation.catch(() => undefined);
  await operation;
  return { ok: true, session: await projection(state) };
}

export async function closeBrowserDeviceSession(targetId?: string): Promise<void> {
  if (targetId === undefined) states.clear();
  else states.delete(targetId);
  await closeBrowserTarget(targetId, { mode: "authoring" });
}

export function resetBrowserDeviceSessionsForTests(): void {
  states.clear();
}
