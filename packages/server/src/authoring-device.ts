import {
  browserCaseProfileForTarget,
  createDeviceForTarget,
  getBrowserDevice,
  readTarget,
  runWithTargetContext,
  type Device,
} from "@relay/core";
import { compileBrowserEnvironment, type AuthoringSession, type AuthoringTarget } from "@relay/protocol";
import { fixtureCaptureReadiness } from "./authoring-fixture-ready.js";

export type AuthoringDeviceOptions = {
  authenticationFixtureId?: string;
  projectId?: string;
  headless?: boolean;
};

const FIXTURE_HYDRATE_TIMEOUT_MS = 30_000;
const fixtureHydratedSessions = new Set<string>();

async function ensureFixtureCaptureHydrated(sessionId: string, device: Device): Promise<void> {
  if (fixtureHydratedSessions.has(sessionId)) return;
  const started = performance.now();
  while (performance.now() - started < FIXTURE_HYDRATE_TIMEOUT_MS) {
    const snapshot = await device.capture.snapshot();
    const labels = (snapshot.nodes ?? []).map((node) => node.label ?? "");
    const state = fixtureCaptureReadiness(labels);
    if (state === "ready") {
      fixtureHydratedSessions.add(sessionId);
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
    const fixtureId = options.authenticationFixtureId?.trim();
    if (!fixtureId) return getBrowserDevice(session.target.targetId);
    const projectId = options.projectId?.trim();
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
      profile: compileBrowserEnvironment({
        ...browserCaseProfileForTarget(target),
        authenticationFixtureId: fixtureId,
      }),
    });
    await ensureFixtureCaptureHydrated(session.id, device);
    return device;
  });
}
