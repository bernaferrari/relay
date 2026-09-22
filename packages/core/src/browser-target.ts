import { waitForBrowserContent } from "./browser-readiness.js";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrowserContext, Page, Request, Video } from "playwright-core";
import { parseBrowserCaseProfile, type BrowserCaseProfile } from "@relay/protocol";
import type { Device, SnapshotNode } from "./device.js";
import { createBrowserContextFactory, type BrowserContextPurpose } from "./browser-context.js";
import {
  browserLiveIdentityMatches,
  browserLiveSessionKey,
  browserProofSessionKey,
  browserSessionBelongsToTarget,
  browserAttachKeepsExistingSession,
  browserSessionProfileMatches,
  browserSessionStoreKey,
} from "./browser-execution-identity.js";
import { bindBrowserLiveSession } from "./browser-live-handles.js";
import { browserAccountSchedulingKey } from "./browser-account-lane.js";
import { createDeviceObservationFacade } from "./device-observation-membrane.js";
import { fillBrowserLocator, locatorFor, performBrowserFind } from "./browser-target-locator.js";
import {
  dismissBrowserConsentIfPresent,
  installBrowserConsentOverlayHandler,
} from "./browser-consent-overlay.js";
import { browserCaseProfileForTarget } from "./browser-case-profile-target.js";
import { runSupervisedBrowserMutation } from "./browser-mutation-supervision.js";
import { runBrowserMutationAdmission } from "./browser-mutation-admission.js";
import { browserProfileDir, readTarget } from "./targets.js";
import { getEvidenceCollectionPolicy, hasSensitiveEvidenceConsent } from "./evidence-policy.js";
import { redactSensitiveEvidenceValue, redactValue, visualEvidenceAllowed } from "./redaction.js";
import {
  attachBrowserEvidence,
  snapshotBrowserPage,
  type BrowserNetworkEntry,
} from "./browser-target-evidence.js";

export { browserPageVisualFingerprint } from "./browser-target-evidence.js";
export type { BrowserNetworkEntry } from "./browser-target-evidence.js";

export type BrowserSession = {
  sessionId: string;
  context: BrowserContext;
  close: () => Promise<void>;
  page: Page;
  targetId: string;
  purpose: BrowserContextPurpose;
  profile: BrowserCaseProfile;
  headless: boolean;
  recordVideo: boolean;
  recordingUnavailable?: string;
  recordingPath?: string;
  recordingVideo?: Video | null;
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
  mutationVersion: number;
  traceStarted: boolean;
  unsignedLaneId?: string;
};

const sessions = new Map<string, Promise<BrowserSession>>();
export { sessions as browserSessions };

/** Live identity already opened for this target, if any. Authoring is ignored. */
export function existingLiveBrowserIdentity(targetId: string):
  | {
      authenticationFixtureId?: string;
      signedOut?: boolean;
    }
  | undefined {
  const signedOutKey = browserLiveSessionKey({ targetId, signedOut: true });
  if (sessions.has(signedOutKey)) return { signedOut: true };
  const prefix = `live:${targetId}:`;
  for (const key of sessions.keys()) {
    if (!key.startsWith(prefix) || key === signedOutKey) continue;
    return { authenticationFixtureId: key.slice(prefix.length) };
  }
  return undefined;
}

