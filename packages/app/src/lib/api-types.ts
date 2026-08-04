/**
 * Client-side shapes matching the HTTP/SSE API from @relay/server.
 * Kept in the app package (no core import) so the UI stays host-agnostic.
 */
import type {
  RecipeParameter,
  RecipeStep,
  ScreenIdentityObservation,
  StepTarget,
} from "@relay/protocol";

export type { RunEvidenceQuery } from "@relay/protocol";

export type {
  HumanCheckpointReason,
  HorizontalCoordinateAnchor,
  RecipeParameter,
  RecipeStep,
  RecordedNodeEvidence,
  RecordedSelectorCandidate,
  RecordedStepEvidence,
  StepTarget,
  StepPoint,
  VerticalCoordinateAnchor,
} from "@relay/protocol";

export type DeviceInfo = {
  id?: string;
  serial: string;
  name?: string;
  kind?: string | null;
  booted?: boolean | null;
  /** Reported by the device adapter when the platform exposes it. */
  osVersion?: string;
  /** Android platform-tool state; unauthorized/offline hardware stays visible but cannot run. */
  connectionState?: "connected" | "unauthorized" | "offline";
  /** iOS physical devices require this before Xcode can install Relay's runner. */
  developerMode?: "enabled" | "disabled";
  /** Whether Xcode's on-device developer services are available for this iOS device. */
  developerServicesAvailable?: boolean;
  platform?: "android" | "ios" | "browser";
  targetKind?: "device" | "browser";
  [key: string]: unknown;
};

export type ActionInfo = {
  id: string;
  title: string;
  description?: string;
  category: string;
  requiresProdMatch?: boolean;
  isAlpha?: boolean;
  glyphs?: string[];
  planned?: { title: string; glyphs?: string[] }[];
  [key: string]: unknown;
};

export type TraceFrameRef = import("@relay/protocol").TraceFrameDto;
export type TraceStep = import("@relay/protocol").TraceStepDto;

export type RecipeInfo = {
  id: string;
  title: string;
  description?: string;
  variables?: Record<string, string>;
  parameters?: RecipeParameter[];
  source: "builtin" | "custom";
  steps: RecipeStep[];
  createdAt: number;
  updatedAt: number;
  quarantined?: boolean;
  quarantineReason?: string;
};

export type RecipeStability = {
  total: number;
  passed: number;
  productFailures: number;
  harnessFailures: number;
  uncertain: number;
  passRate: number | null;
};

export type JobInfo = Omit<import("@relay/protocol").JobSummary, "status" | "frameCount"> & {
  frameCount?: number;
  id: string;
  action: string;
  serial?: string;
  status: "queued" | "running" | "paused" | "ok" | "error" | "healed" | "cancelled";
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  logs: string[];
  result?: unknown;
  error?: string;
  outcome?: import("@relay/protocol").RunOutcome;
  failureCategory?: import("@relay/protocol").FailureCategory;
  previousError?: string;
  healed?: boolean;
  healMessage?: string;
  attempts?: number;
  retryOf?: string;
  retriedBy?: string;
  steps?: TraceStep[];
  frames?: TraceFrameRef[];
  glyphs?: string[];
  kind?: string;
  tone?: string;
  title?: string;
  /** Observed on-device app version, when an app-build step captured one. */
  appVersion?: string;
  batchId?: string;
  caseIndex?: number;
  caseCount?: number;
  runDir?: string;
  persisted?: boolean;
  recipeSnapshot?: RecipeInfo;
  artifacts?: { kind: string; capturedAt: number; data: unknown }[];
  resolvedInputs?: Record<string, string>;
  waitingFor?: {
    kind: "human";
    message: string;
    reason:
      | "authentication"
      | "consent"
      | "verification"
      | "captcha"
      | "permission"
      | "review"
      | "other";
    resumeLabel: string;
    since: number;
    timeoutMs?: number;
    verifyAfter?: {
      target: StepTarget;
      condition: "visible" | "gone";
      timeoutMs?: number;
    };
  };
  /** Target facts frozen when this job was expanded from a compatibility matrix. */
  targetProfile?: import("@relay/protocol").TargetProfile;
  evidence?: import("@relay/protocol").EvidenceManifest;
};

export type PersistedRun = Omit<
  import("@relay/protocol").RunSummary,
  "queuedAt" | "frameCount" | "artifactCount" | "artifactBytes" | "pinned" | "retentionClass"
> & {
  schemaVersion?: number;
  id: string;
  action: string;
  title?: string;
  batchId?: string;
  caseIndex?: number;
  caseCount?: number;
  serial?: string;
  status: string;
  healed?: boolean;
  healMessage?: string;
  attempts: number;
  queuedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  dir: string;
  frames: TraceFrameRef[];
  steps: TraceStep[];
  logs: string[];
  durationMs?: number;
  /** Observed on-device app version, when an app-build step captured one. */
  appVersion?: string;
  error?: string;
  result?: unknown;
  outcome?: import("@relay/protocol").RunOutcome;
  failureCategory?: import("@relay/protocol").FailureCategory;
  writtenAt: number;
  recipeSnapshot?: RecipeInfo;
  artifacts?: { kind: string; capturedAt: number; data: unknown }[];
  inputDigest?: string;
  resolvedInputs?: Record<string, string>;
  /** Target facts frozen when this report was created. */
  targetProfile?: import("@relay/protocol").TargetProfile;
  evidence?: import("@relay/protocol").EvidenceManifest;
};

export type CompatibilityReport = import("@relay/protocol").CompatibilityReport;

export type HealthState = "unknown" | "online" | "offline";

export type LocalSchedule = {
  id: string;
  recipeId: string;
  targetKind: "device" | "browser";
  targetId: string;
  platform: "android" | "ios" | "browser";
  intervalMinutes: number;
  repetitions: number;
  enabled: boolean;
  projectId: string;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  lastRunAt?: number;
};

export type LogLine = {
  id: number;
  text: string;
  level: "info" | "success" | "error" | "default";
  at: number;
  jobId?: string;
};

export type SnapshotNode = {
  label?: string;
  value?: string;
  identifier?: string;
  role?: string;
  type?: string;
  enabled?: boolean;
  selected?: boolean;
  focused?: boolean;
  visibleToUser?: boolean;
  hittable?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  ref?: string;
  index?: number;
  depth?: number;
  parentIndex?: number;
};

export type SnapshotState = {
  serial?: string;
  capturedAt: number;
  nodes: SnapshotNode[];
  interactive: SnapshotNode[];
  tree?: string;
  bounds?: { width: number; height: number };
  /** False when the device hierarchy cannot be reliably mapped onto its pixels. */
  inspectable?: boolean;
  source?: "sdk" | "android-system";
  inspectionState?: "active" | "keyguard" | "asleep" | "unavailable" | "unknown";
  foregroundApp?: string;
  treeApp?: string;
  bindingState?: "matched" | "rebound" | "unavailable";
  screenIdentity?: ScreenIdentityObservation;
} | null;

export type Frame = {
  id: string;
  capturedAt: number;
  mime: string;
  base64: string;
  bytes: number;
  serial?: string;
  caption: string;
  jobId?: string;
  actionId?: string;
  path?: string;
};
