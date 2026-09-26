import {
  browserCaseProfileForTarget,
  createDeviceForTarget,
  getBrowserDevice,
  readTarget,
  runWithTargetContext,
  type Device,
} from "@relay/core";
import {
  compileBrowserEnvironment,
  type AuthoringSession,
  type AuthoringTarget,
} from "@relay/protocol";
import { fixtureCaptureReadiness } from "./authoring-fixture-ready.js";

export type AuthoringDeviceOptions = {
  authenticationFixtureId?: string;
  projectId?: string;
  headless?: boolean;
};

const FIXTURE_HYDRATE_TIMEOUT_MS = 30_000;
/** A fixture is immutable storage state: once it hydrated a signed-in page,
 * consecutive captures in the same workflow (teach hops, run steps minutes
 * apart) need not re-prove it — and must not, because pages legitimately
 * past the login screen no longer carry a signed-in-home marker. The memo
 * is short-lived so a fixture whose app-side session later expires still
 * fails closed on the next workflow. */
const FIXTURE_HYDRATION_MEMO_MS = 5 * 60_000;
const fixtureHydratedSessions = new Set<string>();
const fixtureHydrationMemo = new Map<string, number>();

async function ensureFixtureCaptureHydrated(
  sessionId: string,
  device: Device,
  memoKey?: string,
): Promise<void> {
  if (fixtureHydratedSessions.has(sessionId)) return;
  if (memoKey) {
    const memoizedAt = fixtureHydrationMemo.get(memoKey);
    if (memoizedAt !== undefined && Date.now() - memoizedAt < FIXTURE_HYDRATION_MEMO_MS) {
      fixtureHydratedSessions.add(sessionId);
      return;
    }
  }
  const started = performance.now();
  while (performance.now() - started < FIXTURE_HYDRATE_TIMEOUT_MS) {
    const snapshot = await device.capture.snapshot();
    const labels = (snapshot.nodes ?? []).map((node) => node.label ?? "");
    const state = fixtureCaptureReadiness(labels);
    if (state === "ready") {
      fixtureHydratedSessions.add(sessionId);
      if (memoKey) fixtureHydrationMemo.set(memoKey, Date.now());
      return;
    }
    if (state === "signed-out") {
      throw new Error(
        "The account fixture opened signed-out grok.com. Do not capture it as signed-in home.",
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    "The account fixture did not hydrate a signed-in home with Library before capture.",
  );
}

export function targetContext(target: AuthoringTarget) {
  return target.kind === "browser"
    ? ({ kind: "browser", platform: "browser", targetId: target.targetId } as const)
    : ({ kind: "device", platform: target.platform, serial: target.targetId } as const);
}

/** Proof-mode overlay for a saved fixture. Never writes the fixture onto the
 * managed browser's default environment. */
export async function deviceFor(
  session: AuthoringSession,
  options: AuthoringDeviceOptions = {},
): Promise<Device> {
  const context = targetContext(session.target);
  return runWithTargetContext(context, async () => {
    if (session.target.kind !== "browser") {
      return createDeviceForTarget(context);
    }
    // A capture can override the login; otherwise use the recording's own.
    const captureFixtureId = options.authenticationFixtureId?.trim();
    const recordingFixtureId = session.target.authenticationFixtureId?.trim();
    const fixtureId = captureFixtureId || recordingFixtureId;
    if (!fixtureId) return getBrowserDevice(session.target.targetId);
    const projectId = options.projectId?.trim() || session.projectId;
    if (!projectId) {
      throw new Error("A browser account fixture capture needs a project id");
    }
    const target = await readTarget(session.target.targetId);
    if (!target?.browser) {
      throw new Error(`managed browser target not found: ${session.target.targetId}`);
    }
    const device = await getBrowserDevice(session.target.targetId, {
      mode: "proof",
      headless: options.headless ?? true,
      recordVideo: false,
      projectId,
      // Recording as a saved login drives the same signed-in browser the live
      // view shows, so what the person clicks is what gets recorded.
      ...(captureFixtureId ? {} : { reuseMatchingIdentity: true }),
      profile: compileBrowserEnvironment({
        ...browserCaseProfileForTarget(target),
        authenticationFixtureId: fixtureId,
      }),
    });
    // Proof captures confirm the saved login hydrated before capturing; an
    // ordinary recording shows the person the page and lets them see it.
    if (captureFixtureId) {
      await ensureFixtureCaptureHydrated(
        session.id,
        device,
        `${session.target.targetId}#${fixtureId}`,
      );
    }
    return device;
  });
}
