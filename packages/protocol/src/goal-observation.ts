/** Text-only, bounded state supplied to optional goal/model adapters. */

export const GOAL_OBSERVATION_SCHEMA_VERSION = 2 as const;
export const GOAL_OBSERVATION_MAX_CANDIDATES = 40 as const;

export type GoalObservationPlatform = "android" | "ios" | "browser";

export type GoalObservationTarget = {
  sessionId: string;
  /** Identity of the goal record itself; never a runtime session proof. */
  targetId: string;
  platform: GoalObservationPlatform;
  app?: string;
  configurationId?: string;
  /** The runtime session identity (browser context / device session) when the
   * runtime reports one. Absent means the runtime did not provide it — not
   * that the goal session id is equivalent to a runtime session. */
  runtimeSessionId?: string;
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
  /** The source control did not report enabled=true; `enabled` is an assumption
   * for presentation and must not be treated as proven actionability. */
  enabledAssumed?: true;
  /** Editable controls are fill targets; they are never tap-authoritative. */
  editable?: true;
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
    pixels?: "captured" | "unavailable";
    pixelsCapturedAt?: number;
  };
  candidates: GoalObservationCandidate[];
  /** What this bounded projection does not contain. A compact summary is never
   * the complete observation; these counts keep truncation explicit. */
  omissions: {
    candidatesKept: number;
    candidatesOmitted: number;
  };
  recentActions: GoalObservationAction[];
  signals: GoalObservationSignal[];
  capabilities: GoalObservationCapability[];
  missingEvidence: string[];
  /** Reference keys of available task values. Values themselves never appear. */
  valueRefs?: string[];
  /** The projection intentionally contains no screenshots, credentials, or raw traces. */
  redacted: true;
};