async function createSession(
  targetId: string,
  options: {
    headless?: boolean;
    mode: BrowserContextPurpose;
    profile?: BrowserCaseProfile;
    recordVideo?: boolean;
    projectId?: string;
    unsignedLaneId?: string;
  },
): Promise<BrowserSession> {
  const target = await readTarget(targetId);
  if (!target?.browser) throw new Error(`managed browser target not found: ${targetId}`);
  const factory = createBrowserContextFactory(target);
  const profile = options.profile ?? factory.profile;
  const recordingDir = join(
    browserProfileDir(targetId, options.mode === "authoring" ? options.unsignedLaneId : undefined),
    options.mode === "authoring" ? "recordings" : "proof-recordings",
  );
  const recordVideo = options.recordVideo !== false;
  let recordingUnavailable = recordVideo
    ? undefined
    : "Live Browser Device video is disabled. Screenshots, steps, and logs are still captured.";
  let contextHandle;
  try {
    contextHandle =
      options.mode === "authoring"
        ? await factory.openAuthoring({
            headless: options.headless,
            ...(recordVideo ? { recordVideoDir: recordingDir } : {}),
            profile,
            ...(options.unsignedLaneId ? { unsignedLaneId: options.unsignedLaneId } : {}),
          })
        : await factory.openProof(profile, {
            headless: options.headless,
            projectId: options.projectId,
            ...(recordVideo ? { recordVideoDir: recordingDir } : {}),
          });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ffmpeg|video rendering|recordvideo/i.test(message)) throw error;
    recordingUnavailable =
      "Video recording is unavailable on this machine. Screenshots, steps, and logs are still captured.";
    contextHandle =
      options.mode === "authoring"
        ? await factory.openAuthoring({
            headless: options.headless,
            profile,
            ...(options.unsignedLaneId ? { unsignedLaneId: options.unsignedLaneId } : {}),
          })
        : await factory.openProof(profile, {
            headless: options.headless,
            projectId: options.projectId,
          });
  }
  try {
    const context = contextHandle.context;
    const page = context.pages()[0] ?? (await context.newPage());
    const session: BrowserSession = {
      sessionId: crypto.randomUUID(),
      context,
      close: contextHandle.close,
      page,
      targetId,
      purpose: options.mode,
      profile: contextHandle.profile,
      headless: options.headless ?? target.browser.headless ?? false,
      recordVideo,
      ...(recordingUnavailable ? { recordingUnavailable } : {}),
      console: [],
      network: [],
      networkByRequest: new WeakMap(),
      networkInclude: "summary",
      networkPending: new Set(),
      crashes: [],
      pageErrors: [],
      pageErrorsDropped: 0,
      crashCapture: false,
      consoleDropped: 0,
      networkDropped: 0,
      mutationVersion: 0,
      traceStarted: false,
      ...(options.unsignedLaneId ? { unsignedLaneId: options.unsignedLaneId } : {}),
    };
    context.on("page", (next) => attachBrowserEvidence(session, next));
    if (options.mode === "proof") {
      try {
        await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
        session.traceStarted = true;
      } catch {
        // Tracing is optional; other evidence channels remain useful.
      }
    }
    attachBrowserEvidence(session, page);
    await installBrowserConsentOverlayHandler(page);
    if (page.url() === "about:blank") {
      await page.goto(target.browser.startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await waitForBrowserContent(page);
    }
    return session;
  } catch (error) {
    await contextHandle.close().catch(() => undefined);
    throw error;
  }
}

export { performBrowserFind } from "./browser-target-locator.js";

