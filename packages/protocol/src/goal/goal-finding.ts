/** Bounded, review-required findings produced by goal exploration. */
export const GOAL_FINDING_SCHEMA_VERSION = 1 as const;

export type GoalFindingKind =
  | "reproduction-lead"
  | "possible-issue"
  | "blocked-exploration"
  | "missing-evidence";

export type GoalFindingStatus = "open" | "reproduced" | "blocked";

export type GoalFinding = {
  schemaVersion: typeof GOAL_FINDING_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  kind: GoalFindingKind;
  status: GoalFindingStatus;
  title: string;
  summary: string;
  evidenceRefs: string[];
  source: "goal-runner" | "fresh-reproduction";
  createdAt: number;
  updatedAt: number;
  /** Findings never authorize approval, promotion, or another mutation. */
  requiresReview: true;
};
