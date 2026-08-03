/**
 * One recipe model: deterministic YAML recipes on disk, listed/edited over HTTP,
 * executed by the job engine (recipe-runner.ts + session.ts).
 *
 * Built-in coded flows are mirrored here as single-`flow`-step recipes so the
 * UI has a uniform list; custom recipes live as files under `recipes/`.
 */
import { mkdir, readFile, readdir, writeFile, unlink, rm, stat, link } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ACTIONS, isActionId } from "./actions.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { now } from "./events.js";
import {
  CURRENT_RECORDING_FORMAT_VERSION,
  type RecordingFormatVersion,
} from "./recording-format.js";
import type { Glyph } from "./trace.js";
import {
  RevisionConflict,
  type Revisioned,
  HumanCheckpointReason,
  HorizontalCoordinateAnchor,
  RecipeParameter,
  RecipeStep,
  RecordedNodeEvidence,
  RecordedSelectorCandidate,
  RecordedStepEvidence,
  StepPoint,
  StepTarget,
  VerticalCoordinateAnchor,
} from "@relay/protocol";
import { currentOperationContext } from "./operation-context.js";
import { publish } from "./events.js";
import {
  atomicWriteFile,
  BoundedIdempotencyStore,
  KeyedSerialQueue,
  payloadFingerprint,
  scopedIdempotencyKey,
} from "./coordination-store.js";
export type {
  HumanCheckpointReason,
  HorizontalCoordinateAnchor,
  RecipeParameter,
  RecipeStep,
  RecordedNodeEvidence,
  RecordedSelectorCandidate,
  RecordedStepEvidence,
  StepPoint,
  StepTarget,
  VerticalCoordinateAnchor,
} from "@relay/protocol";
import {
  formatRecipeYaml,
  listYamlRecipeFiles,
  readYamlRecipeFile,
  recipeYamlPath,
  validateRecipeVariables,
} from "./recipe-yaml.js";

export type Recipe = {
  /** slug, unique; custom ones are "custom-<slug>" */
  id: string;
  title: string;
  description?: string;
  /** Test-scoped static values, frozen into the recipe source for Git review. */
  variables?: Record<string, string>;
  /** Declared inputs when this recipe is used as a reusable flow. */
  parameters?: RecipeParameter[];
  source: "builtin" | "custom";
  /**
   * Version of the recorded-evidence contract. It is intentionally separate
   * from the YAML schema so recordings can be audited or retired without
   * invalidating an otherwise readable flow definition.
   */
  recordingFormatVersion?: RecordingFormatVersion;
  steps: RecipeStep[];
  createdAt: number;
  updatedAt: number;
  quarantined?: boolean;
  quarantineReason?: string;
};

const MAX_WAIT_MS = 15 * 60 * 1000;

/** Directory for custom recipes — mirrors runsRoot()'s convention. */
export function recipesRoot(): string {
  const env = process.env.RELAY_RECIPES_DIR?.trim();
  if (env) return env;
  return join(findWorkspaceRoot(), "recipes");
}

/** Git-tracked YAML definitions are the only persisted recipe source. */
export function testsRoot(): string {
  const env = process.env.RELAY_TESTS_DIR?.trim();
  return env || join(findWorkspaceRoot(), "tests");
}

function evidencePart(value: string, field: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`${field} contains invalid characters`);
  return value;
}

function evidenceDir(recipeId: string): string {
  return join(recipesRoot(), ".evidence", evidencePart(recipeId, "recipeId"));
}

/** Persist a recorder screenshot outside recipe YAML so tests stay small and editable. */
export async function saveRecipeEvidenceImage(input: {
  recipeId: string;
  evidenceId: string;
  base64: string;
}): Promise<{ bytes: number; sha256: string; deduplicated: boolean }> {
  const dir = evidenceDir(input.recipeId);
  const id = evidencePart(input.evidenceId, "evidenceId");
  const data = Buffer.from(input.base64, "base64");
  if (data.byteLength === 0) throw new Error("evidence image is empty");
  if (data.byteLength > 8 * 1024 * 1024) throw new Error("evidence image exceeds 8 MB");
  await mkdir(dir, { recursive: true });
  // Evidence IDs are immutable event references, while bytes are shared by
  // content hash. Hard links preserve the existing `<evidenceId>.png` read
  // contract and turn duplicate recording frames into one physical blob.
  const sha256 = createHash("sha256").update(data).digest("hex");
  const blobs = join(dir, ".blobs");
  const blob = join(blobs, `${sha256}.png`);
  const target = join(dir, `${id}.png`);
  await mkdir(blobs, { recursive: true });
  let deduplicated = true;
  try {
    await writeFile(blob, data, { flag: "wx" });
    deduplicated = false;
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
  }
  try {
    await link(blob, target);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
    // Evidence IDs should be unique, but retrying a completed request must be
    // idempotent. Replace only this validated target, never the whole store.
    await unlink(target);
    await link(blob, target);
  }
  return { bytes: data.byteLength, sha256, deduplicated };
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

const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function validateRecipeParameters(value: unknown): RecipeParameter[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("parameters must be an array");
  if (value.length > 32) throw new Error("parameters are limited to 32 per reusable flow");
  const names = new Set<string>();
  const parameters = value.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`parameters[${index}] must be an object`);
    if (!isString(raw.name) || !PARAMETER_NAME.test(raw.name)) {
      throw new Error(`parameters[${index}].name is invalid`);
    }
    if (names.has(raw.name)) throw new Error(`parameters contain duplicate name ${raw.name}`);
    names.add(raw.name);
    if (raw.label !== undefined && !isString(raw.label))
      throw new Error(`parameters[${index}].label must be a string`);
    if (raw.description !== undefined && !isString(raw.description))
      throw new Error(`parameters[${index}].description must be a string`);
    if (raw.default !== undefined && !isString(raw.default))
      throw new Error(`parameters[${index}].default must be a string`);
    if (raw.required !== undefined && typeof raw.required !== "boolean")
      throw new Error(`parameters[${index}].required must be a boolean`);
    return {
      name: raw.name,
      ...(isString(raw.label) && raw.label.trim() ? { label: raw.label.trim() } : {}),
      ...(isString(raw.description) && raw.description.trim()
        ? { description: raw.description.trim() }
        : {}),
      ...(isString(raw.default) ? { default: raw.default } : {}),
      ...(raw.required === true ? { required: true } : {}),
    };
  });
  return parameters.length ? parameters : undefined;
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
    t.point = parseStepPoint(raw.point, index, `${field}.point`);
  }
  return t;
}

