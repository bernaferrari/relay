import type {
  AuthoringCommitDestination,
  AuthoringInteraction,
  AuthoringCaptureMode,
  AuthoringCaptureProof,
  AuthoringEvidence,
  AuthoringFullPageCapture,
  AuthoringCaptureProvenance,
  AuthoringDebugOrigin,
  AuthoringRecordingEdit,
  AuthoringTarget,
  AppMapCompiledTest,
  AppMapTestStartup,
  BrowserEngine,
  OfflineTestPreflightReport,
  RepeatSpec,
  ReplayLabAnalysis,
  ReplayLabReport,
  ResolvedRepeatSpec,
  SourceRevision,
  TargetObservation,
  TracePack,
  TracePackExportResponse,
  ChangeProofRunOutput,
  OperationInput,
  OperationOutput,
  RecipeStep,
  VerifyChangeIntent,
  VerifyChangeResult,
  DiscoveryScope,
  GoalExplorationRecord,
  GoalSessionResult,
  GoalSessionRecord,
  GoalSessionStartInput,
  GoalExplorationResult,
  GoalExplorationStartInput,
} from "@relay/protocol";
export type { GoalSessionResult } from "@relay/protocol";
export type { GoalExplorationResult } from "@relay/protocol";
export type { TargetObservation, TargetObservationControl } from "@relay/protocol";

export type WorkflowRef = string & { readonly __workflowRef: unique symbol };

export type DurableWorkflowHandle = {
  workflowId: string;
  expectedVersion: number;
};

export type RunTestAccountBinding =
  | { kind: "fixture"; accountId: string; accountRevision: string; reference?: string }
  | { kind: "signed-out"; attested: true };

