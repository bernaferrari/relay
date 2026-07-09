/**
 * Client-side shapes matching the HTTP/SSE API from @grok-device/server.
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

export type RecipeStep =
  | { kind: "tap"; target: StepTarget; note?: string }
  | { kind: "type"; text: string; target?: StepTarget; note?: string }
  | { kind: "scroll"; direction: "down" | "up"; amount?: number; note?: string }
  | {
      kind: "swipe";
      from: { x: number; y: number };
      to: { x: number; y: number };
      durationMs?: number;
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
  | { kind: "flow"; flow: string; note?: string };

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
};

export type PersistedRun = {
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
