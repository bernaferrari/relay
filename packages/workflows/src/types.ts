import type {
  AuthoringCommitDestination,
  AuthoringInteraction,
  AuthoringTarget,
  AppMapTestStartup,
  SourceRevision,
} from "@relay/protocol";

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

/** Start one canonical recording session and leave it ready to accept recorded
 * interactions. The App Map revision is frozen before any target mutation. */
export type AuthorTestIntent = {
  kind: "author-test";
  title: string;
  appMapId: string;
  target: AuthoringTarget;
  leaseId: string;
  revision?: "current" | { exact: number };
  sourceScreenId?: string;
  pendingConnectionId?: string;
  group?: string;
};

export type RepeatTestIntent = {
  kind: "repeat-test";
  appMapId: string;
  testId: string;
  target: AuthoringTarget;
  revision?: "current" | { exact: number };
  over: { dimensionId: string; valueIds: readonly string[] };
  evidence?: "visual" | "smoke";
  sourceRevision?: SourceRevision;
  capture?: { fullSurfaceScreenIds: readonly string[] };
};

export type WorkflowIntent = RunTestIntent | AuthorTestIntent | RepeatTestIntent;

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
    | "unknown-job-status"
    | "unexpected-authoring-state";
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

export type FrozenAuthorTestIdentity = {
  title: string;
  appMapId: string;
  appMapRevision: number;
  target: AuthoringTarget;
  sourceScreenId?: string;
  pendingConnectionId?: string;
  group?: string;
};

export type FrozenRepeatTestIdentity = {
  appMapId: string;
  requestedAppMapRevision: number;
  executionAppMapRevision: number;
  testId: string;
  testPlanDigest: string;
  rootRecipeId: string;
  target: AuthoringTarget;
  over: { dimensionId: string; valueIds: readonly string[] };
  evidence: "visual" | "smoke";
  sourceRevision?: SourceRevision;
  capture?: { fullSurfaceScreenIds: readonly string[] };
};

export type RunWorkflowAction = "inspect" | "cancel";
export type AuthorWorkflowAction =
  | "inspect"
  | "record"
  | "checkpoint"
  | "stop"
  | "trim"
  | "reorder"
  | "replace"
  | "replay"
  | "approve"
  | "discard"
  | "cancel";
export type RepeatWorkflowAction = "inspect" | "continue" | "confirm-and-continue" | "cancel";

export type RunTestSnapshot = {
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
  allowedNextActions: readonly RunWorkflowAction[];
  problems: readonly WorkflowProblem[];
  evidenceRefs: readonly { kind: "run"; id: string }[];
};

export type AuthoringReview = {
  actionCount: number;
  actions: readonly {
    id: string;
    label?: string;
    stepCount: number;
    proofStatus?: "verified" | "pixels-only" | "unresolved";
  }[];
  latestReplay?: {
    id: string;
    takeRevision: number;
    outcome: "passed" | "failed" | "cancelled";
    error?: string;
  };
  replayRequired: boolean;
};

export type AuthorTestSnapshot = {
  schemaVersion: 1;
  kind: "author-test";
  title: string;
  phase: WorkflowPhase;
  stage:
    | "unstarted"
    | "unknown"
    | "preparing"
    | "ready"
    | "recording"
    | "reviewing"
    | "committing"
    | "committed"
    | "failed"
    | "cancelled";
  /** Opaque fingerprint of the latest canonical authoring session projection. */
  version: string;
  ref?: WorkflowRef;
  frozen?: FrozenAuthorTestIdentity;
  authoring?: {
    sessionId: string;
    takeId?: string;
    takeRevision?: number;
    committedConnectionId?: string;
  };
  review?: AuthoringReview;
  progress: { label: string; completed?: number; total?: number };
  allowedNextActions: readonly AuthorWorkflowAction[];
  problems: readonly WorkflowProblem[];
  evidenceRefs: readonly { kind: "authoring-evidence"; id: string }[];
};

export type RepeatOutcomeCounts = {
  selected: number;
  observed: number;
  untouched: number;
  running: number;
  passed: number;
  failed: number;
  needsReview: number;
  cancelled: number;
};

export type RepeatTestSnapshot = {
  schemaVersion: 1;
  kind: "repeat-test";
  title: string;
  phase: WorkflowPhase;
  stage: "unstarted" | "unknown" | "pilot" | "awaiting-continuation" | "remaining" | "complete";
  version: string;
  ref?: WorkflowRef;
  frozen?: FrozenRepeatTestIdentity;
  repeat?: { id: string; pilotJobId: string };
  outcomes: RepeatOutcomeCounts;
  progress: { label: string; completed?: number; total?: number };
  allowedNextActions: readonly RepeatWorkflowAction[];
  problems: readonly WorkflowProblem[];
  evidenceRefs: readonly { kind: "run"; id: string }[];
};

export type WorkflowSnapshot = RunTestSnapshot | AuthorTestSnapshot | RepeatTestSnapshot;

type VersionedDecision = {
  ref: WorkflowRef;
  expectedVersion: string;
};

export type RunTestDecision = VersionedDecision & { action: "cancel" };

export type AuthorTestDecision = VersionedDecision &
  (
    | { action: "record"; interaction: AuthoringInteraction }
    | { action: "checkpoint"; label?: string }
    | { action: "stop" }
    | { action: "trim"; fromMs?: number; toMs?: number; actionIds?: readonly string[] }
    | { action: "reorder"; actionIds: readonly string[] }
    | { action: "replace"; actionId: string; interaction: AuthoringInteraction }
    | { action: "replay" }
    | { action: "approve"; destination?: AuthoringCommitDestination }
    | { action: "discard" }
    | { action: "cancel" }
  );

export type RepeatTestDecision = VersionedDecision &
  ({ action: "continue" } | { action: "confirm-and-continue" } | { action: "cancel" });

export type WorkflowDecision = RunTestDecision | AuthorTestDecision | RepeatTestDecision;

export interface RelayWorkflows {
  start(intent: RunTestIntent): Promise<RunTestSnapshot>;
  start(intent: AuthorTestIntent): Promise<AuthorTestSnapshot>;
  start(intent: RepeatTestIntent): Promise<RepeatTestSnapshot>;
  advance(decision: WorkflowDecision): Promise<WorkflowSnapshot>;
  inspect(ref: WorkflowRef): Promise<WorkflowSnapshot>;
}
