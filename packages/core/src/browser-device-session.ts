import { waitForBrowserContent } from "./browser-readiness.js";
import { createHash } from "node:crypto";
import type { Locator, Page } from "playwright-core";
import type {
  BrowserCaseProfile,
  BrowserDeviceFrame,
  BrowserDeviceInput,
  BrowserDevicePage,
  BrowserDeviceInputResolution,
  BrowserDeviceSemanticCandidate,
  BrowserDeviceSemanticOverlay,
  BrowserDeviceSession,
  BrowserDeviceTelemetry,
} from "@relay/protocol";
import { summarizeBrowserDeviceTelemetry } from "@relay/protocol";
import {
  closeBrowserTarget,
  browserPageVisualFingerprint,
  existingLiveBrowserIdentity,
  openBrowserAuthoringRuntime,
  openBrowserLiveRuntime,
  snapshotBrowserPageSemantics,
  type BrowserAuthoringRuntime,
} from "./browser-target.js";
import { resolveBrowserDeviceOpenIdentity } from "./browser-execution-identity.js";
import type { SnapshotNode } from "./device.js";
import { runSupervisedBrowserMutation } from "./browser-mutation-supervision.js";
import { runBrowserMutationAdmission } from "./browser-mutation-admission.js";
import { InputNotDispatchedError } from "./input-not-dispatched.js";

export type BrowserDeviceRuntimeSession = Omit<BrowserDeviceSession, "ownership">;

export class BrowserDeviceConflictError extends InputNotDispatchedError {
  constructor(
    readonly code:
      | "BROWSER_STALE_INPUT"
      | "BROWSER_PAGE_STALE"
      | "BROWSER_SESSION_STALE"
      | "BROWSER_SEMANTIC_TARGET_REQUIRED",
    message: string,
    readonly currentSequence?: number,
  ) {
    super(message);
    this.name = "BrowserDeviceConflictError";
  }
}

type ResolvedBrowserClick = {
  resolution: BrowserDeviceInputResolution;
  dispatch: () => Promise<void>;
};

/** Maximum number of closed browser pages retained as inspectable tombstones. */
export const MAX_BROWSER_DEVICE_PAGE_TOMBSTONES = 32;
/** Maximum number of untrusted popup pages allowed to remain open. */
export const MAX_BROWSER_DEVICE_OPEN_POPUPS = 8;

type SessionState = {
  runtime: BrowserAuthoringRuntime;
  startedAt: number;
  status: BrowserDeviceRuntimeSession["status"];
  issue?: string;
  sequence: number;
  activePageId: string;
  pageIds: WeakMap<Page, string>;
  pages: Map<string, Page>;
  pageKinds: Map<string, "page" | "popup">;
  pageClosedAt: Map<string, number>;
  attached: WeakSet<Page>;
  frame?: BrowserDeviceFrame;
  equivalentFrames: Map<number, number>;
  observedMutationVersion: number;
  needsFreshFrame: boolean;
  capture?: Promise<BrowserDeviceFrame>;
  frameCaptureMs: number[];
  interactionMs: number[];
  frameTimesMs: number[];
};

const states = new Map<string, SessionState>();
const FRAME_DEGRADED_MS = 1_000;
export const MAX_BROWSER_DEVICE_SEMANTIC_CANDIDATES = 128;
const MAX_BROWSER_DEVICE_TELEMETRY_SAMPLES = 128;

function retainSample(samples: number[], value: number): void {
  samples.push(Math.max(0, Math.round(value)));
  if (samples.length > MAX_BROWSER_DEVICE_TELEMETRY_SAMPLES) samples.shift();
}

function telemetry(state: SessionState): BrowserDeviceTelemetry {
  return summarizeBrowserDeviceTelemetry({
    frameCaptureMs: state.frameCaptureMs,
    interactionMs: state.interactionMs,
    frameTimesMs: state.frameTimesMs,
    frameCount: state.sequence,
  });
}

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

function prunePageTombstones(state: SessionState): void {
  const tombstones = [...state.pages.keys()].filter((id) => {
    const page = state.pages.get(id);
    return Boolean(page && (page.isClosed() || state.pageClosedAt.has(id)));
  });
  let excess = tombstones.length - MAX_BROWSER_DEVICE_PAGE_TOMBSTONES;
  for (const id of tombstones) {
    if (excess <= 0) break;
    if (id === state.activePageId) continue;
    state.pages.delete(id);
    state.pageKinds.delete(id);
    state.pageClosedAt.delete(id);
    excess -= 1;
  }
}

