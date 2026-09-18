import type { CompactGoalObservation } from "./goal-observation.js";
import type { ModelDecisionRecord } from "./model-decision.js";

/** Durable contract for the first goal-first worker. */
export const GOAL_SESSION_SCHEMA_VERSION = 1 as const;
export const GOAL_SESSION_MAX_STEPS = 40 as const;
export const GOAL_SESSION_MAX_DURATION_MS = 900_000 as const;
export const GOAL_SESSION_MAX_ACTIONS = 40 as const;

export type GoalSessionStatus = "running" | "completed" | "blocked" | "uncertain";

export type GoalSessionStopCode =
  | "goal-achieved"
  | "budget-exhausted"
  | "provider-unavailable"
  | "provider-invalid"
  | "no-action"
  | "action-rejected"
  | "action-uncertain"
  | "resume-review-required"
  | "observation-unavailable"
  | "target-unavailable";

export type GoalSessionTarget = {
  targetId: string;
  platform: "android" | "ios" | "browser";
  startUrl?: string;
};

export type GoalSessionBudget = {
  maxSteps: number;
  maxDurationMs: number;
};

export type GoalSessionInteractionTarget = {
  identifier?: string;
  ref?: string;
  label?: string;
  point?: { x: number; y: number };
};

export type GoalSessionAction = {
  id: string;
  step: number;
  candidateId: string;
  label: string;
  interaction: {
    kind: "identifier" | "ref" | "label" | "point";
    target: GoalSessionInteractionTarget;
  };
  status: "intended" | "acknowledged" | "rejected" | "unknown";
  observationDigestBefore: string;
  observationDigestAfter?: string;
  evidenceRefs: string[];
  at: number;
  error?: string;
};

export type GoalSessionObservationRef = {
  step: number;
  observationDigest: string;
  capturedAt: number;
  evidenceRefs: string[];
};

export type GoalSessionPendingAction = {
  actionId: string;
  candidateId: string;
  observationDigest: string;
  intendedAt: number;
};

export type GoalSessionStopReason = {
  code: GoalSessionStopCode;
  message: string;
  at: number;
};

export type GoalSessionRecord = {
  schemaVersion: typeof GOAL_SESSION_SCHEMA_VERSION;
  id: string;
  goal: string;
  target: GoalSessionTarget;
  budget: GoalSessionBudget;
  laneId?: string;
  model?: string;
  status: GoalSessionStatus;
  step: number;
  createdAt: number;
  updatedAt: number;
  observations: GoalSessionObservationRef[];
  actions: GoalSessionAction[];
  lastObservation?: CompactGoalObservation;
  lastDecision?: ModelDecisionRecord;
  pendingAction?: GoalSessionPendingAction;
  stopReason?: GoalSessionStopReason;
};

export type GoalSessionStartInput = {
  goal: string;
  /** A new managed browser is created when `startUrl` is supplied. */
  startUrl?: string;
  /** Use an already-connected native or managed browser target. */
  targetId?: string;
  laneId?: string;
  signedOut?: true;
  model?: string;
  maxSteps?: number;
  maxDurationMs?: number;
};

export type GoalSessionResult = {
  schemaVersion: typeof GOAL_SESSION_SCHEMA_VERSION;
  sessionId: string;
  goal: string;
  target: GoalSessionTarget;
  status: GoalSessionStatus;
  step: number;
  budget: GoalSessionBudget;
  stopReason?: GoalSessionStopReason;
  lastObservation?: CompactGoalObservation;
  lastDecision?: ModelDecisionRecord;
  actions: GoalSessionAction[];
  observations: GoalSessionObservationRef[];
  /** True when a mutation was attempted and must be reviewed before resume. */
  resumeRequiresReview?: true;
};
