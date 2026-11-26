/**
 * Action-trace model (qa-viewer step glyphs + two-line hierarchy).
 */

export type Glyph =
  | "tap"
  | "type"
  | "wait"
  | "shot"
  | "swipe"
  | "ok"
  | "fail"
  | "ai"
  | "dl"
  | "re"
  | "store"
  | "login";

export type StepTone = "dim" | "acc" | "heal" | "pass" | "fail";

export type StepKind = "Replay" | "Agent" | "Healed" | "Capture" | "Setup" | "Verify";

export type TraceFrameRef = {
  /** relative path under the run dir, e.g. frames/001.png */
  path: string;
  /** caption under the phone */
  caption: string;
  capturedAt: number;
  bytes?: number;
  /** optional data URL / base64 for live clients (may be stripped on disk) */
  base64?: string;
  mime?: string;
  width?: number;
  height?: number;
  /** Recipe/trace step that produced this frame. Comparison masks bind to it. */
  stepId?: string;
};

/** A single operation observed inside a human-readable step. Unlike `glyphs`,
 * this list preserves order and repetition for execution timelines. */
export type TraceAction = {
  kind: Glyph;
  at: number;
  label?: string;
};

export type TraceStep = {
  /** One-based upstream attempt when projecting an external execution. */
  attempt?: number;
  id: string;
  index: number;
  /** Immutable recipe identity captured at execution time when available. */
  recipeId?: string;
  /** Immutable compiled recipe-step identity; never inferred from trace id. */
  recipeStepId?: string;
  kind: StepKind;
  tone: StepTone;
  title: string;
  /** glyph keys for the meta row */
  glyphs: Glyph[];
  actions?: TraceAction[];
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  frames: TraceFrameRef[];
  log: string;
  /** self-heal callout copy */
  heal?: string;
  status?: "running" | "ok" | "error" | "healed";
};

export type RecipeTracePlan = {
  glyphs: Glyph[];
  kind: StepKind;
  tone: StepTone;
  planned: { title: string; glyphs: Glyph[] }[];
};

/** Generic fallback for an action without an explicit product trace plan. */
export function planForAction(actionId: string): RecipeTracePlan {
  return {
    glyphs: ["ai", "wait"],
    kind: "Agent",
    tone: "acc",
    planned: [{ title: actionId, glyphs: ["ai", "wait"] }],
  };
}

/** Best-effort glyph inference from a log line. */
export function glyphsFromLogLine(line: string): Glyph[] {
  const l = line.toLowerCase();
  const g: Glyph[] = [];
  if (/uninstall|reinstall|restore/.test(l)) g.push("re");
  if (/install|update|download|play/.test(l)) g.push("dl");
  if (/login|google|email|continue with|auth|sign/.test(l)) g.push("login");
  if (/tap|press|click|switch account/.test(l)) g.push("tap");
  if (/type|fill|input/.test(l)) g.push("type");
  if (/scroll|swipe/.test(l)) g.push("swipe");
  if (/wait|sleep|timeout|ensur/.test(l)) g.push("wait");
  if (/shot|screenshot|snapshot|capture|evidence/.test(l)) g.push("shot");
  if (/done|success|already-latest|pass/.test(l)) g.push("ok");
  if (/fail|error|✗/.test(l)) g.push("fail");
  if (g.length === 0) g.push("ai");
  return [...new Set(g)].slice(0, 5);
}
