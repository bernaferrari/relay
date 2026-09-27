/** Framework-neutral captured-app player projection (delivery plan §6).
 *
 * Dependency direction is one-way: existing immutable evidence (persisted
 * runs) plus the reviewed App Map project into a player manifest. Reports,
 * comparison, and coverage compose ON the manifest; the player never needs
 * them. Nothing here touches a device adapter — the player is read-only
 * navigation over recorded evidence.
 *
 * Identity rules (plan §6.2–§6.5):
 * - A logical state is a map screen bound by the reviewed test path, not a
 *   screenshot similarity class. Captions are display text, never identity.
 * - A capture binds to (state, variant) through the exact chain
 *   capture-review artifact → checkpoint step → connection → destination
 *   screen, and its slot configuration is the variant key.
 * - A variant is the exact capture configuration. Missing stays missing:
 *   state×variant pairs without an exact capture are emitted as `missing`
 *   and can never be substituted by another variant's image.
 * - A connection is `recorded` when an included run produced the destination
 *   capture for it; otherwise it is an authored link that enables navigation
 *   without proving the transition occurred. Suggested links never enter a
 *   manifest until approved as map data.
 * - Findings are review decisions bound to exact captures (frame path plus
 *   image digest), scoped per run. */

import {
  captureReviewIdMatchesFrame,
  playerVariantIdForConfiguration,
  type AppMap,
} from "@relay/protocol";
import type { PersistedRun } from "./runs.js";

export const PLAYER_MANIFEST_SCHEMA_VERSION = 1;

export type PlayerVariantKey = string;

export type PlayerState = {
  /** Map screen id — the stable logical-state identity. */
  id: string;
  title: string;
};

export type PlayerVariant = {
  /** Stable key from the exact capture-review configuration. */
  id: PlayerVariantKey;
  /** Human-readable configuration summary (display text, not identity). */
  label: string;
};

export type PlayerCapture = {
  /** `${runId}:${framePath}:${imageSha256}` — exact artifact identity. */
  id: string;
  stateId: string;
  variantId: PlayerVariantKey;
  runId: string;
  framePath: string;
  imageSha256: string;
  slotId: string;
  /** Display text only (plan §6.2: captions are not identity). */
  caption: string;
  capturedAt: number;
  /** Screenshot pixel size when known; hotspot transforms need it. */
  viewport?: { width: number; height: number };
};

export type PlayerHotspot = {
  connectionId: string;
  /** Normalized (0–1) point/rect in the SOURCE capture's viewport. The UI
   * transforms against the displayed image; §6.4 forbids reusing source
   * pixels on a differently-scaled variant. */
  point?: { x: number; y: number };
  rect?: { x: number; y: number; width: number; height: number };
  /** Accessible recorded-action list used when no reviewed geometry exists
   * (plan §6.4: missing geometry falls back to actions, never invented hit
   * regions). */
  actions: readonly { kind: string; label?: string }[];
};

export type PlayerConnection = {
  id: string;
  fromStateId: string;
  toStateId: string;
  /** `recorded` was observed. `authored` is a human link. `suggested` was proposed, not executed. */
  kind: "recorded" | "authored" | "suggested";
  label: string;
  /** Present only for recorded connections. */
  provenance?: { runId: string; captureId?: string };
  hotspot?: PlayerHotspot;
};

export type PlayerFinding = {
  /** `${runId}:${captureId}` — one exact capture. */
  id: string;
  runId: string;
  captureId: string;
  action: string;
  note?: string;
  decidedAt: number;
  decidedBy?: string;
  reviewVersion?: number;
};

export type PlayerMissing = {
  stateId: string;
  variantId: PlayerVariantKey;
  /** Honest reason, e.g. which run lacked the destination capture. */
  reason: string;
};

