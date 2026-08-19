/**
 * Discovery turn loop: "here is the screen" → "do this" → "here again".
 * Agents should not invent crawl strategy — they pick from options.
 */
import type {
  DiscoveryControl,
  DiscoveryDecisionProvenance,
  ObservedScreen,
  ObservedTransition,
} from "@relay/protocol";
import { describeTargetUi } from "./explore.js";
import { landDiscoveryOnAppMap } from "./discovery-land.js";
import {
  controlToInteractInput,
  runDiscoveryCapture,
  runDiscoveryInteract,
} from "./discovery-interact.js";
import {
  discoveryControls,
  readDiscoverySession,
  replaceDiscoveryScreenControls,
  suggestDiscoveryControl,
} from "./discovery.js";
import { discoveryFingerprintsChanged, DiscoveryVerifyError } from "./discovery-verify.js";
import { readAppMap } from "./collaboration.js";
import type { InteractInput } from "./workspace.js";
import { captureSnapshot } from "./workspace.js";

export type DiscoveryHereOption = DiscoveryControl & {
  /** True when this session already opened this control from the current screen. */
  opened: boolean;
};

export type DiscoveryHere = {
  screen: Pick<ObservedScreen, "id" | "title" | "fingerprint" | "screenshotPath" | "capturedAt"> & {
    controlCount: number;
  };
  options: DiscoveryHereOption[];
  suggestion: DiscoveryControl | null;
  foregroundApp?: string;
  canBack: boolean;
  map?: { id: string; screens: number; connections: number };
};

function openedTargets(
  session: NonNullable<Awaited<ReturnType<typeof readDiscoverySession>>>,
): Set<string> {
  const out = new Set<string>();
  for (const transition of session.transitions) {
    if (!transition.target || !transition.changedScreen) continue;
    out.add(`${transition.fromScreenId}:${JSON.stringify(transition.target)}`);
  }
  return out;
}

async function mapSummary(
  session: NonNullable<Awaited<ReturnType<typeof readDiscoverySession>>>,
): Promise<DiscoveryHere["map"]> {
  const mapId = session.agent?.appMapId;
  if (!mapId) return undefined;
  const map = await readAppMap(session.projectId ?? "default", mapId);
  if (!map) return undefined;
  return {
    id: map.id,
    screens: Object.keys(map.screens).length,
    connections: Object.keys(map.connections).length,
  };
}

function buildHere(
  session: NonNullable<Awaited<ReturnType<typeof readDiscoverySession>>>,
  screen: ObservedScreen,
  foregroundApp: string | undefined,
  map: DiscoveryHere["map"],
): DiscoveryHere {
  const opened = openedTargets(session);
  const options: DiscoveryHereOption[] = (screen.controls ?? []).map((control) => ({
    ...control,
    opened: opened.has(`${screen.id}:${JSON.stringify(control.target)}`),
  }));
  const suggestion = suggestDiscoveryControl(session)?.control ?? null;
  return {
    screen: {
      id: screen.id,
      title: screen.title,
      fingerprint: screen.fingerprint,
      ...(screen.screenshotPath ? { screenshotPath: screen.screenshotPath } : {}),
      capturedAt: screen.capturedAt,
      controlCount: options.length,
    },
    options,
    suggestion,
    ...(foregroundApp ? { foregroundApp } : {}),
    canBack: true,
    ...(map ? { map } : {}),
  };
}

/** Refresh the live screen, land it on the App Map, return options. */
export async function runDiscoveryHere(sessionId: string): Promise<DiscoveryHere> {
  const session = await readDiscoverySession(sessionId);
  if (!session) throw new Error("discovery session not found");
  if (session.status !== "running" && session.status !== "draft") {
    throw new Error("discovery session must be draft or running");
  }

  const captured = await runDiscoveryCapture(sessionId);
  const snap = captured.snapshot;
  const controls = discoveryControls(snap.nodes);
  await replaceDiscoveryScreenControls(sessionId, captured.screen.id, controls);
  try {
    await landDiscoveryOnAppMap(sessionId);
  } catch {
    /* landing is best-effort for the turn view */
  }

  const latest = (await readDiscoverySession(sessionId))!;
  const screen = latest.screens.find((item) => item.id === captured.screen.id) ?? captured.screen;
  const foregroundApp = (await describeTargetUi(session.targetId)).foregroundApp ?? undefined;
  return buildHere(latest, screen, foregroundApp, await mapSummary(latest));
}

