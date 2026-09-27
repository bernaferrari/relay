import type {
  CaptureReviewSummary,
  BrowserAuthenticationHealth,
  BrowserCaseProfile,
  EvidenceCollectionPolicy,
  EvidenceManifest,
  ExecutionTargetRef,
  FailureCategory,
  RunOutcome,
  RunReview,
  TargetProfile,
  SourceRevision,
} from "@relay/protocol";
import type { DevicePlatform } from "./device.js";
import type { OperationContext } from "./operation-context.js";
import type { HumanCheckpointReason, Recipe, StepTarget } from "./recipes.js";
import type { TargetContext } from "./target-context.js";
import type { Glyph, TraceFrameRef, TraceStep, StepKind, StepTone } from "./trace.js";

export type JobStatus = "queued" | "running" | "paused" | "ok" | "error" | "healed" | "cancelled";

export type JobErrorCode =
  | "ACTION_FAILED"
  | "DEVICE_MISSING"
  | "UNKNOWN_ACTION"
  | "TIMEOUT"
  | "ACCOUNT_SWITCH_FAILED"
  | "CANCELLED"
  | "INTERNAL";

export type TestJob = {
  id: string;
  projectId?: string;
  ownerId?: string;
  operationContext?: OperationContext;
  /** Immutable execution target captured when the job is accepted. */
  targetContext: TargetContext;
  /**
   * Provider-scoped, serializable target identity. New jobs always receive
   * this immutable ref; it remains optional only while older in-memory jobs
   * and run fixtures are being read through the compatibility bridge.
   */
  executionTarget?: ExecutionTargetRef;
  action: string;
  /** Frozen before execution; absent means a person reviews captures. */
  referenceReviewMode?: import("@relay/protocol").CaptureReferenceReviewMode;
  /** recipe id when this job runs a recipe (action == recipeId for naming) */
  recipeId?: string;
  serial?: string;
  /** Human device name from agent-device list */
  deviceName?: string;
  platform: DevicePlatform;
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  /** Exact browser environment accepted with this Run. Never re-read from a
   * mutable managed target during proof execution. */
  browserCaseProfile?: BrowserCaseProfile;
  /** Frozen facts used to select this run from a compatibility matrix. */
  targetProfile?: TargetProfile;
  /** Invoked Lane (`--lane grok-lab`). Fixture Lanes keep this; unsignedLaneId
   * stays the signed-out scheduler identity only. */
  laneId?: string;
  /** Unsigned Lane identity so two signed-out grok.com Lanes do not share a
   * scheduler slot or Playwright session. Fixture Lanes omit this. */
  unsignedLaneId?: string;
  /** Last remembered fixture health at enqueue. Capture-review fail-closes
   * when this is not ready instead of labeling pixels as the saved account. */
  authenticationHealth?: BrowserAuthenticationHealth;
  /** Immutable commit/build binding captured when the run was accepted.
   * Audit-grade provenance: every proof names the exact source it exercised. */
  sourceRevision?: SourceRevision;
  /** Scheduler provenance. Optional only when reading older persisted runs. */
  workerId?: string;
  workerCapacity?: number;
  /** Optional aggregate host/provider ceiling in addition to the target lane. */
  hostWorkerId?: string;
  hostWorkerCapacity?: number;
  status: JobStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  logs: string[];
  result?: unknown;
  error?: string;
  errorCode?: JobErrorCode;
  outcome?: RunOutcome;
  failureCategory?: FailureCategory;
  /** A completed run whose final verdict is intentionally deferred to a human. */
  review?: RunReview;
  /** Optional app-under-test version if known from the action result. */
  appVersion?: string;
  batchId?: string;
  caseIndex?: number;
  caseCount?: number;
  /** prior failure message if this run self-healed via retry */
  previousError?: string;
  healed?: boolean;
  healMessage?: string;
  attempts: number;
  /** retries this job (or job this retries) */
  retryOf?: string;
  retriedBy?: string;
  steps: TraceStep[];
  frames: TraceFrameRef[];
  glyphs: Glyph[];
  kind: StepKind;
  tone: StepTone;
  title: string;
  runDir?: string;
  persisted?: boolean;
  /** True while the terminal run is being committed and compared with references. */
  finalizing?: boolean;
  /** Screenshot review counts once references were applied. */
  captureSummary?: CaptureReviewSummary;
  /** Frozen authoring input and evidence payloads written once with the run. */
  recipeSnapshot?: Recipe;
  /** Complete immutable graph used by module, branch, and repeat steps. */
  recipeGraph?: Record<string, Recipe>;
  /** Structured completeness and ordered evidence timeline for this run. */
  evidence?: EvidenceManifest;
  /** Consent grants frozen before collectors start. */
  evidencePolicy: EvidenceCollectionPolicy;
  /** Present while a recipe is deliberately waiting for a person to act. */
  waitingFor?: {
    kind: "human";
    message: string;
    reason: HumanCheckpointReason;
    resumeLabel: string;
    since: number;
    timeoutMs?: number;
    verifyAfter?: {
      target: StepTarget;
      condition: "visible" | "gone";
      timeoutMs?: number;
    };
  };
  artifacts: { kind: string; capturedAt: number; data: unknown }[];
  resolvedInputs: Record<string, string>;
  /** Input names whose values are execution-only and must never cross a
   * transport or persistence boundary in plaintext. */
  sensitiveInputNames?: string[];
  options?: {
    prodAccountMatch?: string;
  };
};

