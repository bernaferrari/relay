import type {
  AuthoringAction,
  AuthoringEvidence,
  AuthoringInteraction,
  AuthoringSession,
  AppMap,
  RecipeStep,
} from "@relay/protocol";
import type {
  AuthoringObservationRequest,
  CapturedAuthoringObservation,
} from "./authoring-observation-capture.js";
import { currentRevision } from "./authoring-session-screen-proof.js";
import { hasCurrentAuthoringSemantics } from "./authoring-observation-proof.js";
import { observedIosApplication } from "./recorded-entrance-proof.js";
import { resolveIosLaunchBundleId } from "./ios-app-launch.js";
import { screenExpectation } from "./app-map-compiler.js";
import { attachMappedInboundPrelude } from "./app-map-test-inbound-prelude.js";
import type { Recipe } from "./recipes.js";

export type AuthoringRuntime = {
  captureFullPage?(
    session: AuthoringSession,
  ): Promise<{ evidence: AuthoringEvidence[]; label: string }>;
  observe(
    session: AuthoringSession,
    request?: AuthoringObservationRequest,
  ): Promise<CapturedAuthoringObservation>;
  execute(session: AuthoringSession, interaction: AuthoringInteraction): Promise<void>;
  replay(session: AuthoringSession, steps: RecipeStep[]): Promise<void>;
  /**
   * Returns a runtime with a deterministic reset primitive to the recorded
   * source before Relay captures replay evidence. Managed browser targets use
   * this to navigate to their configured start URL. Android recordings use
   * their saved starting app or the current app captured when recording began.
   */
  prepareReplaySource?(session: AuthoringSession): Promise<void>;
  /** Executes one authored action as an atomic batch. When present, the store
   * captures durable entrance/exit evidence around each action; older
   * runtimes keep the final-only replay path instead of inventing links. */
  replayAction?(session: AuthoringSession, action: AuthoringAction): Promise<void>;
  /**
   * Captures a coherent endpoint after one replayed action for later map
   * execution. iOS brackets its tree with pixels; stale geometry stays unproven.
   */
  observeReplayActionEndpoint?(session: AuthoringSession): Promise<CapturedAuthoringObservation>;
  /** Allow asynchronous application and system UI to settle before Relay
   * decides that a replay reached the wrong destination. */
  settle?(ms: number): Promise<void>;
  startVideo?(session: AuthoringSession): Promise<void>;
  stopVideo?(
    session: AuthoringSession,
  ): Promise<{ data?: Uint8Array; mime?: string; warning?: string }>;
};

export type AuthoringRecovery = {
  releaseLease(session: AuthoringSession): Promise<void>;
  reconcileRecording?(
    session: AuthoringSession,
  ): Promise<{ data?: Uint8Array; mime?: string } | void>;
};

export type AuthoringRecoveryScope = {
  organizationId: string;
  projectId: string;
};

export type AuthoringCommitFault = (
  boundary: "before-verify" | "after-verify" | "before-rename" | "before-persist" | "after-rename",
) => void;

/** Reopen the recorded app and follow approved map routes when available.
 * Endpoint identity is checked afterward, so launch alone never proves that
 * a nested starting screen was reached. */
export function authoringReplaySourceSteps(session: AuthoringSession, map?: AppMap): RecipeStep[] {
  if (session.target.kind === "browser") return [{ kind: "key", key: "home" }];
  if (session.target.platform !== "android") return [];
  const app = authoringOriginApplication(session);
  if (!app) return [];
  const steps: RecipeStep[] = [{ kind: "app", action: "open", app, relaunch: true }];
  const sourceId =
    session.sourceScreenId ??
    (session.pendingConnectionId
      ? map?.connections[session.pendingConnectionId]?.fromScreenId
      : undefined);
  const screen = sourceId ? map?.screens[sourceId] : undefined;
  if (!map || !screen?.identity) return steps;
  const expected = screenExpectation(map, screen, "authoring-replay-source");
  const graph: Record<string, Recipe> = {
    source: {
      id: "source",
      title: "Open starting screen",
      source: "custom",
      steps: [expected],
      createdAt: 0,
      updatedAt: 0,
    },
  };
  attachMappedInboundPrelude(map, graph, "source");
  return [...steps, ...graph.source!.steps];
}

/** Current-screen recording freezes the app the operator chose by recording there. */
export function authoringOriginApplication(session: AuthoringSession): string | undefined {
  if (session.originApplication) return session.originApplication;
  if (!session.take) return undefined;
  const before = currentRevision(session).before;
  if (!before || !hasCurrentAuthoringSemantics(before.proof)) return undefined;
  if (session.target.platform === "android") return before.foregroundApp;
  if (session.target.platform !== "ios" || before.screen.deviceId !== session.target.targetId)
    return undefined;
  const proof = before.proof!;
  const pixels = proof.pixels;
  const times = [
    pixels.capturedAt,
    proof.semantics.capturedAt,
    pixels.bracket?.afterCapturedAt,
    before.capturedAt,
  ];
  if (
    proof.captureOrder !== "pixels-ax-pixels" ||
    pixels.status !== "captured" ||
    times.some((time) => time === undefined || !Number.isFinite(time) || time < 0) ||
    times[0]! > times[1]! ||
    times[1]! > times[2]! ||
    times[2]! > times[3]!
  )
    return undefined;
  const nodes = before.nodes ?? [];
  const roots = nodes.filter((node) => node.type === "Application" && node.depth === 0);
  if (roots.length !== 1) return undefined;
  const app = observedIosApplication(roots);
  if (!app) return undefined;
  try {
    if (
      nodes.some(
        (node) =>
          node.bundleId !== undefined &&
          (typeof node.bundleId !== "string" || resolveIosLaunchBundleId(node.bundleId) !== app),
      )
    )
      return undefined;
  } catch {
    return undefined;
  }
  // This is the commit origin, not a new Begin request or remembered launch state.
  return app;
}
