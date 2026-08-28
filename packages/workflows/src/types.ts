import type {
  AuthoringCommitDestination,
  AuthoringInteraction,
  AuthoringCaptureMode,
  AuthoringCaptureProof,
  AuthoringCaptureProvenance,
  AuthoringRecordingEdit,
  AuthoringTarget,
  AppMapCompiledTest,
  AppMapTestStartup,
  OfflineTestPreflightReport,
  RepeatSpec,
  ReplayLabAnalysis,
  ReplayLabReport,
  ResolvedRepeatSpec,
  SourceRevision,
  TargetObservation,
  TracePack,
  VerifyChangeIntent,
  VerifyChangeResult,
} from "@relay/protocol";
export type { TargetObservation, TargetObservationControl } from "@relay/protocol";

export type WorkflowRef = string & { readonly __workflowRef: unique symbol };

export type DurableWorkflowHandle = {
  workflowId: string;
  expectedVersion: number;
};

export type RunTestIntent = {
  kind: "run-test";
  appMapId: string;
  testId: string;
  target: AuthoringTarget;
  /** Current is read once and frozen before compilation. */
  revision?: "current" | { exact: number };
  startup?: AppMapTestStartup;
  targetProfileId?: string;
  sourceRevision?: SourceRevision;
  capture?: { fullSurfaceScreenIds: readonly string[] };
  /** Stable before dispatch so a renderer crash can adopt the queued job. */
  workflowRequestId?: string;
  /** New outcome clients reserve server-owned continuation state. Omit only
   * for bounded v1 compatibility reads and older embedding clients. */
  continuation?: "durable";
  /** Explicit consent for a once-per-run risk. Per-step and human-only risks
   * stay outside this simplified outcome. */
  confirmRisk?: true;
};

/** Start one canonical recording session and leave it ready to accept recorded
 * interactions. The App Map revision is frozen before any target mutation. */
export type AuthorTestIntent = {
  kind: "author-test";
  actorId: string;
  title: string;
  appMapId: string;
  target: AuthoringTarget;
  leaseId: string;
  revision?: "current" | { exact: number };
  sourceScreenId?: string;
  pendingConnectionId?: string;
  group?: string;
  /** Stable before dispatch so response loss can reconcile one session. */
  workflowRequestId?: string;
  continuation?: "durable";
};

export type RepeatTestIntent = {
  kind: "repeat-test";
  actorId?: string;
  appMapId: string;
  testId: string;
  target: AuthoringTarget;
  revision?: "current" | { exact: number };
  repeat: RepeatSpec;
  evidence?: "visual" | "smoke";
  sourceRevision?: SourceRevision;
  capture?: { fullSurfaceScreenIds: readonly string[] };
  confirmRisk?: true;
  workflowRequestId?: string;
  continuation?: "durable";
};

export type WorkflowIntent = RunTestIntent | AuthorTestIntent | RepeatTestIntent;

export type AuthorTestRecoveryIntent = { kind: "author-test"; sessionId: string };
export type RunTestRecoveryIntent = {
  kind: "run-test";
  frozen: FrozenRunTestIdentity;
  /** Client time immediately before the outcome-unknown enqueue request. */
  startedAfter: number;
};
export type RepeatTestRecoveryIntent = {
  kind: "repeat-test";
  appMapId: string;
  testId: string;
};
export type WorkflowRecoveryIntent =
  | RunTestRecoveryIntent
  | AuthorTestRecoveryIntent
  | RepeatTestRecoveryIntent;

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
    | "unexpected-authoring-state"
    | "repeat-dimension-unresolved"
    | "repeat-value-unresolved"
    | "repeat-pilot-invalid"
    | "repeat-scope-changed"
    | "risk-confirmation-required";
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
  targetProfileId?: string;
  sourceRevision?: SourceRevision;
  capture?: { fullSurfaceScreenIds: readonly string[] };
  workflowRequestId?: string;
};

export type FrozenAuthorTestIdentity = {
  title: string;
  actorId: string;
  appMapId: string;
  appMapRevision: number;
  target: AuthoringTarget;
  sourceScreenId?: string;
  pendingConnectionId?: string;
  group?: string;
  workflowRequestId?: string;
};

