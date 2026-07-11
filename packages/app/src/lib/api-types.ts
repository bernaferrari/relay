/**
 * Client-side shapes matching the HTTP/SSE API from @relay/server.
 * Kept in the app package (no core import) so the UI stays host-agnostic.
 */

export type DeviceInfo = {
  id?: string;
  serial: string;
  name?: string;
  kind?: string | null;
  booted?: boolean | null;
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

export type TraceFrameRef = {
  path: string;
  caption: string;
  capturedAt: number;
  bytes?: number;
  base64?: string;
  mime?: string;
};

export type TraceStep = {
  id: string;
  index: number;
  kind: string;
  tone: string;
  title: string;
  glyphs: string[];
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  frames: TraceFrameRef[];
  log: string;
  heal?: string;
  status?: string;
};

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
      kind: "expect";
      target: StepTarget;
      condition: "visible" | "gone";
      timeoutMs?: number;
      note?: string;
    }
  | { kind: "pause"; message: string; note?: string }
  | { kind: "screenshot"; caption?: string; note?: string }
  | { kind: "flow"; flow: string; note?: string }
  | { kind: "module"; recipeId: string; note?: string }
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
      action: "open" | "close" | "switcher";
      app?: string;
      url?: string;
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
  source: "builtin" | "custom";
  steps: RecipeStep[];
  createdAt: number;
  updatedAt: number;
};

export type JobInfo = {
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
  runDir?: string;
  persisted?: boolean;
  recipeSnapshot?: RecipeInfo;
  artifacts?: { kind: string; capturedAt: number; data: unknown }[];
  resolvedInputs?: Record<string, string>;
};

export type PersistedRun = {
  schemaVersion?: number;
  id: string;
  action: string;
  serial?: string;
  status: string;
  healed?: boolean;
  healMessage?: string;
  attempts: number;
  dir: string;
  frames: TraceFrameRef[];
  steps: TraceStep[];
  logs: string[];
  durationMs?: number;
  error?: string;
  writtenAt: number;
  recipeSnapshot?: RecipeInfo;
  artifacts?: { kind: string; capturedAt: number; data: unknown }[];
  inputDigest?: string;
  resolvedInputs?: Record<string, string>;
};

export type HealthState = "unknown" | "online" | "offline";

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
