import {
  browserLaneElectronPartition,
  browserLaneTabSessionKey,
  compileBrowserEnvironment,
  electronGrokLabProductPathBlocker,
  isGrokLabLaneId,
  type BrowserCaseProfile,
} from "@relay/protocol";
import type { BrowserContext, Page } from "playwright-core";
import {
  browserAuthoringSessionKey,
  browserLiveSessionKey,
  browserRuntimeConfigurationDigest,
  browserSessionBelongsToTarget,
  liveBrowserSessionKeysToClose,
} from "./browser-execution-identity.js";
import { attachBrowserEvidence } from "./browser-target-evidence.js";
import { browserCaseProfileForTarget } from "./browser-case-profile-target.js";
import { activePage, browserSessions, sessionFor, type BrowserSession } from "./browser-target.js";
import { probeElectronGrokLabPartitionPresent } from "./electron-grok-lab-partition.js";
import { readTarget } from "./targets.js";

/** Server-owned Playwright handle; UI never receives it. */
export type BrowserAuthoringRuntime = Readonly<{
  sessionId: string;
  targetId: string;
  profile: BrowserCaseProfile;
  context: BrowserContext;
  activePage: () => Promise<Page>;
  setActivePage: (page: Page) => void;
  mutationVersion: () => number;
  markMutation: () => void;
}>;

export type OpenBrowserTargetResult = {
  targetId: string;
  name: string;
  url: string;
  sessionId: string;
  configurationDigest: string;
  laneId?: string;
  unsignedLaneId?: string;
  tabSessionKey?: string;
  electronPartition?: string;
};

function runtimeFromSession(targetId: string, session: BrowserSession): BrowserAuthoringRuntime {
  return {
    sessionId: session.sessionId,
    targetId,
    profile: session.profile,
    context: session.context,
    activePage: () => activePage(session),
    setActivePage: (page) => {
      session.page = page;
      attachBrowserEvidence(session, page);
    },
    mutationVersion: () => session.mutationVersion,
    markMutation: () => {
      session.mutationVersion += 1;
    },
  };
}

async function closeConflictingLiveBrowserSessions(
  targetId: string,
  keepKey: string,
): Promise<void> {
  const closing = liveBrowserSessionKeysToClose({
    keys: [...browserSessions.keys()],
    targetId,
    keepKey,
  });
  await Promise.all(
    closing.map(async (key) => {
      const pending = browserSessions.get(key);
      browserSessions.delete(key);
      await pending?.then((session) => session.close()).catch(() => undefined);
    }),
  );
}

/** Attach only to an existing runtime; never create or replace a session on lookup. */
export async function attachBrowserRuntime(
  targetId: string,
  sessionId: string,
): Promise<BrowserAuthoringRuntime> {
  for (const [key, pending] of browserSessions) {
    if (!browserSessionBelongsToTarget(key, targetId)) continue;
    const session = await pending;
    if (session.sessionId === sessionId) return runtimeFromSession(targetId, session);
  }
  throw new Error("This browser session is no longer available. Open the browser again.");
}

export async function openBrowserAuthoringRuntime(
  targetId: string,
  options: { headless: boolean; profile?: BrowserCaseProfile; unsignedLaneId?: string },
): Promise<BrowserAuthoringRuntime> {
  const session = await sessionFor(targetId, {
    mode: "authoring",
    headless: options.headless,
    profile: options.profile,
    recordVideo: true,
    ...(options.unsignedLaneId ? { unsignedLaneId: options.unsignedLaneId } : {}),
  });
  return runtimeFromSession(targetId, session);
}

/** Attach the in-app Browser Device to the same live identity as target.open. */
export async function openBrowserLiveRuntime(
  targetId: string,
  options: {
    headless: boolean;
    profile?: BrowserCaseProfile;
    authenticationFixtureId?: string;
    signedOut?: boolean;
    projectId?: string;
  },
): Promise<BrowserAuthoringRuntime> {
  const target = await readTarget(targetId);
  if (!target?.browser) throw new Error(`managed browser target not found: ${targetId}`);
  const baseProfile = options.profile ?? browserCaseProfileForTarget(target);
  const fixtureId = options.authenticationFixtureId?.trim();
  const { authenticationFixtureId: _ignored, ...unsigned } = baseProfile;
  const profile = fixtureId
    ? compileBrowserEnvironment({ ...baseProfile, authenticationFixtureId: fixtureId })
    : options.signedOut
      ? compileBrowserEnvironment(unsigned)
      : baseProfile;
  const session = await sessionFor(targetId, {
    mode: "proof",
    headless: options.headless,
    profile,
    reuseMatchingIdentity: true,
    ...(options.projectId ? { projectId: options.projectId } : {}),
  });
  return runtimeFromSession(targetId, session);
}

