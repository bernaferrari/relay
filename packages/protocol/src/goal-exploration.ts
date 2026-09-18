import type {
  GoalSessionResult,
  GoalSessionStartInput,
  GoalSessionStatus,
} from "./goal-session.js";
import type { GoalFinding } from "./goal-finding.js";

/** Durable contract for a bounded group of independent goal workers. */
export const GOAL_EXPLORATION_SCHEMA_VERSION = 1 as const;
export const GOAL_EXPLORATION_MAX_WORKERS = 4 as const;

export type GoalExplorationStatus = "running" | "completed" | "partial" | "blocked" | "uncertain";

export type GoalExplorationStartInput = GoalSessionStartInput & {
  agents?: number;
};

export type GoalExplorationWorker = {
  id: string;
  index: number;
  sessionId: string;
  status: "pending" | "partial" | GoalSessionStatus;
  targetId?: string;
  laneId?: string;
  authenticationFixtureReference?: string;
  result?: GoalSessionResult;
  error?: string;
};

export type GoalExplorationSummary = {
  workers: number;
  completed: number;
  partial: number;
  blocked: number;
  uncertain: number;
};

export type GoalExplorationStopReason = {
  code: "all-workers-finished" | "worker-failed" | "resume-review-required";
  message: string;
  at: number;
};

export type GoalExplorationRecord = {
  schemaVersion: typeof GOAL_EXPLORATION_SCHEMA_VERSION;
  id: string;
  goal: string;
  agents: number;
  status: GoalExplorationStatus;
  createdAt: number;
  updatedAt: number;
  workers: GoalExplorationWorker[];
  summary: GoalExplorationSummary;
  findings?: GoalFinding[];
  stopReason?: GoalExplorationStopReason;
};

export type GoalExplorationResult = GoalExplorationRecord;
