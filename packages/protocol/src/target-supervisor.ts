import type { TargetKind, TargetRuntimeReadiness } from "./target-contract.js";

export type TargetPixelHealthState = "ready" | "delayed" | "unavailable";
export type TargetSemanticHealthState =
  | "current"
  | "stale"
  | "refreshing"
  | "wedged"
  | "unavailable";
export type TargetInputHealthState = "ready" | "uncertain" | "blocked";
export type TargetOverallHealthState =
  | "starting"
  | "ready"
  | "pixel-only"
  | "recovering"
  | "needs-human"
  | "quarantined";

export type TargetRecoveryChannel = "pixels" | "semantics" | "input";
export type TargetRecoveryStage =
  | "refresh-pixels"
  | "refresh-semantics"
  | "restart-semantic-runner"
  | "prepare-platform-services"
  | "reconcile-observation";

export type TargetSupervisorEventCode =
  | "TARGET_SUPERVISOR_STARTED"
  | "TARGET_SUPERVISOR_REHYDRATED"
  | "TARGET_CONTEXT_UPDATED"
  | "TARGET_CONTROL_UPDATED"
  | "PIXELS_CAPTURED"
  | "PIXELS_DELAYED"
  | "PIXELS_UNAVAILABLE"
  | "SEMANTIC_TRAVERSAL_STARTED"
  | "SEMANTIC_TRAVERSAL_COMPLETED"
  | "SEMANTIC_TRAVERSAL_STALE"
  | "SEMANTIC_TRAVERSAL_TIMED_OUT"
  | "SEMANTIC_TRAVERSAL_WEDGED"
  | "SEMANTIC_TRAVERSAL_UNAVAILABLE"
  | "INPUT_INTENT_PERSISTED"
  | "INPUT_DISPATCHED"
  | "INPUT_NOT_DISPATCHED"
  | "INPUT_COMPLETED"
  | "INPUT_OUTCOME_UNKNOWN"
  | "INPUT_RECONCILED"
  | "INPUT_RECONCILIATION_AMBIGUOUS"
  | "RECOVERY_STARTED"
  | "RECOVERY_ESCALATED"
  | "RECOVERY_COMPLETED"
  | "RECOVERY_EXHAUSTED"
  | "TARGET_NEEDS_HUMAN"
  | "TARGET_QUARANTINED"
  | "STALE_COMPLETION_IGNORED";

export type TargetSupervisorRecoveryEvent = {
  sequence: number;
  at: number;
  code: TargetSupervisorEventCode;
  message: string;
  channel?: TargetRecoveryChannel;
  stage?: TargetRecoveryStage;
  mutationId?: string;
  traversalToken?: string;
};

export type TargetSupervisorLatencySummary = {
  count: number;
  averageMs?: number;
  maximumMs?: number;
};

export type TargetSupervisorHealth = {
  schemaVersion: 1;
  /** Project visibility includes scoped operational context. Public is a
   * local-host-only liveness projection with identities and history removed. */
  visibility?: "project" | "public";
  target: { id: string; kind: TargetKind };
  observedAt: number;
  epochs: { target: number; semanticSession: number };
  pixels: {
    state: TargetPixelHealthState;
    lastCapturedAt?: number;
    lastError?: string;
  };
  semantics: {
    state: TargetSemanticHealthState;
    lastCapturedAt?: number;
    lastError?: string;
    traversal?: { token: string; startedAt: number };
  };
  input: {
    state: TargetInputHealthState;
    pendingMutationId?: string;
    reason?: string;
  };
  control: {
    state: "available" | "owned" | "held-by-other";
    ownerId?: string;
    expiresAt?: number;
  };
  overall: TargetOverallHealthState;
  context: {
    foregroundApp?: string;
    screenFingerprint?: string;
    runCursor?: { runId: string; stepId?: string; index?: number };
  };
  recovery?: {
    channel: TargetRecoveryChannel;
    stage: TargetRecoveryStage;
    attempt: number;
    startedAt: number;
  };
  counters: {
    pixelCaptures: number;
    semanticTraversals: number;
    semanticTimeouts: number;
    semanticWedges: number;
    uncertainMutations: number;
    reconciliations: number;
    recoveryAttempts: number;
    recoveryFailures: number;
  };
  latency: {
    pixels: TargetSupervisorLatencySummary;
    semantics: TargetSupervisorLatencySummary;
    recovery: TargetSupervisorLatencySummary;
  };
  readiness: TargetRuntimeReadiness;
  /** Newest first and bounded by the supervisor's configured event limit. */
  events: readonly TargetSupervisorRecoveryEvent[];
};