export type FrozenRepeatTestIdentity = {
  actorId?: string;
  workflowRequestId?: string;
  appMapId: string;
  requestedAppMapRevision: number;
  executionAppMapRevision: number;
  testId: string;
  testPlanDigest: string;
  rootRecipeId: string;
  target: AuthoringTarget;
  repeat: RepeatSpec;
  resolved: ResolvedRepeatSpec;
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
  | "edit"
  | "replay"
  | "approve"
  | "discard"
  | "cancel"
  | "abandon";
export type RepeatWorkflowAction = "inspect" | "continue" | "confirm-and-continue" | "cancel";

export type RunTestSnapshot = {
  schemaVersion: 1;
  kind: "run-test";
  title: string;
  phase: WorkflowPhase;
  /** Opaque fingerprint of the latest canonical job projection. */
  version: string;
  /** Server-owned continuation for new Run clients. The id is a lookup key,
   * never authorization; expectedVersion is the next CAS fence. */
  workflow?: DurableWorkflowHandle;
  ref?: WorkflowRef;
  frozen?: FrozenRunTestIdentity;
  execution?: { jobId: string; runId?: string };
  compiled?: { plan: AppMapCompiledTest; preflight: OfflineTestPreflightReport };
  progress: { label: string; completed?: number; total?: number };
  allowedNextActions: readonly RunWorkflowAction[];
  problems: readonly WorkflowProblem[];
  evidenceRefs: readonly { kind: "run"; id: string }[];
};

export type AuthoringReview = {
  actionCount: number;
  actions: readonly {
    id: string;
    intent: string;
    label?: string;
    stepCount: number;
    proofStatus?: "verified" | "pixels-only" | "unresolved";
    /** Origin truth before replay; inferred/instrumented actions remain
     * explicitly unproved until this exact revision passes replay. */
    captureProof: AuthoringCaptureProof;
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
  workflow?: DurableWorkflowHandle;
  ref?: WorkflowRef;
  frozen?: FrozenAuthorTestIdentity;
  authoring?: {
    sessionId: string;
    takeId?: string;
    takeRevision?: number;
    committedConnectionId?: string;
    committedTestId?: string;
  };
  capture?: {
    mode: AuthoringCaptureMode;
    provenance: AuthoringCaptureProvenance;
    replayRequiredBeforeApproval: boolean;
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

export type RepeatValueResult = {
  cellId: string;
  /** Exact selected tuple; one value is insufficient for a matrix result. */
  values: Readonly<Record<string, string>>;
  phase: "pilot" | "remaining";
  status: "untouched" | "running" | "passed" | "failed" | "needs-review" | "cancelled";
  runId?: string;
  error?: string;
};

export type RepeatTestSnapshot = {
  schemaVersion: 1;
  kind: "repeat-test";
  title: string;
  phase: WorkflowPhase;
  stage: "unstarted" | "unknown" | "pilot" | "awaiting-continuation" | "remaining" | "complete";
  version: string;
  workflow?: DurableWorkflowHandle;
  ref?: WorkflowRef;
  frozen?: FrozenRepeatTestIdentity;
  repeat?: { id: string };
  outcomes: RepeatOutcomeCounts;
  /** One inspectable result per selected case; counts are only a summary. */
  results: readonly RepeatValueResult[];
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
    | { action: "edit"; edit: AuthoringRecordingEdit }
    | { action: "replay" }
    | { action: "approve"; destination?: AuthoringCommitDestination }
    | { action: "discard" }
    | { action: "cancel" }
    | { action: "abandon"; reason: string }
  );

export type DurableAuthorTestDecision = DurableWorkflowHandle &
  (
    | { action: "record"; interaction: AuthoringInteraction }
    | { action: "checkpoint"; label?: string }
    | { action: "stop" }
    | { action: "edit"; edit: AuthoringRecordingEdit }
    | { action: "replay" }
    | { action: "approve"; destination?: AuthoringCommitDestination }
    | { action: "discard" }
    | { action: "cancel" }
    | { action: "abandon"; reason: string }
  );

export type RepeatTestDecision = VersionedDecision &
  ({ action: "continue" } | { action: "confirm-and-continue" } | { action: "cancel" });

export type DurableRepeatTestDecision = DurableWorkflowHandle &
  ({ action: "continue" } | { action: "confirm-and-continue" } | { action: "cancel" });

export type WorkflowDecision = RunTestDecision | AuthorTestDecision | RepeatTestDecision;

export interface RelayWorkflows {
  start(intent: RunTestIntent): Promise<RunTestSnapshot>;
  start(intent: AuthorTestIntent): Promise<AuthorTestSnapshot>;
  start(intent: RepeatTestIntent): Promise<RepeatTestSnapshot>;
  advance(decision: WorkflowDecision): Promise<WorkflowSnapshot>;
  inspect(ref: WorkflowRef): Promise<WorkflowSnapshot>;
  inspectDurable(
    workflowId: string,
  ): Promise<RunTestSnapshot | AuthorTestSnapshot | RepeatTestSnapshot>;
  inspectRun(workflowId: string): Promise<RunTestSnapshot>;
  inspectAuthoring(workflowId: string): Promise<AuthorTestSnapshot>;
  inspectRepeat(workflowId: string): Promise<RepeatTestSnapshot>;
  advanceAuthoring(decision: DurableAuthorTestDecision): Promise<AuthorTestSnapshot>;
  advanceRepeat(decision: DurableRepeatTestDecision): Promise<RepeatTestSnapshot>;
  cancelRun(input: DurableWorkflowHandle): Promise<RunTestSnapshot>;
  recover(intent: RunTestRecoveryIntent): Promise<RunTestSnapshot>;
  recover(intent: AuthorTestRecoveryIntent): Promise<AuthorTestSnapshot>;
  recover(intent: RepeatTestRecoveryIntent): Promise<RepeatTestSnapshot>;
}

export type OutcomeTargetSelection = { targetId?: string };

export type ConnectTargetIntent = OutcomeTargetSelection & { kind: "connect-target" };

export type ObserveTargetIntent = OutcomeTargetSelection & { kind: "observe-target" };

export type RecordTestOutcomeIntent = OutcomeTargetSelection & {
  kind: "record-test";
  appMapId?: string;
  title: string;
  /** Recording controls a target. This explicit consent permits Relay to
   * acquire a new lease, but never to take over somebody else's lease. */
  confirmControl: true;
};

export type RunTestOutcomeIntent = OutcomeTargetSelection & {
  kind: "run-test";
  appMapId?: string;
  testId: string;
  confirmRisk?: true;
};

export type RepeatTestOutcomeIntent = OutcomeTargetSelection & {
  kind: "repeat-test";
  appMapId?: string;
  testId: string;
  repeat: RepeatSpec;
  evidence?: "visual" | "smoke";
  confirmRisk?: true;
};

export type InspectFailureIntent = { kind: "inspect-failure"; runId: string };

export type ProposeRepairIntent = {
  kind: "propose-repair";
  runId: string;
  checkId: string;
  proposal: "accept-current" | "disable";
  reason: string;
};

export type ExportEvidenceIntent = { kind: "export-evidence"; runId: string };
export type ReplayLabOutcomeIntent = {
  kind: "replay-lab";
  analysis: ReplayLabAnalysis;
  tracePacks: readonly TracePack[];
};
export type VerifyChangeOutcomeIntent = VerifyChangeIntent;
export type WorkflowLookup = { workflowId: string } | { legacyRef: WorkflowRef };
export type InspectWorkflowOutcomeIntent = WorkflowLookup & { kind: "inspect-workflow" };
export type CancelRunOutcomeIntent = {
  kind: "cancel-run";
  workflowId: string;
  expectedVersion: number;
  confirmCancel: true;
};
export type ContinueRepeatOutcomeIntent = {
  kind: "continue-repeat";
  workflowId: string;
  expectedVersion: number;
  confirmRemaining: true;
};

export type EditRecordingOutcomeIntent = {
  kind: "edit-recording";
  workflowId: string;
  expectedVersion: number;
  edit: AuthoringRecordingEdit;
};

export type ConnectTargetResult = {
  targets: readonly AuthoringTarget[];
  current?: AuthoringTarget;
};

export type FailureInspection = {
  runId: string;
  run: unknown;
  evidence: unknown;
  repairProposals: readonly unknown[];
};

/** Small jobs-to-be-done interface for ordinary humans and agents. The
 * canonical operation registry remains the authority behind every method. */
export interface RelayOutcomeJobs {
  connect(intent?: ConnectTargetIntent): Promise<ConnectTargetResult>;
  observe(intent?: ObserveTargetIntent): Promise<TargetObservation>;
  record(intent: RecordTestOutcomeIntent): Promise<AuthorTestSnapshot>;
  run(intent: RunTestOutcomeIntent): Promise<RunTestSnapshot>;
  repeat(intent: RepeatTestOutcomeIntent): Promise<RepeatTestSnapshot>;
  inspectFailure(intent: InspectFailureIntent): Promise<FailureInspection>;
  proposeRepair(intent: ProposeRepairIntent): Promise<unknown>;
  exportEvidence(intent: ExportEvidenceIntent): Promise<unknown>;
  replayLab(intent: ReplayLabOutcomeIntent): Promise<ReplayLabReport>;
  verifyChange(intent: VerifyChangeOutcomeIntent): Promise<VerifyChangeResult>;
  inspect(input: WorkflowLookup): Promise<WorkflowSnapshot>;
  cancelRun(input: CancelRunOutcomeIntent): Promise<RunTestSnapshot>;
  continueRepeat(input: {
    workflowId: string;
    expectedVersion: number;
    confirmRemaining: true;
  }): Promise<RepeatTestSnapshot>;
  advanceRecording(decision: DurableAuthorTestDecision): Promise<AuthorTestSnapshot>;
  editRecording(intent: EditRecordingOutcomeIntent): Promise<AuthorTestSnapshot>;
}
