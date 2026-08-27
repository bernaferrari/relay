import type { AuthoringTarget, AppMapTestStartup, SourceRevision } from "@relay/protocol";

export type WorkflowRef = string & { readonly __workflowRef: unique symbol };

export type RunTestIntent = {
  kind: "run-test";
  appMapId: string;
  testId: string;
  target: AuthoringTarget;
  /** Current is read once and frozen before compilation. */
  revision?: "current" | { exact: number };
  startup?: AppMapTestStartup;
  sourceRevision?: SourceRevision;
  capture?: { fullSurfaceScreenIds: readonly string[] };
};

export type WorkflowIntent = RunTestIntent;

export type WorkflowPhase =
  | "blocked"
  | "queued"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "needs-attention";

export type WorkflowProblem = {
  code:
    | "invalid-intent"
    | "operation-unavailable"
    | "compile-blocked"
    | "revision-changed"
    | "malformed-response"
    | "mutation-outcome-unknown"
    | "stale-workflow-version"
    | "invalid-workflow-ref"
    | "unknown-job-status";
  title: string;
  detail: string;
  recovery: string;
  retryable: boolean;
  sourceCode?: string;
};

export type FrozenRunTestIdentity = {
  appMapId: string;
  appMapRevision: number;
  testId: string;
  rootRecipeId?: string;
  planDigest: string;
  target: AuthoringTarget;
  startup?: AppMapTestStartup;
  sourceRevision?: SourceRevision;
  capture?: { fullSurfaceScreenIds: readonly string[] };
};

export type WorkflowSnapshot = {
  schemaVersion: 1;
  kind: "run-test";
  title: string;
  phase: WorkflowPhase;
  /** Opaque fingerprint of the latest canonical job projection. */
  version: string;
  ref?: WorkflowRef;
  frozen?: FrozenRunTestIdentity;
  execution?: { jobId: string; runId?: string };
  progress: { label: string; completed?: number; total?: number };
  allowedNextActions: readonly ("inspect" | "cancel")[];
  problems: readonly WorkflowProblem[];
  evidenceRefs: readonly { kind: "run"; id: string }[];
};

export type WorkflowDecision = {
  action: "cancel";
  ref: WorkflowRef;
  expectedVersion: string;
};

export interface RelayWorkflows {
  start(intent: WorkflowIntent): Promise<WorkflowSnapshot>;
  advance(decision: WorkflowDecision): Promise<WorkflowSnapshot>;
  inspect(ref: WorkflowRef): Promise<WorkflowSnapshot>;
}
