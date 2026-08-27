import type {
  AuthoringAction,
  AuthoringInteraction,
  AuthoringSession,
  RecipeStep,
} from "@relay/protocol";
import type { CapturedAuthoringObservation } from "./authoring-observation-capture.js";

export type AuthoringRuntime = {
  observe(session: AuthoringSession): Promise<CapturedAuthoringObservation>;
  execute(session: AuthoringSession, interaction: AuthoringInteraction): Promise<void>;
  replay(session: AuthoringSession, steps: RecipeStep[]): Promise<void>;
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
