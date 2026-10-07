import type {
  AuthoringAction,
  AuthoringEvidence,
  AuthoringInteraction,
  AuthoringSession,
  AppMap,
  RecipeStep,
} from "@relay/protocol";
import type { CapturedAuthoringObservation } from "./authoring-observation-capture.js";
import { currentRevision } from "./authoring-session-screen-proof.js";
import { hasCurrentAuthoringSemantics } from "./authoring-observation-proof.js";
import { screenExpectation } from "./app-map-compiler.js";
import { attachMappedInboundPrelude } from "./app-map-test-inbound-prelude.js";
import type { Recipe } from "./recipes.js";

export type AuthoringRuntime = {
  captureFullPage?(
    session: AuthoringSession,
  ): Promise<{ evidence: AuthoringEvidence[]; label: string }>;
  observe(session: AuthoringSession): Promise<CapturedAuthoringObservation>;
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
   * Captures the endpoint after one replayed action. Android/browser retain a
   * fresh tree for later map execution. iOS captures immediate pixels without
   * waiting for XCTest; delayed geometry must never become current proof.
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
  if (session.target.platform !== "android" || !session.take) return undefined;
  const before = currentRevision(session).before;
  return before && hasCurrentAuthoringSemantics(before.proof) ? before.foregroundApp : undefined;
}
