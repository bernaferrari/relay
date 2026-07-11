/**
 * One recipe model: JSON step-list recipes on disk, listed/edited over HTTP,
 * executed by the job engine (recipe-runner.ts + session.ts).
 *
 * Built-in coded flows are mirrored here as single-`flow`-step recipes so the
 * UI has a uniform list; custom recipes live as files under `recipes/`.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { ACTIONS, isActionId } from "./actions.js";
import { findWorkspaceRoot } from "./runs.js";
import { now } from "./events.js";
import type { Glyph } from "./trace.js";

/** How to find a target on screen — ordered fallbacks, most robust first. */
export type StepTarget = {
  /** a11y ref, e.g. "@e26" (most robust within one screen) */
  ref?: string;
  /** exact accessibility label */
  label?: string;
  /** text-contains match (device find query) */
  text?: string;
  /** raw coordinates (always works, least robust) */
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
  | { kind: "key"; key: "back" | "home"; note?: string }
  | {
      kind: "swipe";
      from: { x: number; y: number };
      to: { x: number; y: number };
      durationMs?: number;
      evidence?: RecordedStepEvidence;
      note?: string;
    }
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

export type Recipe = {
  /** slug, unique; custom ones are "custom-<slug>" */
  id: string;
  title: string;
  description?: string;
  source: "builtin" | "custom";
  steps: RecipeStep[];
  createdAt: number;
  updatedAt: number;
};

const MAX_WAIT_MS = 15 * 60 * 1000;

/** Directory for custom recipes — mirrors runsRoot()'s convention. */
export function recipesRoot(): string {
  const env = (process.env.RELAY_RECIPES_DIR ?? process.env.GROK_DEVICE_RECIPES_DIR)?.trim();
  if (env) return env;
  return join(findWorkspaceRoot(), "recipes");
}

function evidencePart(value: string, field: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`${field} contains invalid characters`);
  return value;
}

function evidenceDir(recipeId: string): string {
  return join(recipesRoot(), ".evidence", evidencePart(recipeId, "recipeId"));
}