export type RunTestIntent = {
  kind: "run-test";
  appMapId: string;
  testId: string;
  /** Required unless laneId carries the who-and-where. */
  target?: AuthoringTarget;
  /** Saved who-and-where: the server resolves the Lane's bound target,
   * runtime profile, engine, and account before execution. */
  laneId?: string;
  /** Current is read once and frozen before compilation. */
  revision?: "current" | { exact: number };
  startup?: AppMapTestStartup;
  targetProfileId?: string;
  sourceRevision?: SourceRevision;
  engine?: BrowserEngine;
  account?: RunTestAccountBinding;
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

export type RecordingPathContext = {
  sourceScreenId?: string;
  pendingConnectionId?: string;
  group?: string;
  debugOrigin?: AuthoringDebugOrigin;
};

/** Start one canonical recording session and leave it ready to accept recorded
 * interactions. The App Map revision is frozen before any target mutation. */
export type AuthorTestIntent = RecordingPathContext & {
  kind: "author-test";
  actorId: string;
  title: string;
  appMapId: string;
  target: AuthoringTarget;
  /** Exact package/bundle selected during recording setup. */
  originApplication?: string;
  leaseId: string;
  revision?: "current" | { exact: number };
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
    | "input-not-dispatched"
    | "stale-workflow-version"
    | "invalid-workflow-ref"
    | "unknown-job-status"
    | "unexpected-authoring-state"
    | "repeat-dimension-unresolved"
    | "repeat-value-unresolved"
    | "repeat-pilot-invalid"
    | "repeat-scope-changed"
    | "risk-confirmation-required"
    | "review-required";
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
  engine?: import("@relay/protocol").BrowserEngine;
  account?: RunTestAccountBinding;
};

export type FrozenAuthorTestIdentity = RecordingPathContext & {
  originApplication?: string;
  title: string;
  actorId: string;
  appMapId: string;
  appMapRevision: number;
  target: AuthoringTarget;
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
  /** Undecided human-review obligations from the run's capture-review
   * artifacts. Present only when the run produced reviewable captures;
   * `pending > 0` on a terminal run means verification is incomplete —
   * collection succeeded, acceptance did not. */
  review?: { pending: number; decided: number };
  allowedNextActions: readonly RunWorkflowAction[];
  problems: readonly WorkflowProblem[];
  evidenceRefs: readonly { kind: "run"; id: string }[];
};

export type AuthoringReviewActionKind = RecipeStep["kind"] | "observe" | "mixed";

export type AuthoringReview = {
  actionCount: number;
  currentRevision?: number;
  revisionCount?: number;
  videoClip?: { startMs: number; endMs: number };
  actions: readonly {
    id: string;
    intent: string;
    label?: string;
    stepCount: number;
    /** The recipe step kind(s), without exposing step payloads such as typed text. */
    kind?: AuthoringReviewActionKind;
    startedAt?: number;
    finishedAt?: number;
    durationMs?: number;
    /** Safe evidence metadata; content URIs, hashes, and semantic nodes stay private. */
    evidence?: readonly {
      id: string;
      kind: AuthoringEvidence["kind"];
      capturedAt: number;
      roles: readonly ("action" | "entrance" | "exit")[];
    }[];
    evidenceIds?: readonly string[];
    evidenceCount?: number;
    evidenceKinds?: readonly AuthoringEvidence["kind"][];
    fullPage?: AuthoringFullPageCapture;
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
  /** Bounded wall-clock facts for the reviewed revision, not raw event data. */
  timeline?: {
    startedAt: number;
    finishedAt: number;
    durationMs: number;
    actionCount: number;
    evidenceCount: number;
    observationCount: number;
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
    proof: AuthoringCaptureProof;
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
    | { action: "approve"; destination?: AuthoringCommitDestination; testName?: string }
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
    | { action: "approve"; destination?: AuthoringCommitDestination; testName?: string }
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

export type RecordTestOutcomeIntent = OutcomeTargetSelection &
  RecordingPathContext & {
    kind: "record-test";
    appMapId?: string;
    title: string;
    /** Exact package/bundle selected during recording setup. */
    originApplication?: string;
    /** Recording controls a target. This explicit consent permits Relay to
     * acquire a new lease, but never to take over somebody else's lease. */
    confirmControl: true;
  };

export type RunTestOutcomeIntent = OutcomeTargetSelection & {
  kind: "run-test";
  appMapId?: string;
  testId: string;
  /** Saved who-and-where; replaces targetId when present. */
  laneId?: string;
  targetProfileId?: string;
  sourceRevision?: SourceRevision;
  startup?: AppMapTestStartup;
  engine?: BrowserEngine;
  account?: RunTestAccountBinding;
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

/** Goal-first execution is an explicit, bounded worker. It does not create
 * an App Map or silently promote model suggestions into durable Tests. */
export type GoalSessionStartIntent = GoalSessionStartInput & { kind: "goal-start" };
export type GoalSessionResumeIntent = { kind: "goal-resume"; sessionId: string };
export type GoalSessionReproduceIntent = { kind: "goal-reproduce"; sessionId: string };
export type GoalSessionInspectIntent = { kind: "goal-inspect"; sessionId: string };
export type GoalSessionCancelIntent = { kind: "goal-cancel"; sessionId: string };
export type GoalExplorationStartIntent = GoalExplorationStartInput & { kind: "goal-explore" };
export type GoalExplorationResumeIntent = {
  kind: "goal-explore-resume";
  explorationId: string;
};
export type GoalExplorationInspectIntent = {
  kind: "goal-explore-inspect";
  explorationId: string;
};
export type GoalPromotionIntent = {
  kind: "goal-promote";
  sessionId: string;
  title?: string;
  appMapId?: string;
  confirmControl: true;
};

/**
 * One bounded, resumable Agent Debug outcome. The action is deliberately
 * explicit: a caller can start recording, explore, run, inspect, propose a
 * repair, verify, or export without the facade guessing which mutation is
 * safe. Server-owned workflow and discovery operations remain authoritative.
 */
export type DebugBugOutcomeIntent =
  | (Omit<RecordTestOutcomeIntent, "kind"> & { kind: "debug-bug"; action: "start" })
  | {
      kind: "debug-bug";
      action: "explore";
      create: OperationInput<"discovery.create">;
      start?: OperationInput<"discovery.start">;
    }
  | (Omit<RunTestOutcomeIntent, "kind"> & { kind: "debug-bug"; action: "run" })
  | (Omit<InspectFailureIntent, "kind"> & { kind: "debug-bug"; action: "inspect" })
  | (Omit<ProposeRepairIntent, "kind"> & { kind: "debug-bug"; action: "propose-repair" })
  | {
      kind: "debug-bug";
      action: "verify";
      selection: VerifyChangeIntent["selection"];
      confirmationSatisfied?: true;
    }
  | (Omit<ExportEvidenceIntent, "kind"> & { kind: "debug-bug"; action: "export" });

export type DebugBugDiscoverySummary = {
  id: string;
  name: string;
  targetId: string;
  status: string;
  scope: Pick<DiscoveryScope, "maxScreens" | "maxTransitions" | "maxDurationMs">;
  screenCount: number;
  transitionCount: number;
  currentScreenId?: string;
};

export type DebugBugOutcome =
  | {
      schemaVersion: 1;
      kind: "debug-bug";
      action: "start";
      actorId: string;
      nextAction: "review-recording";
      recording: AuthorTestSnapshot;
    }
  | {
      schemaVersion: 1;
      kind: "debug-bug";
      action: "explore";
      actorId: string;
      nextAction: "review-discovery";
      session: DebugBugDiscoverySummary;
    }
  | {
      schemaVersion: 1;
      kind: "debug-bug";
      action: "run";
      actorId: string;
      nextAction: "inspect-run";
      run: RunTestSnapshot;
    }
  | {
      schemaVersion: 1;
      kind: "debug-bug";
      action: "inspect";
      actorId: string;
      nextAction: "review-repair" | "verify-change";
      failure: FailureInspection;
      clustering: {
        status: "unavailable";
        reason: string;
      };
    }
  | {
      schemaVersion: 1;
      kind: "debug-bug";
      action: "propose-repair";
      actorId: string;
      nextAction: "human-review";
      repair: RepairProposalResult;
    }
  | {
      schemaVersion: 1;
      kind: "debug-bug";
      action: "verify";
      actorId: string;
      nextAction: "inspect-verdict";
      verification: VerifyChangeResult;
    }
  | {
      schemaVersion: 1;
      kind: "debug-bug";
      action: "export";
      actorId: string;
      nextAction: "share-proof";
      evidence: EvidenceExportResult;
    };

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
  run: FailureRunSummary;
  evidence: FailureEvidenceSummary;
  repairProposals: readonly FailureRepairProposal[];
};

/** Bounded outcome projection. Raw Run artifacts and provider payloads remain
 * available through the advanced canonical operations and TracePack export. */
export type FailureRunSummary = {
  id: string;
  action: string;
  status: string;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
};

/** Presence summary over immutable Run evidence. The simplified seam does not
 * expose arbitrary event, log, or channel payloads. */
export type FailureEvidenceSummary = {
  runId: string;
  eventCount: number;
  channels: readonly string[];
};

export type FailureRepairProposal = {
  id: string;
  runId: string;
  checkId: string;
  checkTitle: string;
  error: string;
  priorAttemptCount: number;
};

export type RepairProposalResult = {
  proposalId: string;
  repairTargetId: string;
  runId: string;
  checkId: string;
  proposal: ProposeRepairIntent["proposal"];
  reviewRequired: true;
};

export type EvidenceExportResult = TracePackExportResponse;

export type ProveChangeOutcomeIntent = {
  kind: "prove-change";
  proofId?: string;
  expectedVersion?: number;
  wait?: boolean;
} & Omit<OperationInput<"proof.prepare">, "policy"> & {
    policy?: OperationInput<"proof.prepare">["policy"];
  };

export type ProveChangeOutcome = ChangeProofRunOutput | OperationOutput<"proof.prepare">;

export type InspectProofOutcomeIntent = {
  kind: "inspect-proof";
  proofId: string;
  includeHistory?: boolean;
};

export type InspectProofOutcome = OperationOutput<"proof.inspect">;

/** Small jobs-to-be-done interface for ordinary humans and agents. The
 * canonical operation registry remains the authority behind every method. */
export interface RelayOutcomeJobs {
  connect(intent?: ConnectTargetIntent): Promise<ConnectTargetResult>;
  observe(intent?: ObserveTargetIntent): Promise<TargetObservation>;
  record(intent: RecordTestOutcomeIntent): Promise<AuthorTestSnapshot>;
  run(intent: RunTestOutcomeIntent): Promise<RunTestSnapshot>;
  repeat(intent: RepeatTestOutcomeIntent): Promise<RepeatTestSnapshot>;
  inspectFailure(intent: InspectFailureIntent): Promise<FailureInspection>;
  debugBug(intent: DebugBugOutcomeIntent): Promise<DebugBugOutcome>;
  goal(intent: GoalSessionStartIntent): Promise<GoalSessionResult>;
  resumeGoal(intent: GoalSessionResumeIntent): Promise<GoalSessionResult>;
  reproduceGoal(intent: GoalSessionReproduceIntent): Promise<GoalSessionResult>;
  inspectGoal(intent: GoalSessionInspectIntent): Promise<GoalSessionRecord>;
  cancelGoal(intent: GoalSessionCancelIntent): Promise<GoalSessionRecord>;
  promoteGoal(intent: GoalPromotionIntent): Promise<AuthorTestSnapshot>;
  explore(intent: GoalExplorationStartIntent): Promise<GoalExplorationResult>;
  resumeExploration(intent: GoalExplorationResumeIntent): Promise<GoalExplorationResult>;
  inspectExploration(intent: GoalExplorationInspectIntent): Promise<GoalExplorationRecord>;
  proposeRepair(intent: ProposeRepairIntent): Promise<RepairProposalResult>;
  exportEvidence(intent: ExportEvidenceIntent): Promise<EvidenceExportResult>;
  replayLab(intent: ReplayLabOutcomeIntent): Promise<ReplayLabReport>;
  verifyChange(intent: VerifyChangeOutcomeIntent): Promise<VerifyChangeResult>;
  inspectProof(intent: InspectProofOutcomeIntent): Promise<InspectProofOutcome>;
  proveChange(intent: ProveChangeOutcomeIntent): Promise<ProveChangeOutcome>;
  inspect(input: WorkflowLookup): Promise<WorkflowSnapshot>;
  watchWorkflow(input: {
    workflowId: string;
    initial: WorkflowSnapshot;
    signal?: AbortSignal;
    onSnapshot?: (snapshot: WorkflowSnapshot) => void;
    disconnectedRefreshMs?: number;
    reconnectMs?: number;
  }): Promise<WorkflowSnapshot>;
  cancelRun(input: CancelRunOutcomeIntent): Promise<RunTestSnapshot>;
  continueRepeat(input: {
    workflowId: string;
    expectedVersion: number;
    confirmRemaining: true;
  }): Promise<RepeatTestSnapshot>;
  advanceRecording(decision: DurableAuthorTestDecision): Promise<AuthorTestSnapshot>;
  editRecording(intent: EditRecordingOutcomeIntent): Promise<AuthorTestSnapshot>;
}