/** Opens a Relay-owned browser. Lane id is the cookie jar for Chrome and in-app tabs. */
export async function openBrowserTarget(
  targetId: string,
  options: {
    projectId?: string;
    laneId?: string;
    unsignedLaneId?: string;
    authenticationFixtureId?: string;
    signedOut?: true;
    presentation?: "embedded" | "external";
  } = {},
): Promise<OpenBrowserTargetResult> {
  const target = await readTarget(targetId);
  if (!target?.browser) throw new Error(`managed browser target not found: ${targetId}`);
  const baseProfile = browserCaseProfileForTarget(target);
  const fixtureId = options.authenticationFixtureId?.trim();
  const unsignedLaneId = options.unsignedLaneId?.trim();
  const laneId = options.laneId?.trim() || unsignedLaneId;
  const electronGrokLabPartitionPresent = probeElectronGrokLabPartitionPresent();
  const electronBlocker = electronGrokLabProductPathBlocker({
    laneId,
    presentation: options.presentation,
    electronGrokLabPartitionPresent,
  });
  if (electronBlocker) throw new Error(electronBlocker);
  const accountBound = Boolean(fixtureId || options.signedOut);
  const keepKey = accountBound
    ? browserLiveSessionKey({
        targetId,
        authenticationFixtureId: fixtureId,
        signedOut: options.signedOut,
      })
    : browserAuthoringSessionKey({ targetId, unsignedLaneId });
  if (accountBound) {
    await closeConflictingLiveBrowserSessions(targetId, keepKey);
  }
  const { authenticationFixtureId: _ignored, ...unsigned } = baseProfile;
  const profile = fixtureId
    ? compileBrowserEnvironment({ ...baseProfile, authenticationFixtureId: fixtureId })
    : options.signedOut
      ? compileBrowserEnvironment(unsigned)
      : baseProfile;
  const session = await sessionFor(targetId, {
    headless: options.presentation === "embedded",
    requirePresentationMatch: true,
    mode: accountBound ? "proof" : "authoring",
    profile,
    ...(unsignedLaneId ? { unsignedLaneId } : {}),
    ...(accountBound ? { reuseMatchingIdentity: true, projectId: options.projectId } : {}),
  });
  const page = await activePage(session);
  if (page.url() === "about:blank") {
    await page.goto(target.browser.startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }
  if (options.presentation !== "embedded") await page.bringToFront();
  return {
    targetId,
    name: target.name,
    url: page.url(),
    sessionId: session.sessionId,
    configurationDigest: browserRuntimeConfigurationDigest({
      targetId,
      ...session.profile,
      signedOut: options.signedOut,
    }),
    ...(laneId
      ? {
          laneId,
          tabSessionKey: browserLaneTabSessionKey({
            laneId,
            targetId,
            authenticationFixtureId: fixtureId,
          }),
          ...(!isGrokLabLaneId(laneId) || electronGrokLabPartitionPresent
            ? { electronPartition: browserLaneElectronPartition(laneId) }
            : {}),
        }
      : {}),
    ...(unsignedLaneId ? { unsignedLaneId } : {}),
  };
}

/** Persistent authoring storage state after an explicit human sign-in. */
export async function captureBrowserAuthenticationStorageState(
  targetId: string,
  unsignedLaneId?: string,
): Promise<unknown> {
  const key = browserAuthoringSessionKey({ targetId, unsignedLaneId });
  const pending = browserSessions.get(key) ?? browserSessions.get(`authoring:${targetId}`);
  if (!pending) {
    throw new Error("Open the managed browser and complete sign-in before saving authentication");
  }
  const session = await pending;
  return session.context.storageState({ indexedDB: true });
}
