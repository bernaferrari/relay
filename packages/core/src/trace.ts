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
};

/** A single operation observed inside a human-readable step. Unlike `glyphs`,
 * this list preserves order and repetition for execution timelines. */
export type TraceAction = {
  kind: Glyph;
  at: number;
  label?: string;
};

export type TraceStep = {
  id: string;
  index: number;
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

/** Default glyph plans per recipe id (mirrors qa-viewer step chrome). */
export const RECIPE_TRACE_PLANS: Record<string, RecipeTracePlan> = {
  "update-last-alpha": {
    glyphs: ["store", "wait", "shot"],
    kind: "Replay",
    tone: "dim",
    planned: [
      { title: "Ensure teachx Play account", glyphs: ["tap", "wait"] },
      { title: "Open Grok listing · Update only", glyphs: ["store", "tap", "wait"] },
      { title: "Restore home Play account", glyphs: ["tap", "ok"] },
    ],
  },
  "install-last-alpha": {
    glyphs: ["dl", "wait", "shot"],
    kind: "Replay",
    tone: "dim",
    planned: [
      { title: "Ensure teachx Play account", glyphs: ["tap", "wait"] },
      { title: "Update or first Install", glyphs: ["dl", "wait", "shot"] },
      { title: "Restore home Play account", glyphs: ["tap", "ok"] },
    ],
  },
  "reinstall-last-alpha": {
    glyphs: ["dl", "re", "wait", "shot"],
    kind: "Replay",
    tone: "dim",
    planned: [
      { title: "Ensure teachx Play account", glyphs: ["tap", "wait"] },
      { title: "Uninstall → Install", glyphs: ["re", "dl", "wait"] },
      { title: "Restore home Play account", glyphs: ["tap", "ok"] },
    ],
  },
  "update-last-prod": {
    glyphs: ["store", "wait", "ok"],
    kind: "Replay",
    tone: "dim",
    planned: [
      { title: "Ensure prod Play account", glyphs: ["tap", "wait"] },
      { title: "Update only (no reinstall)", glyphs: ["store", "tap", "wait"] },
    ],
  },
  "install-last-prod": {
    glyphs: ["re", "dl", "wait"],
    kind: "Replay",
    tone: "dim",
    planned: [
      { title: "Ensure prod Play account", glyphs: ["tap", "wait"] },
      { title: "Uninstall → Install", glyphs: ["re", "dl", "wait"] },
    ],
  },
  "login-google": {
    glyphs: ["login", "tap", "wait", "ok"],
    kind: "Replay",
    tone: "acc",
    planned: [
      { title: "Open Grok · auth chooser", glyphs: ["login", "wait"] },
      { title: "Continue with Google", glyphs: ["tap", "wait"] },
      { title: "Notifications Allow", glyphs: ["tap", "ok"] },
    ],
  },
  "login-email": {
    glyphs: ["login", "type", "wait", "ok"],
    kind: "Replay",
    tone: "acc",
    planned: [
      { title: "Open Grok · auth chooser", glyphs: ["login", "wait"] },
      { title: "Continue with Email", glyphs: ["tap", "type", "wait"] },
      { title: "Notifications Allow", glyphs: ["tap", "ok"] },
    ],
  },
  "login-x": {
    glyphs: ["login", "tap", "wait", "ok"],
    kind: "Replay",
    tone: "acc",
    planned: [
      { title: "Open Grok · auth chooser", glyphs: ["login", "wait"] },
      { title: "Continue with X", glyphs: ["tap", "wait"] },
      { title: "Notifications Allow", glyphs: ["tap", "ok"] },
    ],
  },
  logout: {
    glyphs: ["tap", "swipe", "tap", "ok"],
    kind: "Replay",
    tone: "dim",
    planned: [
      { title: "Open menu → Settings", glyphs: ["tap", "wait"] },
      { title: "Scroll to Sign out", glyphs: ["swipe", "tap"] },
      { title: "Confirm logout", glyphs: ["tap", "ok"] },
    ],
  },
};

export function planForAction(actionId: string): RecipeTracePlan {
  return (
    RECIPE_TRACE_PLANS[actionId] ?? {
      glyphs: ["ai", "wait"],
      kind: "Agent",
      tone: "acc",
      planned: [{ title: actionId, glyphs: ["ai", "wait"] }],
    }
  );
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