export type PlayerManifest = {
  schemaVersion: typeof PLAYER_MANIFEST_SCHEMA_VERSION;
  pinned: {
    appMapId: string;
    appMapRevision: number;
    runIds: readonly string[];
    generatedAt: number;
  };
  entryStateId?: string;
  states: readonly PlayerState[];
  variants: readonly PlayerVariant[];
  captures: readonly PlayerCapture[];
  connections: readonly PlayerConnection[];
  findings: readonly PlayerFinding[];
  missing: readonly PlayerMissing[];
};

type CaptureReviewArtifactData = {
  framePath?: unknown;
  imageSha256?: unknown;
  slotId?: unknown;
  caption?: unknown;
  stepId?: unknown;
  requirementId?: unknown;
  checkpointId?: unknown;
  capturedAt?: unknown;
  configuration?: unknown;
  observed?: { laneId?: unknown; profileId?: unknown } | null;
};

/** The variant identity combines the declared configuration with the
 * OBSERVED lane/profile. A compiled plan may carry a stale route label
 * (two different lanes once both declared browser=grok-com); observation
 * is the truth that keeps two configurations from collapsing into one
 * substitutable variant (plan §6.5). */
function variantKeyOf(data: {
  configuration?: unknown;
  observed?: { laneId?: unknown; profileId?: unknown } | null;
}): { id: PlayerVariantKey; label: string } {
  const declared = configurationKey(data.configuration);
  const observedLane =
    typeof data.observed?.laneId === "string" && data.observed.laneId
      ? data.observed.laneId
      : undefined;
  const observedProfile =
    typeof data.observed?.profileId === "string" && data.observed.profileId
      ? data.observed.profileId
      : undefined;
  if (!observedLane && !observedProfile) {
    return { id: declared, label: configurationLabel(data.configuration) };
  }
  const observedParts = [observedLane, observedProfile].filter(Boolean).join(" · ");
  return { id: `${declared} @ ${observedParts}`, label: `${declared} @ ${observedParts}` };
}

function configurationKey(configuration: unknown): PlayerVariantKey {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
    return "unconfigured";
  }
  return (
    playerVariantIdForConfiguration(configuration as Record<string, unknown>) ?? "unconfigured"
  );
}

function configurationLabel(configuration: unknown): string {
  const key = configurationKey(configuration);
  return key === "unconfigured" ? "Default configuration" : key;
}

function readCaptureReviewData(artifact: { kind: string; data?: unknown; capturedAt?: unknown }):
  | {
      data: CaptureReviewArtifactData & { framePath: string; imageSha256: string };
      capturedAt: number;
    }
  | undefined {
  if (artifact.kind !== "capture-review") return undefined;
  const raw = artifact.data;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const data = raw as CaptureReviewArtifactData;
  if (typeof data.framePath !== "string" || typeof data.imageSha256 !== "string") return undefined;
  const capturedAt =
    typeof data.capturedAt === "number"
      ? data.capturedAt
      : typeof artifact.capturedAt === "number"
        ? artifact.capturedAt
        : 0;
  // Guarded above: framePath and imageSha256 passed the typeof-string checks.
  const narrowed = data as CaptureReviewArtifactData & { framePath: string; imageSha256: string };
  return { data: narrowed, capturedAt };
}

type MapTestStep = {
  id?: unknown;
  capture?: unknown;
  binding?: { connectionIds?: unknown } | null;
};

type MapConnection = {
  id: string;
  fromScreenId: string;
  destination?: { kind?: string; screenId?: unknown };
  label?: string;
  state?: string;
  provenance?: { source?: string };
  actions?: readonly { kind?: string; label?: string; target?: unknown }[];
  sourceAnchor?: {
    point?: { x?: unknown; y?: unknown };
    rect?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  };
};

function mapConnectionsOf(map: AppMap): MapConnection[] {
  return Object.values(map.connections ?? {}) as unknown as MapConnection[];
}

function mapTestsOf(map: AppMap): Record<string, { steps?: MapTestStep[] }> {
  return (map.tests ?? {}) as unknown as Record<string, { steps?: MapTestStep[] }>;
}

function screenTitleOf(map: AppMap, screenId: string): string {
  const screen = (map.screens ?? {})[screenId] as { title?: string } | undefined;
  return screen?.title ?? screenId;
}

