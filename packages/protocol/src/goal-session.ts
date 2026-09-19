import type { CompactGoalObservation } from "./goal-observation.js";
import type { GoalFinding } from "./goal-finding.js";
import type { ModelDecisionRecord } from "./model-decision.js";

/** Durable contract for the first goal-first worker. */
export const GOAL_SESSION_SCHEMA_VERSION = 1 as const;
export const GOAL_SESSION_MAX_STEPS = 40 as const;
export const GOAL_SESSION_MAX_DURATION_MS = 900_000 as const;
export const GOAL_SESSION_MAX_ACTIONS = 40 as const;

export type GoalSessionStatus = "running" | "completed" | "blocked" | "uncertain" | "cancelled";

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
  | "target-unavailable"
  | "needs-input"
  | "cancelled";

export type GoalSessionTarget = {
  targetId: string;
  platform: "android" | "ios" | "browser";
  startUrl?: string;
  laneId?: string;
  authenticationFixtureReference?: string;
  /** Runtime session identity returned by the runtime when the target was
   * opened for this goal. Absent means the runtime did not report one — the
   * goal session id is never a substitute for a runtime session proof. */
  runtimeSessionId?: string;
  /** Exact-configuration proof from the runtime open, when provided. */
  configurationDigest?: string;
  /** The fixture the runtime actually applied, when it reports one. */
  appliedAuthenticationFixtureId?: string;
  /** True only when the runtime confirmed a genuinely clean session. */
  signedOut?: true;
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

/** Typed goal interactions dispatched through the existing target.interact
 * operation. Values for fill actions are resolved locally from the task's
 * value map — never from model output. */
export type GoalSessionInteraction =
  | { kind: "identifier" | "ref" | "label" | "point"; target: GoalSessionInteractionTarget }
  | {
      kind: "fill";
      target: GoalSessionInteractionTarget;
      value: string;
      mode?: "append" | "replace";
    }
  | { kind: "swipe"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: "key"; key: "back" | "home" | "recents" }
  | { kind: "wait"; ms: number }
  | { kind: "capture"; label?: string };

export type GoalSessionAction = {
  id: string;
  step: number;
  candidateId: string;
  label: string;
  interaction: GoalSessionInteraction;
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

export type GoalReproductionStatus =
  | "running"
  | "reproduced"
  | "unresolved"
  | "blocked"
  | "uncertain"
  | "cancelled";

/** One isolated replay of a completed goal path. It is evidence for review,
 * never an automatic claim that a product defect or Test has been proven. */
export type GoalReproductionRecord = {
  id: string;
  sourceSessionId: string;
  target: GoalSessionTarget;
  status: GoalReproductionStatus;
  startedAt: number;
  updatedAt: number;
  actions: GoalSessionAction[];
  observations: GoalSessionObservationRef[];
  findings?: GoalFinding[];
  lastObservation?: CompactGoalObservation;
  pendingAction?: GoalSessionPendingAction;
  stopReason?: GoalSessionStopReason;
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
  /** Plain task values (never model-visible). Stripped from every projection. */
  values?: Record<string, string>;
  status: GoalSessionStatus;
  step: number;
  createdAt: number;
  updatedAt: number;
  observations: GoalSessionObservationRef[];
  actions: GoalSessionAction[];
  findings?: GoalFinding[];
  lastObservation?: CompactGoalObservation;
  lastDecision?: ModelDecisionRecord;
  pendingAction?: GoalSessionPendingAction;
  reproduction?: GoalReproductionRecord;
  stopReason?: GoalSessionStopReason;
};

export type GoalSessionStartInput = {
  goal: string;
  /** A new managed browser is created when `startUrl` is supplied. */
  startUrl?: string;
  /** Use an already-connected native or managed browser target. */
  targetId?: string;
  laneId?: string;
  authenticationFixtureReference?: string;
  signedOut?: true;
  /** Internal parent-worker identity; callers normally omit it. */
  sessionId?: string;
  model?: string;
  maxSteps?: number;
  maxDurationMs?: number;
  /** Non-secret task input values, keyed by reference. The model sees only
   * the reference keys; values are resolved locally at dispatch. Credentials
   * belong in an authentication fixture, never here. */
  values?: Record<string, string>;
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
  findings: GoalFinding[];
  reproduction?: GoalReproductionRecord;
  /** True when a mutation was attempted and must be reviewed before resume. */
  resumeRequiresReview?: true;
};
