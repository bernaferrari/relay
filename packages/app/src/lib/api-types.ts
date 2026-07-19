/**
 * Client-side shapes matching the HTTP/SSE API from @relay/server.
 * Kept in the app package (no core import) so the UI stays host-agnostic.
 */

export type {
  SaveSuiteInput,
  SuiteEntry,
  SuiteRunManifest,
  SuiteRunManifestEntry,
  SuiteSection,
  SuiteVersion,
  TestSuite,
} from "@relay/protocol";

export type DeviceInfo = {
  id?: string;
  serial: string;
  name?: string;
  kind?: string | null;
  booted?: boolean | null;
  /** Reported by the device adapter when the platform exposes it. */
  osVersion?: string;
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

export type StepTarget = {
  ref?: string;
  label?: string;
  text?: string;
  point?: { x: number; y: number };
};

export type RecordedSelectorCandidate = {
  strategy: "ref" | "label" | "text" | "point";
  label: string;
  source: "element" | "ancestor" | "coordinate";
  confidence: "high" | "medium" | "fallback";
  target: StepTarget;
};

export type RecordedNodeEvidence = {
  label?: string;
  value?: string;
  identifier?: string;
  role?: string;
  type?: string;
  ref?: string;
  index?: number;
  rect?: { x: number; y: number; width: number; height: number };
};

/** Durable context captured while a manual desktop interaction is recorded. */
export type RecordedStepEvidence = {
  id: string;
  recordedAt: number;
  serial?: string;
  deviceBounds?: { width: number; height: number };
  pointer?: { x: number; y: number };
  node?: RecordedNodeEvidence;
  ancestors?: RecordedNodeEvidence[];
  candidates?: RecordedSelectorCandidate[];
  screenshot?: {
    recipeId: string;
    id: string;
    capturedAt: number;
    mime: "image/png";
  };
};

export type RecipeParameter = {
  name: string;
  label?: string;
  description?: string;
  default?: string;
  required?: boolean;
};

export type RecipeStep =
  | { kind: "tap"; target: StepTarget; evidence?: RecordedStepEvidence; note?: string }
  | { kind: "long-press"; target: StepTarget; durationMs?: number; note?: string }
  | {
      kind: "type";
      text: string;
      target?: StepTarget;
      evidence?: RecordedStepEvidence;
      note?: string;
    }
  | { kind: "scroll"; direction: "down" | "up"; amount?: number; note?: string }
  | {
      kind: "swipe";
      from: { x: number; y: number };
      to: { x: number; y: number };
      durationMs?: number;
      evidence?: RecordedStepEvidence;
      note?: string;
    }
  | { kind: "key"; key: "back" | "home"; note?: string }
  | { kind: "sleep"; ms: number; note?: string }
  | { kind: "wait-for"; target: StepTarget; timeoutMs?: number; note?: string }
  | {
      kind: "wait-response";
      target: StepTarget;
      busyTarget?: StepTarget;
      idleTarget?: StepTarget;
      timeoutMs?: number;
      stableForMs?: number;
      note?: string;
    }
  | {
      kind: "expect";
      target: StepTarget;
      condition: "visible" | "gone";
      timeoutMs?: number;
      note?: string;
    }
  | {
      kind: "extract";
      as: string;
      target: StepTarget;
      role?: "user" | "assistant" | "system";
      note?: string;
    }
  | {
      kind: "assert-content";
      input: string;
      expected: string;
      match: "exact" | "contains" | "not-contains";
      note?: string;
    }
  | {
      kind: "evaluate-semantic";
      input: string;
      criteria: string[];
      threshold?: number;
      provider?: string;
      model?: string;
      requireAgreement?: boolean;
      secondProvider?: string;
      secondModel?: string;
      note?: string;
    }
  | {
      kind: "pause";
      message: string;
      reason?:
        | "authentication"
        | "consent"
        | "verification"
        | "captcha"
        | "permission"
        | "review"
        | "other";
      resumeLabel?: string;
      timeoutMs?: number;
      verifyAfter?: {
        target: StepTarget;
        condition?: "visible" | "gone";
        timeoutMs?: number;
      };
      note?: string;
    }
  | { kind: "screenshot"; caption?: string; note?: string }
  | { kind: "flow"; flow: string; note?: string }
  | { kind: "module"; recipeId: string; bindings?: Record<string, string>; note?: string }
  | {
      kind: "branch";
      input: string;
      operator: "exists" | "equals" | "not-equals" | "contains";
      expected?: string;
      thenRecipeId: string;
      elseRecipeId?: string;
      note?: string;
    }
  | { kind: "repeat"; count: number; recipeId: string; note?: string }
  | { kind: "script"; source: string; note?: string }
  | {
      kind: "clipboard";
      action: "write" | "read";
      text?: string;
      expect?: string;
      match?: "exact" | "contains";
      note?: string;
    }
  | {
      kind: "app";
      action:
        | "open"
        | "close"
        | "switcher"
        | "inspect"
        | "assert-installed"
        | "assert-not-installed"
        | "install"
        | "update"
        | "uninstall";
      app?: string;
      url?: string;
      artifact?: string;
      as?: string;
      version?: string;
      versionMatch?: "exact" | "contains";
      note?: string;
    }
  | {
      kind: "device";
      action: "lock" | "unlock" | "keyboard-dismiss" | "keyboard-enter";
      note?: string;
    }
  | {
      kind: "rotate";
      orientation: "portrait" | "portrait-upside-down" | "landscape-left" | "landscape-right";
      note?: string;
    }
  | {
      kind: "settings";
      setting: "wifi" | "airplane" | "location" | "animations" | "appearance";
      state: "on" | "off" | "light" | "dark" | "toggle";
      note?: string;
    }
  | { kind: "location"; latitude: number; longitude: number; note?: string }
  | {
      kind: "permission";
      action: "grant" | "deny" | "reset";
      permission:
        | "camera"
        | "microphone"
        | "photos"
        | "contacts"
        | "notifications"
        | "calendar"
        | "location"
        | "location-always"
        | "media-library"
        | "motion"
        | "reminders"
        | "siri";
      note?: string;
    }
  | {
      kind: "alert";
      action: "get" | "accept" | "dismiss" | "wait";
      timeoutMs?: number;
      note?: string;
    }
  | {
      kind: "network";
      action: "dump" | "log";
      include?: "summary" | "headers" | "body" | "all";
      limit?: number;
      note?: string;
    }
  | { kind: "logs"; action: "start" | "stop" | "mark" | "clear"; message?: string; note?: string };

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

export type TestAtlas = {
  nodes: Array<{
    id: string;
    title: string;
    stepCount: number;
    capabilities: string[];
    signature: string;
  }>;
  edges: Array<{
    from: string;
    to: string;
    kind: "reuse" | "branch" | "repeat";
    label: string;
  }>;
  duplicateClusters: Array<{ signature: string; recipeIds: string[]; savings: number }>;
  coverage: Array<{ capability: string; tests: number }>;
};

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