export type EnqueueJobInput = {
  /** Internal executable recipe projection for a canonical App Map Flow. */
  recipe: string;
  referenceReviewMode?: import("@relay/protocol").CaptureReferenceReviewMode;
  /**
   * Canonical provider-neutral target identity. When supplied it must agree
   * with any legacy serial/browser fields rather than silently picking one.
   */
  executionTarget?: ExecutionTargetRef;
  serial?: string;
  platform?: DevicePlatform;
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  /** Exact browser environment frozen before the job enters the queue. */
  browserCaseProfile?: BrowserCaseProfile;
  targetProfile?: TargetProfile;
  /** Invoked Lane. Kept on fixture jobs; unsignedLaneId is still stripped. */
  laneId?: string;
  /** Distinct unsigned Lane for signed-out overlap. Ignored when a fixture is set. */
  unsignedLaneId?: string;
  /** Remembered fixture health frozen with the job for capture-review labels. */
  authenticationHealth?: BrowserAuthenticationHealth;
  /** Frozen at enqueue time into the run manifest; never rewritten. */
  sourceRevision?: SourceRevision;
  prodAccountMatch?: string;
  /** retry a failed job — enables heal if success */
  retryOf?: string;
  /** provisional title for recipe jobs (recipe id is used if absent) */
  title?: string;
  variables?: Record<string, string>;
  sensitiveInputNames?: string[];
  batchId?: string;
  caseIndex?: number;
  caseCount?: number;
  artifacts?: TestJob["artifacts"];
  /** Frozen execution input. Matrix and retry jobs reuse this snapshot. */
  recipeSnapshot?: Recipe;
  recipeGraph?: Record<string, Recipe>;
  projectId?: string;
  ownerId?: string;
  evidencePolicy?: EvidenceCollectionPolicy;
  /** @deprecated Shared host identity; target lanes are inferred from the target. */
  workerId?: string;
  /** @deprecated Shared host capacity; target lanes are always exclusive. */
  workerCapacity?: number;
  hostWorkerId?: string;
  hostWorkerCapacity?: number;
};

/** Fresh remembered health for retry/replay. Omitted keeps the parent/run stamp. */
export type RetryEnqueueOptions = {
  authenticationHealth?: BrowserAuthenticationHealth;
};
