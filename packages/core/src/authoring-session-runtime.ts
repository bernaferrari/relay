import type {
  AuthoringAction,
  AuthoringEvidence,
  AuthoringInteraction,
  AuthoringSession,
  RecipeStep,
} from "@relay/protocol";
import type { CapturedAuthoringObservation } from "./authoring-observation-capture.js";

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
   * only their explicitly saved starting app; legacy recordings omit reset.
   */
  prepareReplaySource?(session: AuthoringSession): Promise<void>;
  /** Executes one authored action as an atomic batch. When present, the store
   * captures durable entrance/exit evidence around each action; older
   * runtimes keep the final-only replay path instead of inventing links. */
  replayAction?(session: AuthoringSession, action: AuthoringAction): Promise<void>;
  /**
   * Captures the endpoint immediately after one replayed action. This must be
   * pixels-first and must not wait for a new accessibility query: an iOS
   * endpoint is still useful while XCTest semantics are delayed, but stale
   * geometry must never be promoted to a current proof.
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

/** Reset only from saved user intent. Endpoint identity is checked after these
 * steps, so opening an app never counts as proof of reaching a nested source. */
export function authoringReplaySourceSteps(session: AuthoringSession): RecipeStep[] {
  if (session.target.kind === "browser") return [{ kind: "key", key: "home" }];
  if (session.target.platform === "android" && session.originApplication) {
    return [{ kind: "app", action: "open", app: session.originApplication, relaunch: true }];
  }
  return [];
}