/** Destination screen of a test step: step → binding connection → screen.
 * This is the identity chain; intent labels are never used for matching. */
function stepDestinationScreen(
  connections: MapConnection[],
  step: MapTestStep,
): string | undefined {
  const ids = step.binding?.connectionIds;
  if (!Array.isArray(ids)) return undefined;
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const connection = connections.find((candidate) => candidate.id === id);
    const destination = connection?.destination;
    if (destination?.kind === "screen" && typeof destination.screenId === "string") {
      return destination.screenId;
    }
  }
  return undefined;
}

type CompiledRecipe = {
  steps?: readonly {
    id?: unknown;
    kind?: unknown;
    check?: {
      transitionDependencies?: readonly {
        destination?: { kind?: unknown; screenId?: unknown };
      }[];
    };
  }[];
};

/** checkpoint step id → destination screen, from the run's compiled plan.
 * Module steps establish the destination screen; subsequent screenshot steps
 * of the same module inherit it structurally (no id parsing, no captions). */
function compiledPlanDestinationScreens(run: PersistedRun): Map<string, string> {
  const screens = new Map<string, string>();
  for (const artifact of run.artifacts ?? []) {
    if (artifact.kind !== "app-map-test-plan") continue;
    const data = artifact.data;
    if (data === null || typeof data !== "object" || Array.isArray(data)) continue;
    const recipes = (data as { recipes?: unknown }).recipes;
    if (recipes === null || typeof recipes !== "object" || Array.isArray(recipes)) continue;
    for (const recipe of Object.values(recipes as Record<string, CompiledRecipe>)) {
      let current: string | undefined;
      for (const step of recipe.steps ?? []) {
        if (typeof step.id !== "string") continue;
        if (step.kind === "module") {
          const dependencies = step.check?.transitionDependencies ?? [];
          current = undefined;
          for (const dependency of dependencies) {
            const destination = dependency.destination;
            if (destination?.kind === "screen" && typeof destination.screenId === "string") {
              current = destination.screenId;
              break;
            }
          }
        } else if (current !== undefined) {
          screens.set(step.id, current);
        }
      }
    }
  }
  return screens;
}

/** Fallback for map-authored fixtures: map test step → connection → screen. */
function mapTestStepScreen(
  tests: Record<string, { steps?: MapTestStep[] }>,
  connections: MapConnection[],
  checkpointId: string,
): string | undefined {
  for (const test of Object.values(tests)) {
    const step = (test.steps ?? []).find((candidate) => candidate.id === checkpointId);
    if (step) return stepDestinationScreen(connections, step);
  }
  return undefined;
}

function connectionHotspot(connection: MapConnection): PlayerHotspot | undefined {
  const actions = (connection.actions ?? []).map((action) => ({
    kind: typeof action.kind === "string" ? action.kind : "action",
    ...(typeof action.label === "string" ? { label: action.label } : {}),
  }));
  const anchor = connection.sourceAnchor;
  const point =
    anchor?.point !== undefined &&
    typeof anchor.point.x === "number" &&
    typeof anchor.point.y === "number"
      ? { x: anchor.point.x, y: anchor.point.y }
      : undefined;
  const rawRect = anchor?.rect;
  const rect =
    rawRect !== undefined &&
    typeof rawRect.x === "number" &&
    typeof rawRect.y === "number" &&
    typeof rawRect.width === "number" &&
    typeof rawRect.height === "number"
      ? { x: rawRect.x, y: rawRect.y, width: rawRect.width, height: rawRect.height }
      : undefined;
  if (!point && !rect) {
    // §6.4: no invented hit regions — the recorded-action list is the
    // accessible fallback when reviewed geometry is absent.
    return actions.length > 0 ? { connectionId: connection.id, actions } : undefined;
  }
  return {
    connectionId: connection.id,
    ...(point ? { point } : {}),
    ...(rect ? { rect } : {}),
    actions,
  };
}