function openPopupCount(state: SessionState): number {
  return [...state.pages.entries()].filter(
    ([id, page]) =>
      state.pageKinds.get(id) === "popup" && !page.isClosed() && !state.pageClosedAt.has(id),
  ).length;
}

/** Close a newly-created untrusted popup before Relay attaches any listeners or
 * retains its identity. The close promise is deliberately not queued or kept
 * in session state: hostile popup churn cannot grow Relay's memory graph. */
function closeUntrustedPopup(page: Page): void {
  void page.close().catch(() => undefined);
}

function attachPage(state: SessionState, page: Page, kind: "page" | "popup" = "popup"): string {
  const id = pageId(state, page);
  state.pageKinds.set(id, state.pageKinds.get(id) ?? kind);
  if (state.attached.has(page)) return id;
  state.attached.add(page);
  page.on("crash", () => {
    state.status = "crashed";
    state.issue = "The browser page crashed. Reload or reopen the Browser Device.";
    state.needsFreshFrame = true;
  });
  page.on("close", () => {
    state.needsFreshFrame = true;
    state.pageClosedAt.set(id, Date.now());
    if (state.activePageId === id) {
      const replacement = [...state.pages.entries()].find(([, candidate]) => !candidate.isClosed());
      if (replacement) state.activePageId = replacement[0];
      else {
        state.status = "closed";
        state.issue = "Every browser page is closed. Reopen the Browser Device.";
      }
    }
    prunePageTombstones(state);
  });
  return id;
}

async function pageProjection(state: SessionState, page: Page): Promise<BrowserDevicePage> {
  const id = attachPage(state, page);
  const closed = page.isClosed() || state.pageClosedAt.has(id);
  return {
    id,
    kind: state.pageKinds.get(id) ?? "page",
    title: (closed ? "Closed page" : await page.title().catch(() => "Untitled page")).slice(0, 512),
    url: (closed ? "" : page.url()).slice(0, 4_096),
    active: state.activePageId === id,
    closed,
  };
}

async function projection(state: SessionState): Promise<BrowserDeviceRuntimeSession> {
  prunePageTombstones(state);
  const allPages = [...state.pages.entries()];
  const projectedPages = allPages.slice(-MAX_BROWSER_DEVICE_PAGE_TOMBSTONES);
  const activePage = state.pages.get(state.activePageId);
  if (activePage && !projectedPages.some(([id]) => id === state.activePageId)) {
    projectedPages.shift();
    projectedPages.unshift([state.activePageId, activePage]);
  }
  const pages = await Promise.all(projectedPages.map(([, page]) => pageProjection(state, page)));
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
    telemetry: telemetry(state),
  };
}