/** Parse an authored point with its optional responsive pin-to constraint. */
function parseStepPoint(raw: unknown, index: number, field: string): StepPoint {
  if (!isObject(raw) || !isNumber(raw.x) || !isNumber(raw.y)) {
    throw stepErr(index, `${field} must be { x: number, y: number }`);
  }
  const point: StepPoint = { x: raw.x, y: raw.y };
  if (raw.anchor !== undefined) {
    if (
      !isObject(raw.anchor) ||
      !["left", "center", "right"].includes(String(raw.anchor.horizontal)) ||
      !["top", "center", "bottom"].includes(String(raw.anchor.vertical))
    ) {
      throw stepErr(index, `${field}.anchor must contain horizontal and vertical anchors`);
    }
    point.anchor = {
      horizontal: raw.anchor.horizontal as HorizontalCoordinateAnchor,
      vertical: raw.anchor.vertical as VerticalCoordinateAnchor,
    };
  }
  if (raw.referenceBounds !== undefined) {
    if (
      !isObject(raw.referenceBounds) ||
      !isNumber(raw.referenceBounds.width) ||
      !isNumber(raw.referenceBounds.height) ||
      raw.referenceBounds.width <= 0 ||
      raw.referenceBounds.height <= 0
    ) {
      throw stepErr(index, `${field}.referenceBounds must be { width, height }`);
    }
    point.referenceBounds = {
      width: raw.referenceBounds.width,
      height: raw.referenceBounds.height,
    };
  }
  return point;
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
  if (raw.parentIndex !== undefined) {
    if (!isNumber(raw.parentIndex)) {
      throw stepErr(index, `${field}.parentIndex must be a number`);
    }
    node.parentIndex = raw.parentIndex;
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
  if (raw.capture !== undefined) {
    if (!isObject(raw.capture) || raw.capture.schemaVersion !== 1) {
      throw stepErr(index, "evidence.capture is invalid");
    }
    if (raw.capture.uiTreeCapturedAt !== undefined && !isNumber(raw.capture.uiTreeCapturedAt)) {
      throw stepErr(index, "evidence.capture.uiTreeCapturedAt must be a number");
    }
    if (
      raw.capture.screenshotCapturedAt !== undefined &&
      !isNumber(raw.capture.screenshotCapturedAt)
    ) {
      throw stepErr(index, "evidence.capture.screenshotCapturedAt must be a number");
    }
    if (!(raw.capture.status === "complete" || raw.capture.status === "partial")) {
      throw stepErr(index, "evidence.capture.status is invalid");
    }
    if (raw.capture.issues !== undefined) {
      if (
        !Array.isArray(raw.capture.issues) ||
        raw.capture.issues.some(
          (issue) =>
            issue !== "missing-ui-tree" &&
            issue !== "missing-screenshot" &&
            issue !== "missing-target",
        )
      ) {
        throw stepErr(index, "evidence.capture.issues is invalid");
      }
    }
    evidence.capture = {
      schemaVersion: 1,
      ...(raw.capture.uiTreeCapturedAt !== undefined
        ? { uiTreeCapturedAt: raw.capture.uiTreeCapturedAt }
        : {}),
      ...(raw.capture.screenshotCapturedAt !== undefined
        ? { screenshotCapturedAt: raw.capture.screenshotCapturedAt }
        : {}),
      status: raw.capture.status,
      ...(raw.capture.issues !== undefined ? { issues: [...raw.capture.issues] } : {}),
    };
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
  if (raw.nodes !== undefined) {
    if (!Array.isArray(raw.nodes) || raw.nodes.length > 256) {
      throw stepErr(index, "evidence.nodes must be an array with at most 256 nodes");
    }
    evidence.nodes = raw.nodes.map((node, i) =>
      parseRecordedNode(node, index, `evidence.nodes[${i}]`),
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
    if (shot.bytes !== undefined) {
      if (!isNumber(shot.bytes) || shot.bytes < 0) {
        throw stepErr(index, "evidence.screenshot.bytes is invalid");
      }
      evidence.screenshot.bytes = shot.bytes;
    }
    if (shot.sha256 !== undefined) {
      if (!isString(shot.sha256) || !/^[a-f0-9]{64}$/.test(shot.sha256)) {
        throw stepErr(index, "evidence.screenshot.sha256 is invalid");
      }
      evidence.screenshot.sha256 = shot.sha256;
    }
  }
  return evidence;
}

function parseStepMetadata(
  raw: Record<string, unknown>,
  index: number,
): {
  id?: string;
  group?: string;
  evidence?: RecordedStepEvidence;
  note?: string;
} {
  const metadata: { id?: string; group?: string; evidence?: RecordedStepEvidence; note?: string } =
    {};
  if (raw.id !== undefined) {
    if (!isString(raw.id) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(raw.id)) {
      throw stepErr(index, "id must use letters, numbers, hyphens, and underscores only");
    }
    metadata.id = raw.id;
  }
  if (raw.group !== undefined) {
    if (!isString(raw.group) || raw.group.trim().length === 0 || raw.group.trim().length > 96) {
      throw stepErr(index, "group must be a non-empty string of at most 96 characters");
    }
    metadata.group = raw.group.trim();
  }
  if (raw.evidence !== undefined) metadata.evidence = parseRecordedEvidence(raw.evidence, index);
  if (isString(raw.note) && raw.note.trim()) metadata.note = raw.note;
  return metadata;
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
        if (
          raw.gesture !== undefined &&
          raw.gesture !== "single" &&
          raw.gesture !== "multi" &&
          raw.gesture !== "hold"
        ) {
          throw stepErr(index, 'tap.gesture must be "single", "multi", or "hold"');
        }
        if (
          raw.tapCount !== undefined &&
          (!Number.isInteger(raw.tapCount) ||
            (raw.tapCount as number) < 2 ||
            (raw.tapCount as number) > 10)
        ) {
          throw stepErr(index, "tap.tapCount must be an integer between 2 and 10");
        }
        if (
          raw.intervalMs !== undefined &&
          (!isNumber(raw.intervalMs) || raw.intervalMs < 20 || raw.intervalMs > 2_000)
        ) {
          throw stepErr(index, "tap.intervalMs must be between 20 and 2000");
        }
        if (
          raw.durationMs !== undefined &&
          (!isNumber(raw.durationMs) || raw.durationMs < 100 || raw.durationMs > 10_000)
        ) {
          throw stepErr(index, "tap.durationMs must be between 100 and 10000");
        }
        const step: Extract<RecipeStep, { kind: "tap" }> = {
          kind: "tap",
          target,
          ...(raw.gesture !== undefined
            ? { gesture: raw.gesture as "single" | "multi" | "hold" }
            : {}),
          ...(raw.tapCount !== undefined ? { tapCount: raw.tapCount as number } : {}),
          ...(raw.intervalMs !== undefined ? { intervalMs: raw.intervalMs as number } : {}),
          ...(raw.durationMs !== undefined ? { durationMs: raw.durationMs as number } : {}),
          ...(note ? { note } : {}),
        };
        out.push(step);
        break;
      }
      case "type": {
        if (!isString(raw.text)) throw stepErr(index, "type requires text: string");
        const step: Extract<RecipeStep, { kind: "type" }> = {
          kind: "type",
          text: raw.text,
          ...(raw.target !== undefined ? { target: parseTarget(raw.target, index, "target") } : {}),
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
        const from = parseStepPoint(raw.from, index, "swipe.from");
        const to = parseStepPoint(raw.to, index, "swipe.to");
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
      case "wait-response": {
        const target = parseTarget(raw.target, index, "target");
        if (!target.ref && !target.label && !target.text) {
          throw stepErr(index, "wait-response target requires ref/label/text");
        }
        const parseOptionalSemanticTarget = (value: unknown, field: string) => {
          if (value === undefined) return undefined;
          const parsed = parseTarget(value, index, field);
          if (!parsed.ref && !parsed.label && !parsed.text) {
            throw stepErr(index, `${field} requires ref/label/text`);
          }
          return parsed;
        };
        const busyTarget = parseOptionalSemanticTarget(raw.busyTarget, "busyTarget");
        const idleTarget = parseOptionalSemanticTarget(raw.idleTarget, "idleTarget");
        const timeoutMs = raw.timeoutMs === undefined ? undefined : raw.timeoutMs;
        const stableForMs = raw.stableForMs === undefined ? undefined : raw.stableForMs;
        if (!isNumber(timeoutMs) && timeoutMs !== undefined)
          throw stepErr(index, "wait-response.timeoutMs must be a number");
        if (timeoutMs !== undefined && (timeoutMs < 1_000 || timeoutMs > MAX_WAIT_MS)) {
          throw stepErr(index, `wait-response.timeoutMs must be between 1000 and ${MAX_WAIT_MS}`);
        }
        if (!isNumber(stableForMs) && stableForMs !== undefined)
          throw stepErr(index, "wait-response.stableForMs must be a number");
        if (stableForMs !== undefined && (stableForMs < 500 || stableForMs > 30_000)) {
          throw stepErr(index, "wait-response.stableForMs must be between 500 and 30000");
        }
        out.push({
          kind: "wait-response",
          target,
          ...(busyTarget ? { busyTarget } : {}),
          ...(idleTarget ? { idleTarget } : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(stableForMs !== undefined ? { stableForMs } : {}),
          ...(note ? { note } : {}),
        });
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
      case "expect-screen": {
        if (!isString(raw.screenId) || !raw.screenId.trim()) {
          throw stepErr(index, "expect-screen.screenId is required");
        }
        if (!isString(raw.screenTitle) || !raw.screenTitle.trim()) {
          throw stepErr(index, "expect-screen.screenTitle is required");
        }
        if (!isString(raw.fingerprint) || !/^[a-f0-9]{64}$/u.test(raw.fingerprint)) {
          throw stepErr(index, "expect-screen.fingerprint must be a SHA-256 fingerprint");
        }
        if (
          raw.aliases !== undefined &&
          (!Array.isArray(raw.aliases) ||
            raw.aliases.length > 256 ||
            !raw.aliases.every((alias) => isString(alias) && /^[a-f0-9]{64}$/u.test(alias)))
        ) {
          throw stepErr(index, "expect-screen.aliases must be SHA-256 fingerprints");
        }
        out.push({
          kind: "expect-screen",
          screenId: raw.screenId,
          screenTitle: raw.screenTitle,
          fingerprint: raw.fingerprint,
          ...(raw.aliases?.length ? { aliases: [...raw.aliases] as string[] } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "extract": {
        if (!isString(raw.as) || !/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(raw.as)) {
          throw stepErr(index, "extract.as must be a valid variable name");
        }
        const target = parseTarget(raw.target, index, "target");
        if (!target.ref && !target.label && !target.text) {
          throw stepErr(index, "extract target requires ref/label/text");
        }
        if (
          raw.role !== undefined &&
          raw.role !== "user" &&
          raw.role !== "assistant" &&
          raw.role !== "system"
        ) {
          throw stepErr(index, 'extract.role must be "user" | "assistant" | "system"');
        }
        out.push({
          kind: "extract",
          as: raw.as,
          target,
          ...(raw.role ? { role: raw.role } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "assert-content": {
        if (!isString(raw.input) || !raw.input.trim())
          throw stepErr(index, "assert-content.input is required");
        if (!isString(raw.expected))
          throw stepErr(index, "assert-content.expected must be a string");
        if (!["exact", "contains", "not-contains"].includes(String(raw.match))) {
          throw stepErr(
            index,
            'assert-content.match must be "exact" | "contains" | "not-contains"',
          );
        }
        out.push({
          kind: "assert-content",
          input: raw.input,
          expected: raw.expected,
          match: raw.match as "exact" | "contains" | "not-contains",
          ...(note ? { note } : {}),
        });
        break;
      }
      case "evaluate-semantic": {
        if (!isString(raw.input) || !raw.input.trim())
          throw stepErr(index, "evaluate-semantic.input is required");
        if (
          !Array.isArray(raw.criteria) ||
          raw.criteria.length === 0 ||
          !raw.criteria.every(isString)
        ) {
          throw stepErr(index, "evaluate-semantic.criteria must be a non-empty string array");
        }
        if (
          raw.threshold !== undefined &&
          (!isNumber(raw.threshold) || raw.threshold < 0 || raw.threshold > 1)
        ) {
          throw stepErr(index, "evaluate-semantic.threshold must be between 0 and 1");
        }
        if (raw.provider !== undefined && !isString(raw.provider))
          throw stepErr(index, "evaluate-semantic.provider must be a string");
        if (raw.model !== undefined && !isString(raw.model))
          throw stepErr(index, "evaluate-semantic.model must be a string");
        if (raw.requireAgreement !== undefined && typeof raw.requireAgreement !== "boolean")
          throw stepErr(index, "evaluate-semantic.requireAgreement must be a boolean");
        if (raw.secondProvider !== undefined && !isString(raw.secondProvider))
          throw stepErr(index, "evaluate-semantic.secondProvider must be a string");
        if (raw.secondModel !== undefined && !isString(raw.secondModel))
          throw stepErr(index, "evaluate-semantic.secondModel must be a string");
        if (
          raw.requireAgreement === true &&
          (!isString(raw.secondProvider) || !raw.secondProvider.trim())
        )
          throw stepErr(index, "evaluate-semantic.secondProvider is required for agreement");
        out.push({
          kind: "evaluate-semantic",
          input: raw.input,
          criteria: raw.criteria,
          ...(raw.threshold !== undefined ? { threshold: raw.threshold } : {}),
          ...(isString(raw.provider) ? { provider: raw.provider } : {}),
          ...(isString(raw.model) ? { model: raw.model } : {}),
          ...(raw.requireAgreement === true ? { requireAgreement: true } : {}),
          ...(isString(raw.secondProvider) ? { secondProvider: raw.secondProvider } : {}),
          ...(isString(raw.secondModel) ? { secondModel: raw.secondModel } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "pause": {
        if (!isString(raw.message)) throw stepErr(index, "pause requires message: string");
        const reasons: HumanCheckpointReason[] = [
          "authentication",
          "consent",
          "verification",
          "captcha",
          "permission",
          "review",
          "other",
        ];
        if (raw.reason !== undefined && !reasons.includes(raw.reason as HumanCheckpointReason)) {
          throw stepErr(index, "pause.reason is invalid");
        }
        if (raw.resumeLabel !== undefined && !isString(raw.resumeLabel)) {
          throw stepErr(index, "pause.resumeLabel must be a string");
        }
        if (
          raw.timeoutMs !== undefined &&
          (!isNumber(raw.timeoutMs) ||
            !Number.isInteger(raw.timeoutMs) ||
            raw.timeoutMs < 1_000 ||
            raw.timeoutMs > 86_400_000)
        ) {
          throw stepErr(index, "pause.timeoutMs must be an integer from 1000 to 86400000");
        }
        let verifyAfter: Extract<RecipeStep, { kind: "pause" }>["verifyAfter"];
        if (raw.verifyAfter !== undefined) {
          if (!isObject(raw.verifyAfter)) {
            throw stepErr(index, "pause.verifyAfter must be an object");
          }
          const target = parseTarget(raw.verifyAfter.target, index, "pause.verifyAfter.target");
          if (!target.ref && !target.label && !target.text) {
            throw stepErr(index, "pause.verifyAfter.target must have ref, label, or text");
          }
          if (
            raw.verifyAfter.condition !== undefined &&
            raw.verifyAfter.condition !== "visible" &&
            raw.verifyAfter.condition !== "gone"
          ) {
            throw stepErr(index, 'pause.verifyAfter.condition must be "visible" or "gone"');
          }
          if (
            raw.verifyAfter.timeoutMs !== undefined &&
            (!isNumber(raw.verifyAfter.timeoutMs) ||
              !Number.isInteger(raw.verifyAfter.timeoutMs) ||
              raw.verifyAfter.timeoutMs < 1_000 ||
              raw.verifyAfter.timeoutMs > 900_000)
          ) {
            throw stepErr(
              index,
              "pause.verifyAfter.timeoutMs must be an integer from 1000 to 900000",
            );
          }
          verifyAfter = {
            target,
            ...(raw.verifyAfter.condition === "gone" ? { condition: "gone" as const } : {}),
            ...(isNumber(raw.verifyAfter.timeoutMs)
              ? { timeoutMs: raw.verifyAfter.timeoutMs }
              : {}),
          };
        }
        const step: Extract<RecipeStep, { kind: "pause" }> = {
          kind: "pause",
          message: raw.message,
          ...(reasons.includes(raw.reason as HumanCheckpointReason)
            ? { reason: raw.reason as HumanCheckpointReason }
            : {}),
          ...(isString(raw.resumeLabel) && raw.resumeLabel.trim()
            ? { resumeLabel: raw.resumeLabel.trim() }
            : {}),
          ...(isNumber(raw.timeoutMs) ? { timeoutMs: raw.timeoutMs } : {}),
          ...(verifyAfter ? { verifyAfter } : {}),
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
        let bindings: Record<string, string> | undefined;
        if (raw.bindings !== undefined) {
          if (!isObject(raw.bindings)) throw stepErr(index, "module.bindings must be a mapping");
          bindings = {};
          for (const [name, value] of Object.entries(raw.bindings)) {
            if (!PARAMETER_NAME.test(name))
              throw stepErr(index, `module.bindings.${name} is invalid`);
            if (!isString(value)) throw stepErr(index, `module.bindings.${name} must be a string`);
            bindings[name] = value;
          }
        }
        out.push({
          kind: "module",
          recipeId: raw.recipeId,
          ...(bindings && Object.keys(bindings).length ? { bindings } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "branch": {
        if (!isString(raw.input) || !raw.input.trim())
          throw stepErr(index, "branch.input is required");
        if (!["exists", "equals", "not-equals", "contains"].includes(String(raw.operator)))
          throw stepErr(index, "branch.operator is invalid");
        if (!isString(raw.thenRecipeId) || !raw.thenRecipeId.trim())
          throw stepErr(index, "branch.thenRecipeId is required");
        if (raw.elseRecipeId !== undefined && !isString(raw.elseRecipeId))
          throw stepErr(index, "branch.elseRecipeId must be a string");
        if (raw.operator !== "exists" && !isString(raw.expected))
          throw stepErr(index, "branch.expected is required for this operator");
        out.push({
          kind: "branch",
          input: raw.input,
          operator: raw.operator as "exists" | "equals" | "not-equals" | "contains",
          ...(isString(raw.expected) ? { expected: raw.expected } : {}),
          thenRecipeId: raw.thenRecipeId,
          ...(isString(raw.elseRecipeId) && raw.elseRecipeId.trim()
            ? { elseRecipeId: raw.elseRecipeId }
            : {}),
          ...(note ? { note } : {}),
        });
        break;
      }
      case "repeat": {
        if (!isNumber(raw.count) || !Number.isInteger(raw.count) || raw.count < 1 || raw.count > 20)
          throw stepErr(index, "repeat.count must be an integer from 1 to 20");
        if (!isString(raw.recipeId) || !raw.recipeId.trim())
          throw stepErr(index, "repeat.recipeId is required");
        out.push({
          kind: "repeat",
          count: raw.count,
          recipeId: raw.recipeId,
          ...(note ? { note } : {}),
        });
        break;
      }
      case "script": {
        if (!isString(raw.source) || !raw.source.trim())
          throw stepErr(index, "script.source is required");
        if (raw.source.length > 20_000) throw stepErr(index, "script.source is too large");
        out.push({ kind: "script", source: raw.source, ...(note ? { note } : {}) });
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
        const actions = [
          "open",
          "close",
          "switcher",
          "inspect",
          "assert-installed",
          "assert-not-installed",
          "install",
          "update",
          "uninstall",
        ] as const;
        if (!actions.includes(raw.action as (typeof actions)[number]))
          throw stepErr(index, "app has an invalid action");
        if (raw.app !== undefined && !isString(raw.app))
          throw stepErr(index, "app.app must be a string");
        if (raw.url !== undefined && !isString(raw.url))
          throw stepErr(index, "app.url must be a string");
        if (raw.artifact !== undefined && !isString(raw.artifact))
          throw stepErr(index, "app.artifact must be a string");
        if (
          raw.as !== undefined &&
          (!isString(raw.as) || !/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(raw.as))
        )
          throw stepErr(index, "app.as must be a valid variable name");
        if (raw.version !== undefined && !isString(raw.version))
          throw stepErr(index, "app.version must be a string");
        if (
          raw.versionMatch !== undefined &&
          raw.versionMatch !== "exact" &&
          raw.versionMatch !== "contains"
        )
          throw stepErr(index, 'app.versionMatch must be "exact" | "contains"');
        if (raw.action === "open" && !isString(raw.app) && !isString(raw.url))
          throw stepErr(index, "app open requires app or url");
        if (
          raw.action !== "open" &&
          raw.action !== "switcher" &&
          (!isString(raw.app) || !raw.app.trim())
        ) {
          throw stepErr(index, `${raw.action} requires app package or bundle identifier`);
        }
        if (
          (raw.action === "install" || raw.action === "update") &&
          (!isString(raw.artifact) || !raw.artifact.trim())
        ) {
          throw stepErr(index, `${raw.action} requires a local APK artifact path`);
        }
        if (raw.action === "assert-not-installed" && raw.version !== undefined) {
          throw stepErr(index, "assert-not-installed cannot include a version");
        }
        out.push({
          kind: "app",
          action: raw.action as Extract<RecipeStep, { kind: "app" }>["action"],
          ...(isString(raw.app) ? { app: raw.app } : {}),
          ...(isString(raw.url) ? { url: raw.url } : {}),
          ...(isString(raw.artifact) ? { artifact: raw.artifact } : {}),
          ...(isString(raw.as) ? { as: raw.as } : {}),
          ...(isString(raw.version) ? { version: raw.version } : {}),
          ...(raw.versionMatch === "exact" || raw.versionMatch === "contains"
            ? { versionMatch: raw.versionMatch }
            : {}),
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
  return out.map((step, position) => ({
    ...step,
    ...parseStepMetadata(steps[position] as Record<string, unknown>, position + 1),
  }));
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

async function readStoredRecipe(id: string): Promise<Recipe | null> {
  return readYamlRecipeFile(recipeYamlPath(testsRoot(), id));
}

/** Packaged flows and YAML recipes share one editable catalog. A YAML entry with
 * the same id overrides its packaged default. */
export async function listRecipes(): Promise<Recipe[]> {
  const builtins = builtinRecipes();
  const yamlRecipes = new Map<string, Recipe>();
  for (const path of await listYamlRecipeFiles(testsRoot())) {
    try {
      const recipe = await readYamlRecipeFile(path);
      if (recipe) yamlRecipes.set(recipe.id, recipe);
    } catch {
      /* Invalid YAML is surfaced on direct open/import, but must not break the library. */
    }
  }
  const customs = new Map<string, Recipe>();
  const overrides = new Map<string, Recipe>();
  for (const [id, recipe] of yamlRecipes) {
    if (isActionId(id)) overrides.set(id, recipe);
    else customs.set(id, recipe);
  }
  const customList = [...customs.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const included = builtins.map((recipe) => overrides.get(recipe.id) ?? recipe);
  return [...included, ...customList];
}

export async function readRecipe(id: string): Promise<Recipe | null> {
  const stored = await readStoredRecipe(id);
  if (stored) return stored;
  const builtin = builtinRecipes().find((r) => r.id === id);
  if (builtin) return builtin;
  return null;
}

export type FrozenRecipeGraph = Record<string, Recipe>;

/** Resolve every reusable-flow dependency before a job enters the queue. */
export async function freezeRecipeGraph(root: Recipe): Promise<FrozenRecipeGraph> {
  const graph: FrozenRecipeGraph = { [root.id]: structuredClone(root) };
  const visiting = new Set<string>();

  const dependencies = (recipe: Recipe): string[] =>
    recipe.steps.flatMap((step) => {
      if (step.kind === "module" || step.kind === "repeat") return [step.recipeId];
      if (step.kind === "branch") {
        return [step.thenRecipeId, ...(step.elseRecipeId ? [step.elseRecipeId] : [])];
      }
      return [];
    });

  async function visit(recipe: Recipe, path: string[]): Promise<void> {
    if (visiting.has(recipe.id)) {
      throw new Error(`reusable test cycle: ${[...path, recipe.id].join(" → ")}`);
    }
    visiting.add(recipe.id);
    for (const dependencyId of dependencies(recipe)) {
      const existing = graph[dependencyId];
      const dependency = existing ?? (await readRecipe(dependencyId));
      if (!dependency) {
        throw new Error(`reusable test not found: ${dependencyId}`);
      }
      if (!existing) graph[dependencyId] = structuredClone(dependency);
      await visit(dependency, [...path, recipe.id]);
    }
    visiting.delete(recipe.id);
  }

  await visit(root, []);
  return graph;
}

export async function freezeRecipeExecution(recipeId: string): Promise<{
  recipeSnapshot: Recipe;
  recipeGraph: FrozenRecipeGraph;
}> {
  const recipeSnapshot = await readRecipe(recipeId);
  if (!recipeSnapshot) throw new Error(`recipe not found: ${recipeId}`);
  return {
    recipeSnapshot: structuredClone(recipeSnapshot),
    recipeGraph: await freezeRecipeGraph(recipeSnapshot),
  };
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

async function ensureTestsRoot(): Promise<void> {
  await mkdir(testsRoot(), { recursive: true });
}

export type SaveRecipeInput = {
  id?: string;
  expectedRevision: number;
  title: string;
  description?: string;
  variables?: Record<string, string>;
  parameters?: RecipeParameter[];
  steps: RecipeStep[];
  quarantined?: boolean;
  quarantineReason?: string;
  recordingFormatVersion?: RecordingFormatVersion;
};

const recipeWrites = new KeyedSerialQueue();
const recipeIdempotency = new BoundedIdempotencyStore<Recipe>();

function recipeConflict(current: Recipe | null): RevisionConflict<Recipe | null> {
  const revision = current?.updatedAt ?? 0;
  const snapshot: Revisioned<Recipe | null> = {
    revision,
    value: current,
    updatedAt: revision,
    ...(currentOperationContext()?.actorId
      ? { updatedBy: currentOperationContext()!.actorId }
      : {}),
  };
  return new RevisionConflict(snapshot);
}

/**
 * Create or overwrite a recipe. Packaged ids are persisted as user overrides,
 * so every catalog item has the same edit semantics.
 */
async function saveRecipeUnchecked(input: SaveRecipeInput): Promise<Recipe> {
  const steps = validateRecipeSteps(input.steps);
  const variables = validateRecipeVariables(input.variables ?? undefined);
  const parameters = validateRecipeParameters(input.parameters ?? undefined);
  if (!isString(input.title) || input.title.trim().length === 0) {
    throw new Error("title is required");
  }
  const requestedAt = now();
  let id = input.id?.trim();
  if (!id) {
    id = `custom-${slugify(input.title)}-${requestedAt.toString(36)}`;
  }
  // If overwriting, preserve createdAt.
  const stored = await readStoredRecipe(id);
  const existing = stored;
  const ts = Math.max(requestedAt, (existing?.updatedAt ?? 0) + 1);
  const quarantineReason = input.quarantineReason ?? existing?.quarantineReason;
  const recipe: Recipe = {
    id,
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.variables !== undefined
      ? variables
        ? { variables }
        : {}
      : existing?.variables
        ? { variables: existing.variables }
        : {}),
    ...(input.parameters !== undefined
      ? parameters
        ? { parameters }
        : {}
      : existing?.parameters
        ? { parameters: existing.parameters }
        : {}),
    source: "custom",
    recordingFormatVersion:
      input.recordingFormatVersion ??
      existing?.recordingFormatVersion ??
      CURRENT_RECORDING_FORMAT_VERSION,
    steps,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
    ...((input.quarantined ?? existing?.quarantined) ? { quarantined: true } : {}),
    ...(quarantineReason?.trim() ? { quarantineReason: quarantineReason.trim() } : {}),
  };
  await ensureRecipesRoot();
  await ensureTestsRoot();
  if (existing) {
    const historyDir = join(recipesRoot(), ".history", id);
    await mkdir(historyDir, { recursive: true });
    await writeFile(
      join(historyDir, `${existing.updatedAt}.relay.yaml`),
      formatRecipeYaml(existing),
      { encoding: "utf8", flag: "wx" },
    ).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    });
    const historyLimit = Math.max(1, Number(process.env.RELAY_RECIPE_HISTORY_LIMIT ?? 100));
    const historyFiles = (await readdir(historyDir)).sort().reverse();
    await Promise.all(
      historyFiles
        .slice(historyLimit)
        .map((file) => unlink(join(historyDir, file)).catch(() => undefined)),
    );
  }
  const destination = recipeYamlPath(testsRoot(), id);
  await atomicWriteFile(destination, formatRecipeYaml(recipe));
  const persisted = await stat(destination);
  recipe.updatedAt = persisted.mtimeMs;
  return recipe;
}

export async function saveRecipe(input: SaveRecipeInput): Promise<Recipe> {
  const operation = currentOperationContext();
  const fingerprint = payloadFingerprint(input);
  const requestedId = input.id?.trim();
  const generatedSuffix = operation
    ? payloadFingerprint({
        organizationId: operation.organizationId,
        projectId: operation.projectId,
        operationId: operation.operationId,
        idempotencyKey: operation.idempotencyKey,
      }).slice(0, 12)
    : `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const id = requestedId || `custom-${slugify(input.title)}-${generatedSuffix}`;
  const normalizedInput = { ...input, id };
  const resourceIdentity = `${testsRoot()}:${requestedId ?? `create:${operation?.idempotencyKey ?? id}`}`;
  const queueKey = `${operation?.organizationId ?? "local"}\u0000${operation?.projectId ?? "default"}\u0000recipe\u0000${resourceIdentity}`;
  const replayKey = operation
    ? scopedIdempotencyKey({
        organizationId: operation.organizationId,
        projectId: operation.projectId,
        operationId: operation.operationId,
        idempotencyKey: operation.idempotencyKey,
        resourceKind: "recipe",
        resourceId: resourceIdentity,
      })
    : undefined;
  return recipeWrites.run(queueKey, async () => {
    const replay = replayKey ? recipeIdempotency.get(replayKey, fingerprint) : undefined;
    if (replay) return structuredClone(replay);
    const current = await readRecipe(id);
    const revision = current?.updatedAt ?? 0;
    if (normalizedInput.expectedRevision !== revision) {
      throw recipeConflict(current);
    }
    const saved = await saveRecipeUnchecked(normalizedInput);
    publish({
      type: current ? "resource.updated" : "resource.created",
      at: saved.updatedAt,
      projectId: currentOperationContext()?.projectId ?? "default",
      resource: "recipe",
      resourceId: saved.id,
      revision: saved.updatedAt,
    });
    if (replayKey) recipeIdempotency.set(replayKey, fingerprint, saved);
    return saved;
  });
}

export async function listRecipeHistory(id: string): Promise<Recipe[]> {
  const dir = join(recipesRoot(), ".history", evidencePart(id, "recipeId"));
  try {
    const entries = (await readdir(dir))
      .filter((file) => file.endsWith(".relay.yaml"))
      .sort()
      .reverse();
    const versions: Recipe[] = [];
    for (const file of entries.slice(0, 50)) {
      const parsed = await readYamlRecipeFile(join(dir, file));
      if (parsed) versions.push(parsed);
    }
    return versions;
  } catch {
    return [];
  }
}

export async function restoreRecipeHistory(id: string, updatedAt: number): Promise<Recipe> {
  const versions = await listRecipeHistory(id);
  const version = versions.find((item) => item.updatedAt === updatedAt);
  if (!version) throw new Error("recipe version not found");
  const current = await readRecipe(id);
  return saveRecipe({
    id,
    title: version.title,
    description: version.description,
    variables: version.variables,
    parameters: version.parameters,
    steps: version.steps,
    quarantined: version.quarantined,
    quarantineReason: version.quarantineReason,
    expectedRevision: current?.updatedAt ?? 0,
  });
}

/** Delete a custom recipe or packaged override. Packaged defaults are immutable
 * runtime primitives and reappear when their YAML override is removed. */
export async function deleteRecipe(id: string): Promise<void> {
  await ensureRecipesRoot();
  await ensureTestsRoot();
  await rm(evidenceDir(id), { recursive: true, force: true });
  const yamlPath = recipeYamlPath(testsRoot(), id);
  await unlink(yamlPath).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  });
  publish({
    type: "resource.deleted",
    at: now(),
    projectId: currentOperationContext()?.projectId ?? "default",
    resource: "recipe",
    resourceId: id,
  });
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
      return `${step.gesture === "multi" ? `${step.tapCount ?? 2} taps` : step.gesture === "hold" ? "Hold" : "Tap"} ${describeTarget(step.target)}`;
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
    case "wait-response":
      return `Wait for ${describeTarget(step.target)} to finish responding`;
    case "expect":
      return `check ${describeExpectTarget(step.target)} ${step.condition}`;
    case "expect-screen":
      return `Reach ${step.screenTitle}`;
    case "extract":
      return `Extract ${describeTarget(step.target)} as ${step.as}`;
    case "assert-content":
      return `Check ${step.input} ${step.match} ${JSON.stringify(step.expected)}`;
    case "evaluate-semantic":
      return `Evaluate ${step.input} against ${step.criteria.length} criterion${step.criteria.length === 1 ? "" : "s"}`;
    case "pause":
      return step.reason
        ? `Wait for human (${step.reason}): ${step.message}`
        : `Pause: ${step.message}`;
    case "screenshot":
      return step.caption ? `Screenshot · ${step.caption}` : "Screenshot";
    case "flow":
      return `Flow: ${step.flow}`;
    case "module":
      return `Run reusable test: ${step.recipeId}`;
    case "branch":
      return `Branch when ${step.input} ${step.operator}${step.expected ? ` ${JSON.stringify(step.expected)}` : ""}`;
    case "repeat":
      return `Repeat ${step.recipeId} ${step.count}×`;
    case "script":
      return "Transform test variables";
    case "clipboard":
      return step.action === "write"
        ? "Set clipboard text"
        : step.expect !== undefined
          ? "Check clipboard text"
          : "Read clipboard text";
    case "app":
      if (step.action === "switcher") return "Open app switcher";
      if (step.action === "inspect") return `Record installed version of ${step.app}`;
      if (step.action === "assert-installed")
        return `Check ${step.app} is installed${step.version ? ` (${step.version})` : ""}`;
      if (step.action === "assert-not-installed") return `Check ${step.app} is not installed`;
      if (step.action === "install" || step.action === "update")
        return `${step.action === "install" ? "Install" : "Update"} ${step.app} from APK`;
      if (step.action === "uninstall") return `Uninstall ${step.app}`;
      return `${step.action === "open" ? "Open" : "Close"} ${step.app ?? step.url ?? "app"}`;
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
    case "wait-response":
      return ["ai", "wait"];
    case "expect":
      return ["ok"];
    case "expect-screen":
      return ["ok"];
    case "extract":
      return ["store"];
    case "assert-content":
    case "evaluate-semantic":
      return ["ai", "ok"];
    case "pause":
      return ["wait"];
    case "screenshot":
      return ["shot"];
    case "flow":
      return ["store"];
    case "module":
      return ["re", "store"];
    case "branch":
      return ["re", "ai"];
    case "repeat":
      return ["re", "wait"];
    case "script":
      return ["type", "store"];
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