export function buildPlayerManifest(input: {
  map: AppMap;
  runs: readonly PersistedRun[];
  now?: number;
}): PlayerManifest {
  const { map, runs } = input;
  const now = input.now ?? 0;
  const connections = mapConnectionsOf(map);
  const tests = mapTestsOf(map);

  // 1) Collect exact captures from run evidence, keeping the identity chain.
  const captures: PlayerCapture[] = [];
  const observedConnection = new Map<string, Map<string, PlayerCapture>>();
  const captureByStateVariant = new Map<string, PlayerCapture>();
  const variantKeys = new Map<PlayerVariantKey, PlayerVariant>();
  const statesById = new Map<string, PlayerState>();
  const testIdsSeen = new Set<string>();

  for (const run of runs) {
    // Preferred identity chain: the run's compiled plan carries each
    // checkpoint step's destination screen (module step → transition
    // dependency → screen), independent of map test step naming.
    const planScreens = compiledPlanDestinationScreens(run);
    for (const artifact of run.artifacts ?? []) {
      const review = readCaptureReviewData(artifact);
      if (!review) continue;
      const { data } = review;
      const testId = typeof data.requirementId === "string" ? data.requirementId : undefined;
      const checkpointId =
        typeof data.checkpointId === "string"
          ? data.checkpointId
          : typeof data.stepId === "string"
            ? data.stepId
            : undefined;
      if (!testId || !checkpointId) continue;
      testIdsSeen.add(testId);
      const screenId =
        planScreens.get(checkpointId) ?? mapTestStepScreen(tests, connections, checkpointId);
      if (!screenId) continue;
      if (!statesById.has(screenId)) {
        statesById.set(screenId, { id: screenId, title: screenTitleOf(map, screenId) });
      }
      const variant = variantKeyOf(data);
      const variantKey = variant.id;
      if (!variantKeys.has(variantKey)) {
        variantKeys.set(variantKey, variant);
      }
      const capture: PlayerCapture = {
        id: `${run.id}:${data.framePath}:${data.imageSha256}`,
        stateId: screenId,
        variantId: variantKey,
        runId: run.id,
        framePath: data.framePath,
        imageSha256: data.imageSha256,
        slotId: typeof data.slotId === "string" ? data.slotId : "",
        caption: typeof data.caption === "string" ? data.caption : "",
        capturedAt: review.capturedAt,
      };
      captures.push(capture);
      const boundIds = tests[testId]?.steps?.find((step) => step.id === checkpointId)?.binding
        ?.connectionIds;
      if (Array.isArray(boundIds)) {
        for (const connectionId of boundIds) {
          if (typeof connectionId !== "string") continue;
          const byVariant =
            observedConnection.get(connectionId) ?? new Map<string, PlayerCapture>();
          observedConnection.set(connectionId, byVariant);
          const previous = byVariant.get(capture.variantId);
          if (!previous || previous.capturedAt <= capture.capturedAt) {
            byVariant.set(capture.variantId, capture);
          }
        }
      }
      const slotKey = `${screenId}\u{0}${variantKey}`;
      // Keep the newest capture per (state, variant); earlier attempts stay
      // in `captures` but the resolver never falls back across variants.
      const existing = captureByStateVariant.get(slotKey);
      if (!existing || existing.capturedAt <= capture.capturedAt) {
        captureByStateVariant.set(slotKey, capture);
      }
    }
  }

  // 2) Connections between player states. A connection is recorded when an
  // included run produced the destination capture for its state+variant.
  const playerConnections: PlayerConnection[] = [];
  for (const connection of connections) {
    const destination = connection.destination;
    if (destination?.kind !== "screen" || typeof destination.screenId !== "string") continue;
    const fromScreenId = connection.fromScreenId;
    const toScreenId = destination.screenId;
    if (!statesById.has(fromScreenId) && !statesById.has(toScreenId)) continue;
    if (!statesById.has(fromScreenId)) {
      statesById.set(fromScreenId, { id: fromScreenId, title: screenTitleOf(map, fromScreenId) });
    }
    if (!statesById.has(toScreenId)) {
      statesById.set(toScreenId, { id: toScreenId, title: screenTitleOf(map, toScreenId) });
    }
    const observed = [...(observedConnection.get(connection.id)?.values() ?? [])];
    const source = connection.provenance?.source;
    const kind =
      source === "discovery"
        ? "suggested"
        : source === "manual"
          ? "authored"
          : source === "recording" || observed.length > 0
            ? "recorded"
            : "authored";
    const recordedCaptures = kind === "recorded" && observed.length > 0 ? observed : [undefined];
    for (const destinationCapture of recordedCaptures) {
      playerConnections.push({
        id: connection.id,
        fromStateId: fromScreenId,
        toStateId: toScreenId,
        kind,
        label: typeof connection.label === "string" ? connection.label : "Open",
        ...(destinationCapture
          ? { provenance: { runId: destinationCapture.runId, captureId: destinationCapture.id } }
          : {}),
        ...(connectionHotspot(connection) ? { hotspot: connectionHotspot(connection)! } : {}),
      });
    }
  }

  // 3) Missing state×variant pairs: every state referenced by the included
  // tests' capture steps must exist per variant; absent = missing, never
  // substituted (plan §6.5).
  const missing: PlayerMissing[] = [];
  const referencedStates = new Set<string>();
  for (const testId of testIdsSeen) {
    for (const step of tests[testId]?.steps ?? []) {
      if (step.capture !== true) continue;
      const screenId = stepDestinationScreen(connections, step);
      if (screenId) referencedStates.add(screenId);
    }
  }
  for (const stateId of referencedStates) {
    for (const variant of variantKeys.values()) {
      const slotKey = `${stateId}\u{0}${variant.id}`;
      if (!captureByStateVariant.has(slotKey)) {
        missing.push({
          stateId,
          variantId: variant.id,
          reason: `No capture for this state in configuration ${variant.label}; missing stays missing.`,
        });
      }
    }
  }

  // 4) Findings: review decisions bound to exact captures of these runs.
  const findings: PlayerFinding[] = [];
  for (const run of runs) {
    for (const decision of run.captureReviews ?? []) {
      const captureId = decision.captureId;
      const capture = captures.find((candidate) => {
        if (candidate.runId !== run.id) return false;
        return captureReviewIdMatchesFrame(captureId, candidate.framePath, candidate.imageSha256);
      });
      if (!capture) continue;
      findings.push({
        id: `${run.id}:${captureId}`,
        runId: run.id,
        captureId,
        action: decision.action,
        ...(decision.note !== undefined ? { note: decision.note } : {}),
        decidedAt: decision.decidedAt,
        ...(decision.decidedBy !== undefined ? { decidedBy: decision.decidedBy.id } : {}),
        ...(decision.reviewVersion !== undefined ? { reviewVersion: decision.reviewVersion } : {}),
      });
    }
  }

  const stateList = [...statesById.values()];
  return {
    schemaVersion: PLAYER_MANIFEST_SCHEMA_VERSION,
    pinned: {
      appMapId: map.id,
      appMapRevision: map.revision,
      runIds: runs.map((run) => run.id),
      generatedAt: now,
    },
    ...(stateList.length > 0 ? { entryStateId: stateList[0]!.id } : {}),
    states: stateList,
    variants: [...variantKeys.values()],
    captures,
    connections: playerConnections,
    findings,
    missing,
  };
}

/** Resolve the exact capture for a state under a variant. Substitution is
 * structurally impossible: the key includes the variant, and a miss returns
 * `undefined` so callers render an explicit missing state (plan §6.5). */
export function resolvePlayerCapture(
  manifest: PlayerManifest,
  stateId: string,
  variantId: PlayerVariantKey,
): PlayerCapture | undefined {
  let newest: PlayerCapture | undefined;
  for (const capture of manifest.captures) {
    if (capture.stateId !== stateId || capture.variantId !== variantId) continue;
    if (!newest || capture.capturedAt > newest.capturedAt) newest = capture;
  }
  return newest;
}