export async function openBrowserDeviceSession(
  targetId: string,
  profile?: BrowserCaseProfile,
  identity?: {
    authenticationFixtureId?: string;
    signedOut?: boolean;
    projectId?: string;
    sessionId?: string;
  },
): Promise<BrowserDeviceRuntimeSession> {
  const previous = states.get(targetId);
  if (
    previous?.status === "crashed" ||
    previous?.status === "closed" ||
    (previous?.status === "degraded" && previous.needsFreshFrame)
  ) {
    await closeBrowserDeviceSession(targetId);
  }
  const resolved = resolveBrowserDeviceOpenIdentity({
    requested: {
      ...(identity?.authenticationFixtureId
        ? { authenticationFixtureId: identity.authenticationFixtureId }
        : {}),
      ...(identity?.signedOut ? { signedOut: true } : {}),
    },
    existingLive: existingLiveBrowserIdentity(targetId),
    savedProfile: profile,
  });
  const fixtureId = resolved.authenticationFixtureId;
  const signedOut = resolved.signedOut === true;
  const accountBound = Boolean(fixtureId || signedOut);
  const runtime = accountBound
    ? await openBrowserLiveRuntime(targetId, {
        headless: true,
        profile,
        ...(fixtureId ? { authenticationFixtureId: fixtureId } : {}),
        ...(signedOut ? { signedOut: true } : {}),
        ...(identity?.projectId ? { projectId: identity.projectId } : {}),
      })
    : await openBrowserAuthoringRuntime(targetId, { headless: true, profile });
  const requestedSessionId = identity?.sessionId?.trim();
  if (requestedSessionId && runtime.sessionId !== requestedSessionId) {
    throw new Error(
      `Browser Device attached to ${runtime.sessionId}, not the requested live session ${requestedSessionId}.`,
    );
  }
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
    pageKinds: new Map(),
    pageClosedAt: new Map(),
    attached: new WeakSet(),
    needsFreshFrame: true,
    observedMutationVersion: runtime.mutationVersion(),
    frameCaptureMs: [],
    equivalentFrames: new Map(),
    interactionMs: [],
    frameTimesMs: [],
  };
  state.activePageId = attachPage(state, page, "page");
  for (const existing of runtime.context.pages()) {
    if (existing === page) continue;
    if (openPopupCount(state) >= MAX_BROWSER_DEVICE_OPEN_POPUPS) closeUntrustedPopup(existing);
    else attachPage(state, existing, "popup");
  }
  runtime.context.on("page", (created) => {
    // The context emits a Page before Relay can inspect it. Count only already
    // admitted live popups and close the next untrusted one before attaching
    // listeners or adding a tombstone. The root/replacement page remains the
    // only page that can be admitted while the session is terminal.
    if (state.status !== "closed" && openPopupCount(state) >= MAX_BROWSER_DEVICE_OPEN_POPUPS) {
      closeUntrustedPopup(created);
      return;
    }
    const createdId = attachPage(state, created, state.status === "closed" ? "page" : "popup");
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
  const started = performance.now();
  let page = state.pages.get(state.activePageId);
  if (!page || page.isClosed()) {
    // Canonical recording deliberately replaces its page at start/stop to
    // create a clean video boundary. Follow that owned replacement only;
    // ordinary popups never steal the selected page.
    page = await state.runtime.activePage();
    state.activePageId = attachPage(state, page, "page");
    state.needsFreshFrame = true;
  }
  try {
    const buffer = await page.screenshot({ type: "jpeg", quality: 76, animations: "disabled" });
    const capturedAt = Date.now();
    const captureMs = performance.now() - started;
    retainSample(state.frameCaptureMs, captureMs);
    state.frameTimesMs.push(performance.now());
    if (state.frameTimesMs.length > MAX_BROWSER_DEVICE_TELEMETRY_SAMPLES) {
      state.frameTimesMs.shift();
    }
    const digest = createHash("sha256").update(buffer).digest("base64url");
    // The next capture can finish before the renderer paints it. Preserve a
    // bounded window of identical observations, but never across a mutation,
    // navigation, page switch, or visual change (even if pixels later return).
    if (
      state.needsFreshFrame ||
      state.observedMutationVersion !== state.runtime.mutationVersion() ||
      state.frame?.pageId !== state.activePageId ||
      state.frame?.pageUrl !== page.url().slice(0, 4_096) ||
      state.frame?.visualFingerprint !== digest
    )
      state.equivalentFrames.clear();
    state.sequence += 1;
    state.equivalentFrames.set(state.sequence, capturedAt);
    if (state.equivalentFrames.size > 8) {
      state.equivalentFrames.delete(state.equivalentFrames.keys().next().value!);
    }
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
    if (captureMs > FRAME_DEGRADED_MS) {
      state.status = "degraded";
      state.issue = `Browser frames are delayed (${Math.round(captureMs)} ms). Input remains frame-checked.`;
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

function bounded(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function semanticCandidate(
  node: SnapshotNode,
  index: number,
): BrowserDeviceSemanticCandidate | null {
  const rect = node.rect;
  if (
    !rect ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }
  const role = bounded(node.role ?? node.type, 128) ?? "element";
  const label = bounded(node.label, 256);
  const value = bounded(node.value, 256);
  const identifier = bounded(node.identifier, 256);
  const locator = identifier
    ? { strategy: "identifier" as const, value: identifier, exact: true }
    : label
      ? { strategy: "role-name" as const, value: label, role, exact: true }
      : value
        ? { strategy: "text" as const, value, exact: true }
        : undefined;
  const reasoning = identifier
    ? `Stable identifier ${JSON.stringify(identifier)}.`
    : label
      ? `Role ${JSON.stringify(role)} with accessible name ${JSON.stringify(label)}.`
      : value
        ? `Visible text ${JSON.stringify(value)}; review before using it.`
        : "No stable semantic name; coordinate fallback requires explicit review.";
  return {
    id: `candidate-${node.index ?? index}`,
    role,
    ...(label ? { label } : {}),
    ...(value ? { value } : {}),
    ...(identifier ? { identifier } : {}),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    enabled: node.enabled !== false,
    selected: node.selected === true,
    focused: node.focused === true,
    ...(locator ? { locator } : {}),
    reasoning,
  };
}

function semanticCandidates(nodes: SnapshotNode[]): {
  candidates: BrowserDeviceSemanticCandidate[];
  truncated: boolean;
} {
  const candidates: BrowserDeviceSemanticCandidate[] = [];
  for (const [index, node] of nodes.entries()) {
    // Canonical snapshots also retain visible read-only semantics for
    // assertions. Browser Device overlays are an input surface, so those
    // nodes must never be promoted into clickable candidates.
    if (node.hittable === false) continue;
    const candidate = semanticCandidate(node, index);
    if (candidate) candidates.push(candidate);
  }
  return {
    candidates: candidates.slice(0, MAX_BROWSER_DEVICE_SEMANTIC_CANDIDATES),
    truncated: candidates.length > MAX_BROWSER_DEVICE_SEMANTIC_CANDIDATES,
  };
}

function assertInspectableFrame(
  state: SessionState,
  input: { sessionId: string; pageId: string; expectedSequence: number },
): BrowserDeviceFrame {
  const frame = state.frame;
  if (
    !frame ||
    input.sessionId !== state.runtime.sessionId ||
    input.sessionId !== frame.sessionId
  ) {
    throw new BrowserDeviceConflictError(
      "BROWSER_SESSION_STALE",
      "The Browser Device session changed",
    );
  }
  if (
    !state.equivalentFrames.has(input.expectedSequence) ||
    state.needsFreshFrame ||
    state.observedMutationVersion !== state.runtime.mutationVersion()
  ) {
    throw new BrowserDeviceConflictError(
      "BROWSER_STALE_INPUT",
      "The browser changed after this frame. Capture the current frame before inspecting it.",
      state.sequence,
    );
  }
  if (input.pageId !== frame.pageId || input.pageId !== state.activePageId) {
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
  return {
    ...frame,
    sequence: input.expectedSequence,
    capturedAt: state.equivalentFrames.get(input.expectedSequence)!,
  };
}

/**
 * Inspect only the server-owned page associated with one painted frame. The
 * renderer receives bounded JSON candidates, never a Page, DOM, script, or
 * executable selector. Callers must capture a fresh frame after any mutation.
 */
export async function inspectBrowserDevice(
  targetId: string,
  input: { sessionId: string; pageId: string; expectedSequence: number },
): Promise<{ overlay: BrowserDeviceSemanticOverlay }> {
  const state = stateForTarget(targetId);
  return runBrowserMutationAdmission(targetId, async () => {
    if (state.capture) await state.capture;
    const frame = assertInspectableFrame(state, input);
    const page = state.pages.get(input.pageId)!;
    const beforeFingerprint = await browserPageVisualFingerprint(page);
    if (beforeFingerprint !== frame.visualFingerprint) {
      state.needsFreshFrame = true;
      throw new BrowserDeviceConflictError(
        "BROWSER_STALE_INPUT",
        "The browser changed after this frame. Capture the current frame before inspecting it.",
        state.sequence,
      );
    }
    const snapshot = await snapshotBrowserPageSemantics(
      page,
      MAX_BROWSER_DEVICE_SEMANTIC_CANDIDATES,
    );
    const afterFingerprint = await browserPageVisualFingerprint(page);
    if (afterFingerprint !== beforeFingerprint) {
      state.needsFreshFrame = true;
      throw new BrowserDeviceConflictError(
        "BROWSER_STALE_INPUT",
        "The browser changed while its labels were being inspected. Capture a fresh frame and retry.",
        state.sequence,
      );
    }
    const projected = semanticCandidates(snapshot.nodes);
    return {
      overlay: {
        schemaVersion: 1,
        sessionId: frame.sessionId,
        pageId: frame.pageId,
        sequence: frame.sequence,
        visualFingerprint: frame.visualFingerprint,
        capturedAt: frame.capturedAt,
        candidates: projected.candidates,
        truncated: snapshot.truncated || projected.truncated,
      },
    };
  });
}

/** Request-driven newest-frame transport: there is one capture in flight per
 * session, so slow renderers create backpressure instead of an unbounded JPEG
 * queue. Sequence gaps are derived by the caller from its last painted frame. */
export async function captureBrowserDeviceFrame(targetId: string): Promise<{
  session: BrowserDeviceRuntimeSession;
  frame: BrowserDeviceFrame;
}> {
  const state = stateForTarget(targetId);
  // Captures and every browser mutation occupy one target-scoped lane. A
  // generic browser adapter mutation therefore cannot dispatch after this
  // frame's freshness checks but before its pixels are captured.
  state.capture ??= runBrowserMutationAdmission(targetId, () => capture(state)).finally(() => {
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
    !state.equivalentFrames.has(input.expectedSequence) ||
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

async function applyInput(
  state: SessionState,
  input: BrowserDeviceInput,
  resolvedClick?: ResolvedBrowserClick,
): Promise<void> {
  const page = assertInput(state, input);
  // Fail closed before dispatch: a rejected or uncertain Playwright mutation
  // still requires a new observation before any later input.
  state.needsFreshFrame = true;
  state.runtime.markMutation();
  if (input.kind === "click") {
    if (resolvedClick) await resolvedClick.dispatch();
    else await page.mouse.click(input.x, input.y);
  } else if (input.kind === "wheel") {
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
    await waitForBrowserContent(page);
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

function pointInCandidate(
  candidate: BrowserDeviceSemanticCandidate,
  x: number,
  y: number,
): boolean {
  return (
    x >= candidate.rect.x &&
    x <= candidate.rect.x + candidate.rect.width &&
    y >= candidate.rect.y &&
    y <= candidate.rect.y + candidate.rect.height
  );
}

function semanticLocator(
  page: Page,
  candidate: BrowserDeviceSemanticCandidate,
): Locator | undefined {
  const locator = candidate.locator;
  if (!locator || locator.strategy === "text") return undefined;
  if (locator.strategy === "identifier") {
    // JSON string quoting is valid CSS attribute-value syntax and avoids
    // treating an authored id/test id as executable selector text.
    return page.locator(
      `[id=${JSON.stringify(locator.value)}], [data-testid=${JSON.stringify(locator.value)}]`,
    );
  }
  if (locator.strategy === "label") return page.getByLabel(locator.value, { exact: true });
  const role =
    (
      { a: "link", input: "textbox", textarea: "textbox", select: "combobox" } as Record<
        string,
        string
      >
    )[locator.role ?? ""] ?? locator.role;
  if (!role) return undefined;
  return page.getByRole(role as never, { name: locator.value, exact: locator.exact ?? true });
}

/** Resolve a point against the same exact frame that the renderer painted.
 * Semantic resolution is deliberately strict: stale, hidden, disabled, or
 * ambiguous candidates cannot silently become coordinate actions. */
async function resolveBrowserClick(
  state: SessionState,
  input: Extract<BrowserDeviceInput, { kind: "click" }>,
): Promise<ResolvedBrowserClick> {
  const frame = assertInspectableFrame(state, input);
  const page = state.pages.get(input.pageId)!;
  const beforeFingerprint = await browserPageVisualFingerprint(page);
  if (beforeFingerprint !== frame.visualFingerprint) {
    state.needsFreshFrame = true;
    throw new BrowserDeviceConflictError(
      "BROWSER_STALE_INPUT",
      "The browser changed after this frame. Capture the current frame before clicking.",
      state.sequence,
    );
  }
  const snapshot = await snapshotBrowserPageSemantics(page, MAX_BROWSER_DEVICE_SEMANTIC_CANDIDATES);
  const afterFingerprint = await browserPageVisualFingerprint(page);
  if (afterFingerprint !== beforeFingerprint) {
    state.needsFreshFrame = true;
    throw new BrowserDeviceConflictError(
      "BROWSER_STALE_INPUT",
      "The browser changed while its controls were being resolved. Capture a fresh frame and retry.",
      state.sequence,
    );
  }

  const candidates = semanticCandidates(snapshot.nodes).candidates.filter(
    (candidate) =>
      candidate.enabled &&
      candidate.locator !== undefined &&
      candidate.locator.strategy !== "text" &&
      pointInCandidate(candidate, input.x, input.y),
  );
  const live: Array<{ candidate: BrowserDeviceSemanticCandidate; locator: Locator }> = [];
  for (const candidate of candidates) {
    try {
      const locator = semanticLocator(page, candidate);
      if (!locator || (await locator.count()) !== 1) continue;
      const element = locator.first();
      if (!(await element.isVisible()) || !(await element.isEnabled())) continue;
      const box = await element.boundingBox();
      if (
        !box ||
        input.x < box.x ||
        input.x > box.x + box.width ||
        input.y < box.y ||
        input.y > box.y + box.height
      ) {
        continue;
      }
      live.push({ candidate, locator: element });
    } catch {
      // Invalid or unsupported ARIA roles fail closed and can still use an
      // explicit reviewed coordinate fallback.
    }
  }

  // Locator checks are asynchronous too. Re-bracket them with the painted
  // raster so a DOM transition during resolution cannot be dispatched as if
  // it belonged to the original frame.
  const finalFingerprint = await browserPageVisualFingerprint(page);
  if (finalFingerprint !== beforeFingerprint) {
    state.needsFreshFrame = true;
    throw new BrowserDeviceConflictError(
      "BROWSER_STALE_INPUT",
      "The browser changed while its target was being resolved. Capture a fresh frame and retry.",
      state.sequence,
    );
  }

  const selected = live[0];
  if (live.length === 1 && selected) {
    const candidate = selected.candidate;
    const locator = candidate.locator!;
    return {
      resolution: {
        outcome: "semantic",
        strategy: locator.strategy,
        candidateId: candidate.id,
        locator,
        reviewedCoordinateFallback: false,
        reasoning: `Resolved ${JSON.stringify(locator.strategy)} ${JSON.stringify(locator.value)}: one visible enabled match at the exact painted point.`,
      },
      dispatch: () => selected.locator.click(),
    };
  }

  if (input.coordinateFallback === "reviewed") {
    return {
      resolution: {
        outcome: "coordinate-fallback",
        strategy: "coordinate",
        reviewedCoordinateFallback: true,
        reasoning:
          live.length > 1
            ? "No unique visible enabled stable locator matched this point; coordinate fallback was explicitly reviewed."
            : "No visible enabled stable locator matched this point; coordinate fallback was explicitly reviewed.",
      },
      dispatch: () => page.mouse.click(input.x, input.y),
    };
  }
  throw new BrowserDeviceConflictError(
    "BROWSER_SEMANTIC_TARGET_REQUIRED",
    live.length > 1
      ? "This point matches multiple visible enabled controls. Inspect the frame or explicitly review coordinate fallback."
      : "This point has no unique visible enabled semantic control. Inspect the frame or explicitly review coordinate fallback.",
    state.sequence,
  );
}

function validateInputBeforeDispatch(state: SessionState, input: BrowserDeviceInput): void {
  assertInput(state, input);
  if (input.kind === "navigate") {
    const destination = new URL(input.url);
    if (destination.protocol !== "http:" && destination.protocol !== "https:") {
      throw new Error("Browser Device navigation requires an http or https URL");
    }
  }
  if (input.kind === "page.close" || input.kind === "page.activate") {
    const selected = state.pages.get(input.targetPageId);
    if (!selected || selected.isClosed()) {
      throw new BrowserDeviceConflictError("BROWSER_PAGE_STALE", "That browser tab is closed");
    }
  }
}

export async function controlBrowserDevice(
  targetId: string,
  input: BrowserDeviceInput,
  beforeDispatch?: () => Promise<void>,
): Promise<{
  ok: true;
  session: BrowserDeviceRuntimeSession;
  resolution?: BrowserDeviceInputResolution;
}> {
  const state = stateForTarget(targetId);
  let resolvedClick: ResolvedBrowserClick | undefined;
  const startedAt = performance.now();
  const operation = runBrowserMutationAdmission(targetId, async () => {
    if (state.capture) await state.capture;
    await runSupervisedBrowserMutation({
      targetId,
      intent: `Browser Device ${input.kind}`,
      beforeDispatch: async () => {
        validateInputBeforeDispatch(state, input);
        if (input.kind === "click") resolvedClick = await resolveBrowserClick(state, input);
        await beforeDispatch?.();
      },
      dispatch: () => applyInput(state, input, resolvedClick),
    });
  });
  try {
    await operation;
  } finally {
    retainSample(state.interactionMs, performance.now() - startedAt);
  }
  return {
    ok: true,
    session: await projection(state),
    ...(resolvedClick ? { resolution: resolvedClick.resolution } : {}),
  };
}

export async function closeBrowserDeviceSession(targetId?: string): Promise<void> {
  if (targetId === undefined) states.clear();
  else states.delete(targetId);
  await closeBrowserTarget(targetId, { mode: "authoring" });
}

export function resetBrowserDeviceSessionsForTests(): void {
  states.clear();
}