/** Persist a recorder screenshot outside recipe JSON so tests stay small and editable. */
export async function saveRecipeEvidenceImage(input: {
  recipeId: string;
  evidenceId: string;
  base64: string;
}): Promise<{ bytes: number }> {
  const dir = evidenceDir(input.recipeId);
  const id = evidencePart(input.evidenceId, "evidenceId");
  const data = Buffer.from(input.base64, "base64");
  if (data.byteLength === 0) throw new Error("evidence image is empty");
  if (data.byteLength > 8 * 1024 * 1024) throw new Error("evidence image exceeds 8 MB");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.png`), data);
  return { bytes: data.byteLength };
}

export async function readRecipeEvidenceImage(
  recipeId: string,
  evidenceId: string,
): Promise<Buffer | null> {
  try {
    return await readFile(
      join(evidenceDir(recipeId), `${evidencePart(evidenceId, "evidenceId")}.png`),
    );
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function targetHasStrategy(t: StepTarget): boolean {
  return Boolean(t.ref || t.label || t.text || t.point);
}

export function describeTarget(t: StepTarget): string {
  if (t.ref) return `ref ${t.ref}`;
  if (t.label) return `label "${t.label}"`;
  if (t.text) return `text "${t.text}"`;
  if (t.point) return `point (${t.point.x}, ${t.point.y})`;
  return "<empty>";
}

/**
 * Sentence-style target description for `expect` steps: bare quoted label
 * (no "label" prefix), but "text ..." kept for text-contains targets, e.g.
 * `check "Sign in" visible` / `check text "Welcome" gone`.
 */
function describeExpectTarget(t: StepTarget): string {
  if (t.label) return `"${t.label}"`;
  if (t.text) return `text "${t.text}"`;
  return describeTarget(t);
}

function stepErr(index: number, why: string): Error {
  return new Error(`step ${index}: ${why}`);
}

function parseTarget(raw: unknown, index: number, field: string): StepTarget {
  if (!isObject(raw)) throw stepErr(index, `${field} must be an object`);
  const t: StepTarget = {};
  if (raw.ref !== undefined) {
    if (!isString(raw.ref)) throw stepErr(index, `${field}.ref must be a string`);
    t.ref = raw.ref;
  }
  if (raw.label !== undefined) {
    if (!isString(raw.label)) throw stepErr(index, `${field}.label must be a string`);
    t.label = raw.label;
  }
  if (raw.text !== undefined) {
    if (!isString(raw.text)) throw stepErr(index, `${field}.text must be a string`);
    t.text = raw.text;
  }
  if (raw.point !== undefined) {
    const p = raw.point;
    if (!isObject(p) || !isNumber(p.x) || !isNumber(p.y)) {
      throw stepErr(index, `${field}.point must be { x: number, y: number }`);
    }
    t.point = { x: p.x, y: p.y };
  }
  return t;
}
/** Parse a required { x, y } coordinate object. */
function parsePoint(raw: unknown, index: number, field: string): { x: number; y: number } {
  if (!isObject(raw) || !isNumber(raw.x) || !isNumber(raw.y)) {
    throw stepErr(index, `${field} must be { x: number, y: number }`);
  }
  return { x: raw.x, y: raw.y };
}

function parseRecordedNode(raw: unknown, index: number, field: string): RecordedNodeEvidence {
  if (!isObject(raw)) throw stepErr(index, `${field} must be an object`);
  const node: RecordedNodeEvidence = {};
  for (const key of ["label", "value", "identifier", "role", "type", "ref"] as const) {
    if (raw[key] === undefined) continue;
    if (!isString(raw[key])) throw stepErr(index, `${field}.${key} must be a string`);
    node[key] = raw[key];
  }
  if (raw.index !== undefined) {
    if (!isNumber(raw.index)) throw stepErr(index, `${field}.index must be a number`);
    node.index = raw.index;
  }
  if (raw.rect !== undefined) {
    if (
      !isObject(raw.rect) ||
      !isNumber(raw.rect.x) ||
      !isNumber(raw.rect.y) ||
      !isNumber(raw.rect.width) ||
      !isNumber(raw.rect.height)
    ) {
      throw stepErr(index, `${field}.rect must be { x, y, width, height }`);
    }
    node.rect = {
      x: raw.rect.x,
      y: raw.rect.y,
      width: raw.rect.width,
      height: raw.rect.height,
    };
  }
  return node;
}

function parseRecordedEvidence(raw: unknown, index: number): RecordedStepEvidence | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) throw stepErr(index, "evidence must be an object");
  if (!isString(raw.id) || !raw.id.trim()) throw stepErr(index, "evidence.id is required");
  if (!isNumber(raw.recordedAt)) throw stepErr(index, "evidence.recordedAt must be a number");
  const evidence: RecordedStepEvidence = { id: raw.id, recordedAt: raw.recordedAt };
  if (raw.serial !== undefined) {
    if (!isString(raw.serial)) throw stepErr(index, "evidence.serial must be a string");
    evidence.serial = raw.serial;
  }
  if (raw.deviceBounds !== undefined) {
    if (
      !isObject(raw.deviceBounds) ||
      !isNumber(raw.deviceBounds.width) ||
      !isNumber(raw.deviceBounds.height)
    ) {
      throw stepErr(index, "evidence.deviceBounds must be { width, height }");
    }
    evidence.deviceBounds = {
      width: raw.deviceBounds.width,
      height: raw.deviceBounds.height,
    };
  }
  if (raw.pointer !== undefined)
    evidence.pointer = parsePoint(raw.pointer, index, "evidence.pointer");
  if (raw.node !== undefined) evidence.node = parseRecordedNode(raw.node, index, "evidence.node");
  if (raw.ancestors !== undefined) {
    if (!Array.isArray(raw.ancestors) || raw.ancestors.length > 16) {
      throw stepErr(index, "evidence.ancestors must be an array with at most 16 nodes");
    }
    evidence.ancestors = raw.ancestors.map((node, i) =>
      parseRecordedNode(node, index, `evidence.ancestors[${i}]`),
    );
  }
  if (raw.candidates !== undefined) {
    if (!Array.isArray(raw.candidates) || raw.candidates.length > 24) {
      throw stepErr(index, "evidence.candidates must be an array with at most 24 entries");
    }
    evidence.candidates = raw.candidates.map((candidate, i) => {
      const field = `evidence.candidates[${i}]`;
      if (!isObject(candidate)) throw stepErr(index, `${field} must be an object`);
      if (!(["ref", "label", "text", "point"] as unknown[]).includes(candidate.strategy)) {
        throw stepErr(index, `${field}.strategy is invalid`);
      }
      if (!isString(candidate.label)) throw stepErr(index, `${field}.label must be a string`);
      if (!(["element", "ancestor", "coordinate"] as unknown[]).includes(candidate.source)) {
        throw stepErr(index, `${field}.source is invalid`);
      }
      if (!(["high", "medium", "fallback"] as unknown[]).includes(candidate.confidence)) {
        throw stepErr(index, `${field}.confidence is invalid`);
      }
      return {
        strategy: candidate.strategy as RecordedSelectorCandidate["strategy"],
        label: candidate.label,
        source: candidate.source as RecordedSelectorCandidate["source"],
        confidence: candidate.confidence as RecordedSelectorCandidate["confidence"],
        target: parseTarget(candidate.target, index, `${field}.target`),
      };
    });
  }
  if (raw.screenshot !== undefined) {
    const shot = raw.screenshot;
    if (
      !isObject(shot) ||
      !isString(shot.recipeId) ||
      !isString(shot.id) ||
      !isNumber(shot.capturedAt) ||
      shot.mime !== "image/png"
    ) {
      throw stepErr(index, "evidence.screenshot is invalid");
    }
    evidence.screenshot = {
      recipeId: shot.recipeId,
      id: shot.id,
      capturedAt: shot.capturedAt,
      mime: "image/png",
    };
  }
  return evidence;
}

/**
 * Validate an unknown steps array field-by-field. Throws `Error` naming the
 * first invalid step index and why. Returns the narrowed `RecipeStep[]`.
 */
export function validateRecipeSteps(steps: unknown): RecipeStep[] {
  if (!Array.isArray(steps)) throw new Error("steps must be an array");
  const out: RecipeStep[] = [];
  steps.forEach((raw, i) => {
    const index = i + 1; // 1-based for human-readable error messages
    if (!isObject(raw)) throw stepErr(index, "must be an object");
    const kind = raw.kind;
    if (!isString(kind)) throw stepErr(index, "kind is required");
    // optional note on every kind
    const note = raw.note !== undefined && isString(raw.note) ? raw.note : undefined;
    switch (kind) {
      case "tap": {
        const target = parseTarget(raw.target, index, "target");
        if (!targetHasStrategy(target)) {
          throw stepErr(index, "tap requires target with at least one of ref/label/text/point");
        }
        const step: Extract<RecipeStep, { kind: "tap" }> = {
          kind: "tap",
          target,
          ...(raw.evidence !== undefined
            ? { evidence: parseRecordedEvidence(raw.evidence, index)! }
            : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "long-press": {
        const target = parseTarget(raw.target, index, "target");
        if (!targetHasStrategy(target)) throw stepErr(index, "long-press requires a target");
        if (
          raw.durationMs !== undefined &&
          (!isNumber(raw.durationMs) || raw.durationMs < 100 || raw.durationMs > 10_000)
        ) {
          throw stepErr(index, "long-press.durationMs must be between 100 and 10000");
        }
        out.push({
          kind: "long-press",
          target,
          ...(raw.durationMs !== undefined ? { durationMs: raw.durationMs as number } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "type": {
        if (!isString(raw.text)) throw stepErr(index, "type requires text: string");
        const step: Extract<RecipeStep, { kind: "type" }> = {
          kind: "type",
          text: raw.text,
          ...(raw.target !== undefined ? { target: parseTarget(raw.target, index, "target") } : {}),
          ...(raw.evidence !== undefined
            ? { evidence: parseRecordedEvidence(raw.evidence, index)! }
            : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "scroll": {
        if (raw.direction !== "down" && raw.direction !== "up") {
          throw stepErr(index, 'scroll requires direction: "down" | "up"');
        }
        const step: Extract<RecipeStep, { kind: "scroll" }> = {
          kind: "scroll",
          direction: raw.direction,
          ...(raw.amount !== undefined
            ? isNumber(raw.amount)
              ? { amount: raw.amount }
              : (() => {
                  throw stepErr(index, "scroll.amount must be a number");
                })()
            : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "swipe": {
        const from = parsePoint(raw.from, index, "swipe.from");
        const to = parsePoint(raw.to, index, "swipe.to");
        let durationMs: number | undefined;
        if (raw.durationMs !== undefined) {
          if (!isNumber(raw.durationMs)) throw stepErr(index, "swipe.durationMs must be a number");
          if (raw.durationMs < 50 || raw.durationMs > 5000) {
            throw stepErr(index, "swipe.durationMs must be between 50 and 5000");
          }
          durationMs = raw.durationMs;
        }
        const step: Extract<RecipeStep, { kind: "swipe" }> = {
          kind: "swipe",
          from,
          to,
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(raw.evidence !== undefined
            ? { evidence: parseRecordedEvidence(raw.evidence, index)! }
            : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "key": {
        if (raw.key !== "back" && raw.key !== "home") {
          throw stepErr(index, 'key requires key: "back" | "home"');
        }
        const step: Extract<RecipeStep, { kind: "key" }> = {
          kind: "key",
          key: raw.key,
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "sleep": {
        if (!isNumber(raw.ms)) throw stepErr(index, "sleep requires ms: number");
        if (raw.ms < 0) throw stepErr(index, "sleep ms must be >= 0");
        const step: Extract<RecipeStep, { kind: "sleep" }> = {
          kind: "sleep",
          ms: raw.ms,
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "wait-for": {
        const target = parseTarget(raw.target, index, "target");
        // point-only targets can't be "waited for" (validation-time rejection)
        if (target.point && !target.ref && !target.label && !target.text) {
          throw stepErr(
            index,
            "wait-for target must have ref/label/text (point-only is not waitable)",
          );
        }
        if (!targetHasStrategy(target)) {
          throw stepErr(index, "wait-for requires target with ref/label/text");
        }
        let timeoutMs: number | undefined;
        if (raw.timeoutMs !== undefined) {
          if (!isNumber(raw.timeoutMs)) throw stepErr(index, "wait-for.timeoutMs must be a number");
          if (raw.timeoutMs < 0) throw stepErr(index, "wait-for.timeoutMs must be >= 0");
          if (raw.timeoutMs > MAX_WAIT_MS)
            throw stepErr(index, `wait-for.timeoutMs must be <= ${MAX_WAIT_MS} (15 min)`);
          timeoutMs = raw.timeoutMs;
        }
        const step: Extract<RecipeStep, { kind: "wait-for" }> = {
          kind: "wait-for",
          target,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "expect": {
        const target = parseTarget(raw.target, index, "target");
        // point-only targets can't be "expected" (validation-time rejection)
        if (target.point && !target.ref && !target.label && !target.text) {
          throw stepErr(
            index,
            "expect target must have ref/label/text (point-only is not checkable)",
          );
        }
        if (!targetHasStrategy(target)) {
          throw stepErr(index, "expect requires target with ref/label/text");
        }
        if (raw.condition !== "visible" && raw.condition !== "gone") {
          throw stepErr(index, 'expect requires condition: "visible" | "gone"');
        }
        let timeoutMs: number | undefined;
        if (raw.timeoutMs !== undefined) {
          if (!isNumber(raw.timeoutMs)) throw stepErr(index, "expect.timeoutMs must be a number");
          if (raw.timeoutMs < 0) throw stepErr(index, "expect.timeoutMs must be >= 0");
          if (raw.timeoutMs > MAX_WAIT_MS)
            throw stepErr(index, `expect.timeoutMs must be <= ${MAX_WAIT_MS} (15 min)`);
          timeoutMs = raw.timeoutMs;
        }
        const step: Extract<RecipeStep, { kind: "expect" }> = {
          kind: "expect",
          target,
          condition: raw.condition,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "pause": {
        if (!isString(raw.message)) throw stepErr(index, "pause requires message: string");
        const step: Extract<RecipeStep, { kind: "pause" }> = {
          kind: "pause",
          message: raw.message,
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "screenshot": {
        const step: Extract<RecipeStep, { kind: "screenshot" }> = {
          kind: "screenshot",
          ...(raw.caption !== undefined && isString(raw.caption) ? { caption: raw.caption } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "flow": {
        if (!isString(raw.flow)) throw stepErr(index, "flow requires flow: string (an ActionId)");
        if (!isActionId(raw.flow)) {
          throw stepErr(index, `flow references unknown action id: ${raw.flow}`);
        }
        const step: Extract<RecipeStep, { kind: "flow" }> = {
          kind: "flow",
          flow: raw.flow,
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "module": {
        if (!isString(raw.recipeId) || !raw.recipeId.trim())
          throw stepErr(index, "module requires recipeId: string");
        out.push({ kind: "module", recipeId: raw.recipeId, ...(note ? { note } : {}) });
        break;
      }
      case "clipboard": {
        if (raw.action !== "read" && raw.action !== "write")
          throw stepErr(index, 'clipboard requires action: "read" | "write"');
        if (raw.action === "write" && !isString(raw.text))
          throw stepErr(index, "clipboard write requires text: string");
        if (raw.expect !== undefined && !isString(raw.expect))
          throw stepErr(index, "clipboard.expect must be a string");
        if (raw.match !== undefined && raw.match !== "exact" && raw.match !== "contains")
          throw stepErr(index, 'clipboard.match must be "exact" | "contains"');
        out.push({
          kind: "clipboard",
          action: raw.action,
          ...(isString(raw.text) ? { text: raw.text } : {}),
          ...(isString(raw.expect) ? { expect: raw.expect } : {}),
          ...(raw.match === "contains" || raw.match === "exact" ? { match: raw.match } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "app": {
        if (raw.action !== "open" && raw.action !== "close" && raw.action !== "switcher")
          throw stepErr(index, 'app requires action: "open" | "close" | "switcher"');
        if (raw.app !== undefined && !isString(raw.app))
          throw stepErr(index, "app.app must be a string");
        if (raw.url !== undefined && !isString(raw.url))
          throw stepErr(index, "app.url must be a string");
        if (raw.action === "open" && !isString(raw.app) && !isString(raw.url))
          throw stepErr(index, "app open requires app or url");
        out.push({
          kind: "app",
          action: raw.action,
          ...(isString(raw.app) ? { app: raw.app } : {}),
          ...(isString(raw.url) ? { url: raw.url } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "device": {
        if (!["lock", "unlock", "keyboard-dismiss", "keyboard-enter"].includes(String(raw.action)))
          throw stepErr(index, "device has an unknown action");
        out.push({
          kind: "device",
          action: raw.action as "lock" | "unlock" | "keyboard-dismiss" | "keyboard-enter",
          ...(note ? { note } : {}),
        });
        break;
      }
      case "rotate": {
        if (
          !["portrait", "portrait-upside-down", "landscape-left", "landscape-right"].includes(
            String(raw.orientation),
          )
        )
          throw stepErr(index, "rotate has an invalid orientation");
        out.push({
          kind: "rotate",
          orientation: raw.orientation as
            | "portrait"
            | "portrait-upside-down"
            | "landscape-left"
            | "landscape-right",
          ...(note ? { note } : {}),
        });
        break;
      }
      case "settings": {
        if (
          !["wifi", "airplane", "location", "animations", "appearance"].includes(
            String(raw.setting),
          )
        )
          throw stepErr(index, "settings has an invalid setting");
        if (!["on", "off", "light", "dark", "toggle"].includes(String(raw.state)))
          throw stepErr(index, "settings has an invalid state");
        if (
          raw.setting === "appearance"
            ? !["light", "dark", "toggle"].includes(String(raw.state))
            : !["on", "off"].includes(String(raw.state))
        )
          throw stepErr(index, "settings state is not valid for this setting");
        out.push({
          kind: "settings",
          setting: raw.setting as "wifi" | "airplane" | "location" | "animations" | "appearance",
          state: raw.state as "on" | "off" | "light" | "dark" | "toggle",
          ...(note ? { note } : {}),
        });
        break;
      }
      case "location": {
        if (!isNumber(raw.latitude) || !isNumber(raw.longitude))
          throw stepErr(index, "location requires latitude and longitude numbers");
        if (raw.latitude < -90 || raw.latitude > 90 || raw.longitude < -180 || raw.longitude > 180)
          throw stepErr(index, "location coordinates are out of range");
        out.push({
          kind: "location",
          latitude: raw.latitude,
          longitude: raw.longitude,
          ...(note ? { note } : {}),
        });
        break;
      }
      case "permission": {
        const permissions = [
          "camera",
          "microphone",
          "photos",
          "contacts",
          "notifications",
          "calendar",
          "location",
          "location-always",
          "media-library",
          "motion",
          "reminders",
          "siri",
        ] as const;
        if (!["grant", "deny", "reset"].includes(String(raw.action)))
          throw stepErr(index, "permission has an invalid action");
        if (!permissions.includes(raw.permission as (typeof permissions)[number]))
          throw stepErr(index, "permission has an invalid target");
        out.push({
          kind: "permission",
          action: raw.action as "grant" | "deny" | "reset",
          permission: raw.permission as (typeof permissions)[number],
          ...(note ? { note } : {}),
        });
        break;
      }
      case "alert": {
        if (!["get", "accept", "dismiss", "wait"].includes(String(raw.action)))
          throw stepErr(index, "alert has an invalid action");
        if (
          raw.timeoutMs !== undefined &&
          (!isNumber(raw.timeoutMs) || raw.timeoutMs < 0 || raw.timeoutMs > MAX_WAIT_MS)
        )
          throw stepErr(index, "alert.timeoutMs is invalid");
        out.push({
          kind: "alert",
          action: raw.action as "get" | "accept" | "dismiss" | "wait",
          ...(isNumber(raw.timeoutMs) ? { timeoutMs: raw.timeoutMs } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "network": {
        if (raw.action !== "dump" && raw.action !== "log")
          throw stepErr(index, 'network requires action: "dump" | "log"');
        if (
          raw.include !== undefined &&
          !["summary", "headers", "body", "all"].includes(String(raw.include))
        )
          throw stepErr(index, "network.include is invalid");
        if (raw.limit !== undefined && (!isNumber(raw.limit) || raw.limit < 1 || raw.limit > 1000))
          throw stepErr(index, "network.limit must be between 1 and 1000");
        out.push({
          kind: "network",
          action: raw.action,
          ...(raw.include
            ? { include: raw.include as "summary" | "headers" | "body" | "all" }
            : {}),
          ...(isNumber(raw.limit) ? { limit: raw.limit } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "logs": {
        if (!["start", "stop", "mark", "clear"].includes(String(raw.action)))
          throw stepErr(index, "logs has an invalid action");
        if (raw.message !== undefined && !isString(raw.message))
          throw stepErr(index, "logs.message must be a string");
        out.push({
          kind: "logs",
          action: raw.action as "start" | "stop" | "mark" | "clear",
          ...(isString(raw.message) ? { message: raw.message } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      default:
        throw stepErr(index, `unknown step kind: ${kind}`);
    }
  });
  return out;
}

/** Built-in recipes: one per coded flow, each a single opaque `flow` step. */
export function builtinRecipes(): Recipe[] {
  return ACTIONS.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    source: "builtin" as const,
    steps: [{ kind: "flow", flow: a.id }],
    createdAt: 0,
    updatedAt: 0,
  }));
}

type StoredRecipe = Recipe | { id: string; hidden: true };

async function readStoredRecipe(id: string): Promise<StoredRecipe | null> {
  try {
    const raw = await readFile(join(recipesRoot(), `${id}.json`), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed) || !isString(parsed.id)) return null;
    if (parsed.hidden === true) return { id: parsed.id, hidden: true };
    const recipe = parsed as unknown as Recipe;
    recipe.source = "custom";
    return recipe;
  } catch {
    return null;
  }
}

/** Packaged flows and disk recipes share one editable catalog. Disk entries with
 * the same id override a packaged default; tombstones hide deleted defaults. */
export async function listRecipes(): Promise<Recipe[]> {
  const builtins = builtinRecipes();
  let entries: string[] = [];
  try {
    entries = await readdir(recipesRoot());
  } catch {
    return builtins;
  }
  const customs: Recipe[] = [];
  const overrides = new Map<string, Recipe>();
  const hidden = new Set<string>();
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(recipesRoot(), name), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isObject(parsed) || !isString(parsed.id)) continue;
      if (parsed.hidden === true) {
        hidden.add(parsed.id);
        continue;
      }
      const recipe = parsed as unknown as Recipe;
      recipe.source = "custom";
      if (isActionId(recipe.id)) overrides.set(recipe.id, recipe);
      else customs.push(recipe);
    } catch {
      /* skip unreadable files — tolerant like listPersistedRuns */
    }
  }
  customs.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const included = builtins
    .filter((recipe) => !hidden.has(recipe.id))
    .map((recipe) => overrides.get(recipe.id) ?? recipe);
  return [...included, ...customs];
}

export async function readRecipe(id: string): Promise<Recipe | null> {
  const stored = await readStoredRecipe(id);
  if (stored) return "hidden" in stored ? null : stored;
  const builtin = builtinRecipes().find((r) => r.id === id);
  if (builtin) return builtin;
  return null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

async function ensureRecipesRoot(): Promise<void> {
  await mkdir(recipesRoot(), { recursive: true });
}

export type SaveRecipeInput = {
  id?: string;
  title: string;
  description?: string;
  steps: RecipeStep[];
};

/**
 * Create or overwrite a recipe. Packaged ids are persisted as user overrides,
 * so every catalog item has the same edit semantics.
 */
export async function saveRecipe(input: SaveRecipeInput): Promise<Recipe> {
  const steps = validateRecipeSteps(input.steps);
  if (!isString(input.title) || input.title.trim().length === 0) {
    throw new Error("title is required");
  }
  const ts = now();
  let id = input.id?.trim();
  if (!id) {
    id = `custom-${slugify(input.title)}-${ts.toString(36)}`;
  }
  // If overwriting, preserve createdAt.
  const stored = await readStoredRecipe(id);
  const existing = stored && !("hidden" in stored) ? stored : null;
  const recipe: Recipe = {
    id,
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
    source: "custom",
    steps,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  };
  await ensureRecipesRoot();
  await writeFile(join(recipesRoot(), `${id}.json`), JSON.stringify(recipe, null, 2), "utf8");
  return recipe;
}

/** Delete any recipe. Packaged defaults receive a tombstone so they remain
 * deleted instead of reappearing on the next list operation. */
export async function deleteRecipe(id: string): Promise<void> {
  await ensureRecipesRoot();
  await rm(evidenceDir(id), { recursive: true, force: true });
  if (isActionId(id)) {
    await writeFile(
      join(recipesRoot(), `${id}.json`),
      JSON.stringify({ id, hidden: true }, null, 2),
      "utf8",
    );
    return;
  }
  const path = join(recipesRoot(), `${id}.json`);
  if (existsSync(path)) {
    await unlink(path);
  }
}

/** Direction arrow for a swipe's dominant axis: ↓ ↑ → ← ↘ etc. */
function arrowForSwipe(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? "↓" : "↑";
  return dx >= 0 ? "→" : "←";
}

/** Human-readable one-line title for a step (trace + log surface). */
export function describeRecipeStep(step: RecipeStep): string {
  switch (step.kind) {
    case "tap":
      return `Tap ${describeTarget(step.target)}`;
    case "long-press":
      return `Long press ${describeTarget(step.target)}`;
    case "type":
      return step.target ? `Type into ${describeTarget(step.target)}` : "Type text";
    case "scroll":
      return `Scroll ${step.direction}`;
    case "swipe":
      return `swipe ${arrowForSwipe(step.from, step.to)} ${Math.round(step.from.x)},${Math.round(step.from.y)} → ${Math.round(step.to.x)},${Math.round(step.to.y)}`;
    case "key":
      return `Key: ${step.key}`;
    case "sleep":
      return `Sleep ${step.ms}ms`;
    case "wait-for":
      return `Wait for ${describeTarget(step.target)}`;
    case "expect":
      return `check ${describeExpectTarget(step.target)} ${step.condition}`;
    case "pause":
      return `Pause: ${step.message}`;
    case "screenshot":
      return step.caption ? `Screenshot · ${step.caption}` : "Screenshot";
    case "flow":
      return `Flow: ${step.flow}`;
    case "module":
      return `Run reusable test: ${step.recipeId}`;
    case "clipboard":
      return step.action === "write"
        ? "Set clipboard text"
        : step.expect !== undefined
          ? "Check clipboard text"
          : "Read clipboard text";
    case "app":
      return step.action === "switcher"
        ? "Open app switcher"
        : `${step.action === "open" ? "Open" : "Close"} ${step.app ?? step.url ?? "app"}`;
    case "device":
      return step.action === "keyboard-dismiss"
        ? "Dismiss keyboard"
        : step.action === "keyboard-enter"
          ? "Press keyboard Enter"
          : `${step.action === "lock" ? "Lock" : "Unlock"} device`;
    case "rotate":
      return `Rotate ${step.orientation}`;
    case "settings":
      return `Set ${step.setting} ${step.state}`;
    case "location":
      return `Set location ${step.latitude}, ${step.longitude}`;
    case "permission":
      return `${step.action} ${step.permission} permission`;
    case "alert":
      return `${step.action} system alert`;
    case "network":
      return step.action === "dump"
        ? `Capture network ${step.include ?? "summary"}`
        : "Mark network log";
    case "logs":
      return `${step.action} device logs`;
  }
}

/** Trace glyphs for a step (meta-row chrome). */
export function glyphsForStep(step: RecipeStep): Glyph[] {
  switch (step.kind) {
    case "tap":
      return ["tap"];
    case "long-press":
      return ["tap"];
    case "type":
      return ["type"];
    case "scroll":
      return ["swipe"];
    case "swipe":
      return ["swipe"];
    case "key":
      return ["tap"];
    case "sleep":
      return ["wait"];
    case "wait-for":
      return ["wait"];
    case "expect":
      return ["ok"];
    case "pause":
      return ["wait"];
    case "screenshot":
      return ["shot"];
    case "flow":
      return ["store"];
    case "module":
      return ["re", "store"];
    case "clipboard":
      return ["type"];
    case "app":
      return ["tap"];
    case "device":
    case "rotate":
    case "settings":
    case "location":
    case "permission":
    case "alert":
      return ["tap"];
    case "network":
    case "logs":
      return ["store"];
  }
}