export async function sessionFor(
  targetId: string,
  options: {
    headless?: boolean;
    mode?: BrowserContextPurpose;
    profile?: BrowserCaseProfile;
    recordVideo?: boolean;
    projectId?: string;
    reuseMatchingIdentity?: boolean;
    requirePresentationMatch?: boolean;
    unsignedLaneId?: string;
  } = {},
): Promise<BrowserSession> {
  const mode = options.mode ?? "authoring";
  const key = browserSessionStoreKey({
    targetId,
    mode,
    reuseMatchingIdentity: options.reuseMatchingIdentity,
    authenticationFixtureId: options.profile?.authenticationFixtureId,
    unsignedLaneId: options.unsignedLaneId,
  });
  const existing = sessions.get(key);
  if (existing) {
    const session = await existing;
    if (
      browserAttachKeepsExistingSession({
        requestedProfile: options.profile,
        requirePresentationMatch: options.requirePresentationMatch,
        recordVideo: options.recordVideo,
        sessionRecordVideo: session.recordVideo,
        headless: options.headless,
        sessionHeadless: session.headless,
      })
    ) {
      return session;
    }
    const requestedProfile =
      options.profile ??
      (mode === "authoring"
        ? await readTarget(targetId).then((target) =>
            target ? browserCaseProfileForTarget(target) : undefined,
          )
        : undefined);
    const profileMatches = options.reuseMatchingIdentity
      ? browserLiveIdentityMatches(session.profile, requestedProfile)
      : browserSessionProfileMatches(session.profile, requestedProfile);
    if (
      profileMatches &&
      ((options.reuseMatchingIdentity && !options.requirePresentationMatch) ||
        ((options.recordVideo === undefined || session.recordVideo === options.recordVideo) &&
          (options.headless === undefined || session.headless === options.headless)))
    ) {
      // A proof session with the exact frozen profile (engine, viewport,
      // fixture revision) is the same configuration, not a stale one: reuse
      // it so consecutive operations in one workflow — snapshot, tap,
      // snapshot; teach observe, interact, observe — act on the same page.
      // Minting a fresh browser per operation made every prior operation's
      // effect invisible to the next (the deterministic "tap did nothing"
      // illusion) while paying a full launch each time. Mismatched profiles,
      // presentation, or recording intent still close and rebuild.
      return session;
    }
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

export {
  attachBrowserRuntime,
  captureBrowserAuthenticationStorageState,
  openBrowserAuthoringRuntime,
  openBrowserLiveRuntime,
  openBrowserTarget,
  type BrowserAuthoringRuntime,
  type OpenBrowserTargetResult,
} from "./browser-target-open.js";

/** Authoring profile when an authoring session is open; otherwise the saved target. */
export async function browserAuthoringCaseProfileForTarget(
  targetId: string,
): Promise<BrowserCaseProfile> {
  const current = sessions.get(`authoring:${targetId}`);
  if (current) return parseBrowserCaseProfile((await current).profile);
  const target = await readTarget(targetId);
  if (!target) throw new Error(`managed browser target not found: ${targetId}`);
  return parseBrowserCaseProfile(browserCaseProfileForTarget(target));
}

export async function activePage(session: BrowserSession): Promise<Page> {
  if (!session.page.isClosed()) return session.page;
  session.page = await session.context.newPage();
  attachBrowserEvidence(session, session.page);
  return session.page;
}

/** Bounded semantic view from the server-owned page; never a Page handle. */
export async function snapshotBrowserPageSemantics(
  page: Page,
  maxNodes = 128,
): Promise<{ nodes: SnapshotNode[]; truncated: boolean }> {
  const nodes = await snapshotBrowserPage(page, maxNodes + 1);
  return { nodes: nodes.slice(0, maxNodes), truncated: nodes.length > maxNodes };
}

function unsupported(capability: string): never {
  throw new Error(`capability unavailable for managed browser: ${capability}`);
}

/** Adapt a managed browser to Relay's existing device contract. */
export type BrowserDeviceOptions = {
  mode?: BrowserContextPurpose;
  profile?: BrowserCaseProfile;
  recordVideo?: boolean;
  projectId?: string;
  headless?: boolean;
  unsignedLaneId?: string;
};

export async function getBrowserDevice(
  targetId: string,
  options: BrowserDeviceOptions = {},
): Promise<Device> {
  const session = await sessionFor(targetId, options);
  const identifiers = { serial: targetId, appPath: "managed-browser" };
  const accountLane = browserAccountSchedulingKey(
    targetId,
    session.profile.authenticationFixtureId,
    session.unsignedLaneId,
  );
  const mutatePrepared = <T>(
    intent: string,
    prepare: () => Promise<() => Promise<T>>,
  ): Promise<T> => {
    let prepared: (() => Promise<T>) | undefined;
    return runBrowserMutationAdmission(accountLane, () =>
      runSupervisedBrowserMutation({
        targetId: accountLane,
        intent,
        beforeDispatch: async () => {
          await dismissBrowserConsentIfPresent(await activePage(session));
          prepared = await prepare();
        },
        dispatch: async () => {
          if (!prepared) throw new Error("Browser mutation was not prepared before dispatch");
          session.mutationVersion += 1;
          return prepared();
        },
      }),
    );
  };
  const mutate = <T>(intent: string, dispatch: () => Promise<T>) =>
    runBrowserMutationAdmission(accountLane, () =>
      runSupervisedBrowserMutation({
        targetId: accountLane,
        intent,
        dispatch: async () => {
          session.mutationVersion += 1;
          return dispatch();
        },
      }),
    );
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
      open: async (input: { url?: string; app?: string; relaunch?: boolean }) =>
        mutate("Open browser application", async () => {
          const page = await activePage(session);
          if (input.url) await page.goto(input.url, { waitUntil: "domcontentloaded" });
          else if (input.app?.startsWith("http"))
            await page.goto(input.app, { waitUntil: "domcontentloaded" });
          await waitForBrowserContent(page);
          return { appId: input.app ?? input.url ?? targetId };
        }),
      close: async () =>
        mutate("Close browser application", async () => {
          await (await activePage(session)).close();
          return { session: targetId, identifiers };
        }),
    },
    capture: {
      snapshot: async () => ({
        nodes: await snapshotBrowserPage(await activePage(session)),
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
      press: async (input: {
        ref?: string;
        selector?: string;
        heading?: string;
        x?: number;
        y?: number;
      }) =>
        mutatePrepared("Press browser target", async () => {
          const page = await activePage(session);
          // Heading-scoped labels must click the Playwright locator. A snapshot
          // point can land on a non-actionable overlay copy of the same label.
          if (input.x !== undefined && input.y !== undefined && !input.heading?.trim()) {
            return async () => {
              await page.mouse.click(input.x!, input.y!);
              return { ok: true };
            };
          }
          const locator = await locatorFor(page, input);
          return async () => {
            await locator.click();
            return { ok: true };
          };
        }),
      longPress: async (input: {
        ref?: string;
        selector?: string;
        x?: number;
        y?: number;
        durationMs?: number;
      }) =>
        mutatePrepared("Long-press browser target", async () => {
          const page = await activePage(session);
          if (input.x !== undefined && input.y !== undefined) {
            return async () => {
              await page.mouse.move(input.x!, input.y!);
              await page.mouse.down();
              await page.waitForTimeout(input.durationMs ?? 700);
              await page.mouse.up();
              return { ok: true };
            };
          }
          const locator = await locatorFor(page, input);
          const box = await locator.boundingBox();
          if (!box) throw new Error("target is not visible");
          return async () => {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.waitForTimeout(input.durationMs ?? 700);
            await page.mouse.up();
            return { ok: true };
          };
        }),
      fill: async (input: {
        text: string;
        ref?: string;
        selector?: string;
        x?: number;
        y?: number;
      }) =>
        mutatePrepared("Fill browser target", async () => {
          const page = await activePage(session);
          if (input.ref || input.selector) {
            const locator = await locatorFor(page, input);
            return async () => {
              await fillBrowserLocator(locator, input.text);
              return { ok: true };
            };
          }
          if (input.x === undefined || input.y === undefined) {
            throw new Error("replace text requires a target");
          }
          return async () => {
            await page.mouse.click(input.x!, input.y!);
            await page.keyboard.press("ControlOrMeta+A");
            await page.keyboard.insertText(input.text);
            return { ok: true };
          };
        }),
      type: async (input: { text: string; ref?: string; selector?: string }) =>
        mutatePrepared("Type browser text", async () => {
          const page = await activePage(session);
          const locator = input.ref || input.selector ? await locatorFor(page, input) : undefined;
          return async () => {
            if (locator) await fillBrowserLocator(locator, input.text);
            else await page.keyboard.insertText(input.text);
            return { ok: true };
          };
        }),
      find: async (input: { query: string; action?: string }) => {
        const page = await activePage(session);
        const locator = page.getByText(input.query, { exact: false });
        if (input.action === "exists")
          return performBrowserFind(locator, input.query, input.action);
        return mutatePrepared("Find and press browser target", async () => {
          if (input.action !== undefined && input.action !== "press" && input.action !== "click") {
            throw new Error(`unsupported browser find action: ${input.action}`);
          }
          const count = await locator.count();
          if (count === 0) throw new Error(`No match for ${input.query}`);
          if (count > 1) throw new Error(`Ambiguous browser match for ${input.query}`);
          return async () => {
            await locator.click();
            return { ok: true };
          };
        });
      },
      scroll: async (input: { direction?: string; amount?: number }) =>
        mutate("Scroll browser page", async () => {
          const page = await activePage(session);
          const viewportHeight = page.viewportSize()?.height ?? 1_000;
          const distance = viewportHeight * (input.amount ?? 0.5);
          const y = input.direction === "up" ? -distance : distance;
          await page.mouse.wheel(0, y);
          return { ok: true };
        }),
      swipe: async (input: { from: { x: number; y: number }; to: { x: number; y: number } }) =>
        mutate("Swipe browser page", async () => {
          const page = await activePage(session);
          await page.mouse.move(input.from.x, input.from.y);
          await page.mouse.down();
          await page.mouse.move(input.to.x, input.to.y, { steps: 12 });
          await page.mouse.up();
          return { ok: true };
        }),
      pan: async (input: { x: number; y: number; dx: number; dy: number; durationMs?: number }) =>
        mutate("Pan browser page", async () => {
          const page = await activePage(session);
          await page.mouse.move(input.x, input.y);
          await page.mouse.down();
          await page.mouse.move(input.x + input.dx, input.y + input.dy, {
            steps: Math.max(12, Math.round((input.durationMs ?? 250) / 20)),
          });
          await page.mouse.up();
          return { ok: true };
        }),
    },
    command: {
      wait: async (input: {
        durationMs?: number;
        text?: string;
        selector?: string;
        timeoutMs?: number;
      }) => {
        const page = await activePage(session);
        const timeout = input.timeoutMs;
        if (input.text)
          await page.getByText(input.text, { exact: false }).first().waitFor({ timeout });
        else if (input.selector) await page.locator(input.selector).first().waitFor({ timeout });
        else await page.waitForTimeout(input.durationMs ?? 0);
        return { ok: true };
      },
      back: async () =>
        mutate("Navigate browser back", async () => {
          await (await activePage(session)).goBack();
          return { action: "back", mode: "global", message: "Back" };
        }),
      home: async () =>
        mutate("Navigate browser home", async () => {
          const target = await readTarget(targetId);
          if (!target?.browser) throw new Error("browser target no longer exists");
          await (await activePage(session)).goto(target.browser.startUrl);
          return { action: "home", message: "Home" };
        }),
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
          return mutate("Write browser clipboard", async () => {
            await page.evaluate((text) => navigator.clipboard.writeText(text), input.text ?? "");
            return { action: "write", textLength: (input.text ?? "").length, message: "Written" };
          });
        }
        return { action: "read", text: await page.evaluate(() => navigator.clipboard.readText()) };
      },
      appState: async () => ({
        platform: "android" as const,
        package: "managed-browser",
        activity: (await activePage(session)).url(),
      }),
      keyboard: async (input?: { action?: "dismiss" | "enter" }) =>
        mutate("Press browser keyboard key", async () => {
          await (
            await activePage(session)
          ).keyboard.press(input?.action === "enter" ? "Enter" : "Escape");
          return { platform: "android", action: input?.action ?? "dismiss" };
        }),
      alert: async () => unsupported("native alerts"),
      appSwitcher: async () => unsupported("app switcher"),
      rotate: async () => unsupported("rotation"),
      prepare: async () => unsupported("native device runner"),
    },
    settings: { update: async () => unsupported("device settings") },
    observability: {
      perf: async () => {
        const page = await activePage(session);
        return redactSensitiveEvidenceValue(
          await page.evaluate(() => ({
            url: location.href,
            title: document.title,
            navigation: performance.getEntriesByType("navigation")[0]?.toJSON?.() ?? null,
            resources: performance.getEntriesByType("resource").length,
          })),
        );
      },
      logs: async (input?: Parameters<Device["observability"]["logs"]>[0]) => {
        if (input?.action === "start" || input?.action === "clear") {
          session.console = [];
          session.consoleDropped = 0;
        }
        return {
          entries: session.console.map((entry) => redactValue(redactSensitiveEvidenceValue(entry))),
          dropped: session.consoleDropped,
        };
      },
      network: async (input?: Parameters<Device["observability"]["network"]>[0]) => {
        if (input?.action === "log") {
          session.network = [];
          session.networkDropped = 0;
          const requested = input.include ?? "summary";
          const sensitive = requested === "body" || requested === "all";
          const consented = hasSensitiveEvidenceConsent(
            getEvidenceCollectionPolicy(),
            "network-body",
          );
          session.networkInclude =
            sensitive && (!consented || !visualEvidenceAllowed()) ? "summary" : requested;
          return {
            started: true,
            include: session.networkInclude,
            ...(sensitive && session.networkInclude === "summary"
              ? { message: "network bodies require explicit consent and an unredacted policy" }
              : {}),
          };
        }
        await Promise.allSettled(session.networkPending);
        return {
          entries: session.network.map((entry) => redactValue(redactSensitiveEvidenceValue(entry))),
          dropped: session.networkDropped,
        };
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
      record: async (input: { action: "start" | "stop"; path?: string }) =>
        mutate(`${input.action === "start" ? "Start" : "Stop"} browser recording`, async () => {
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
            attachBrowserEvidence(session, session.page);
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
          attachBrowserEvidence(session, session.page);
          if (returnUrl && returnUrl !== "about:blank") {
            await session.page.goto(returnUrl, { waitUntil: "domcontentloaded" });
          }
          session.recordingVideo = null;
          return { stopped: true, path: output };
        }),
    },
  };
  const device = createDeviceObservationFacade(api);
  bindBrowserLiveSession(device, session);
  return device;
}

export async function browserProofSessionForTarget(
  targetId: string,
  authenticationFixtureId?: string,
  unsignedLaneId?: string,
): Promise<BrowserSession> {
  const pending =
    sessions.get(
      browserSessionStoreKey({
        targetId,
        mode: "proof",
        authenticationFixtureId,
        unsignedLaneId,
      }),
    ) ??
    sessions.get(`proof:${targetId}`) ??
    sessions.get(
      browserSessionStoreKey({
        targetId,
        mode: "proof",
        reuseMatchingIdentity: true,
        authenticationFixtureId,
      }),
    );
  if (!pending) throw new Error(`managed browser session is not open: ${targetId}`);
  return pending;
}

export async function closeBrowserTarget(
  targetId?: string,
  options: {
    mode?: BrowserContextPurpose;
    authenticationFixtureId?: string;
    unsignedLaneId?: string;
  } = {},
): Promise<void> {
  const proofKey =
    options.mode === "proof" && targetId
      ? browserProofSessionKey({
          targetId,
          authenticationFixtureId: options.authenticationFixtureId,
          unsignedLaneId: options.unsignedLaneId,
        })
      : undefined;
  for (const [key, pending] of [...sessions.entries()].filter(([key]) =>
    proofKey ? key === proofKey : browserSessionBelongsToTarget(key, targetId, options.mode),
  )) {
    if (!pending) continue;
    sessions.delete(key);
    const session = await pending.catch(() => null);
    await session?.close().catch(() => undefined);
  }
}