/** Act on an option (or raw interaction), verify settle, return a fresh here. */
export async function runDiscoveryDo(input: {
  sessionId: string;
  /** Prefer a control id from the last here.options list. */
  controlId?: string;
  interaction?: InteractInput;
  decision?: DiscoveryDecisionProvenance;
}): Promise<{
  transition: ObservedTransition;
  /** True when before/after recorded as different ObservedScreen ids. */
  changedIdentity: boolean;
  /** True when the settled live fingerprint differs from before (verify). */
  changed: boolean;
  before: ObservedScreen;
  after: ObservedScreen;
  here: DiscoveryHere;
}> {
  const session = await readDiscoverySession(input.sessionId);
  if (!session) throw new Error("discovery session not found");
  if (session.status !== "running") {
    throw new Error("Start or resume this Discovery Map before interacting");
  }

  let interaction = input.interaction;
  if (!interaction && input.controlId) {
    const current = session.currentScreenId
      ? session.screens.find((screen) => screen.id === session.currentScreenId)
      : undefined;
    const control = current?.controls?.find((item) => item.id === input.controlId);
    if (!control) throw new Error(`Unknown control ${input.controlId} on the current screen`);
    interaction = controlToInteractInput(control);
  }
  if (!interaction) throw new Error("controlId or interaction is required");

  // Turn path never relaunches — interact throws structured errors on policy/device failure.
  const result = await runDiscoveryInteract({
    sessionId: input.sessionId,
    interaction,
    ...(input.decision ? { decision: input.decision } : {}),
  });

  // Always re-capture a settled here — do not trust interact's after.screen alone
  // (animations / title drift). Failures surface; never silent openApp/relaunch.
  let here: DiscoveryHere;
  try {
    here = await runDiscoveryHere(input.sessionId);
  } catch (error) {
    if (error instanceof DiscoveryVerifyError) throw error;
    throw new DiscoveryVerifyError(
      "verify_failed",
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }

  const refreshed = (await readDiscoverySession(input.sessionId))!;
  const after =
    refreshed.screens.find((item) => item.id === here.screen.id) ??
    refreshed.screens.find((item) => item.id === result.after.id) ??
    result.after;
  const changed =
    discoveryFingerprintsChanged(result.before.fingerprint, here.screen.fingerprint) ||
    result.changedIdentity;

  // Best-effort land for the edge when identity already changed inside interact.
  if (result.changedIdentity) {
    try {
      await landDiscoveryOnAppMap(input.sessionId, result.transition.id);
    } catch {
      /* already landed inside interact when identity changed */
    }
  }

  return {
    transition: result.transition,
    changedIdentity: result.changedIdentity,
    changed,
    before: result.before,
    after,
    here,
  };
}

/** When options are stale (drawer opened outside discovery), refresh from a live snapshot only. */
export async function refreshDiscoveryHereOptions(sessionId: string): Promise<DiscoveryHere> {
  const session = await readDiscoverySession(sessionId);
  if (!session?.currentScreenId) return runDiscoveryHere(sessionId);
  const snap = await captureSnapshot({ serial: session.targetId });
  const controls = discoveryControls(snap.nodes);
  await replaceDiscoveryScreenControls(sessionId, session.currentScreenId, controls);
  const latest = (await readDiscoverySession(sessionId))!;
  const screen = latest.screens.find((item) => item.id === session.currentScreenId);
  if (!screen) return runDiscoveryHere(sessionId);
  const foregroundApp = (await describeTargetUi(session.targetId)).foregroundApp ?? undefined;
  return buildHere(latest, screen, foregroundApp, await mapSummary(latest));
}
