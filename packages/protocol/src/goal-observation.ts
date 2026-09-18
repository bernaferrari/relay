/** Text-only, bounded state supplied to optional goal/model adapters. */

export const GOAL_OBSERVATION_SCHEMA_VERSION = 1 as const;
export const GOAL_OBSERVATION_MAX_CANDIDATES = 40 as const;

export type GoalObservationPlatform = "android" | "ios" | "browser";

export type GoalObservationTarget = {
  sessionId: string;
  targetId: string;
  platform: GoalObservationPlatform;
  app?: string;
  configurationId?: string;
};

export type GoalObservationCandidate = {
  /** Only stable within this one observation. Never reuse it across frames. */
  id: string;
  kind: "control" | "back" | "scroll" | "wait" | "other";
  label?: string;
  /** Text is omitted for editable controls; their current values are never model input. */
  text?: string;
  role?: string;
  enabled: boolean;
  selected?: boolean;
  target: {
    identifier?: string;
    ref?: string;
    label?: string;
    text?: string;
    point?: { x: number; y: number };
  };
};

export type GoalObservationAction = {
  id: string;
  kind: string;
  outcome: "acknowledged" | "rejected" | "unknown";
  summary: string;
};

export type GoalObservationSignal = {
  kind: "error" | "network" | "log" | "missing-evidence" | "runtime";
  severity: "info" | "warning" | "error";
  summary: string;
};

export type GoalObservationCapability = {
  name: string;
  available: boolean;
  reason?: string;
};

export type CompactGoalObservation = {
  schemaVersion: typeof GOAL_OBSERVATION_SCHEMA_VERSION;
  observationDigest: string;
  goal: string;
  subgoal?: string;
  target: GoalObservationTarget;
  screen: {
    title?: string;
    fingerprint?: string;
    capturedAt?: number;
    semantics: "current" | "stale" | "unavailable";
  };
  candidates: GoalObservationCandidate[];
  recentActions: GoalObservationAction[];
  signals: GoalObservationSignal[];
  capabilities: GoalObservationCapability[];
  missingEvidence: string[];
  /** The projection intentionally contains no screenshots, credentials, or raw traces. */
  redacted: true;
};
