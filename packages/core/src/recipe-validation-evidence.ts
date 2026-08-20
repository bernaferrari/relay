/** Parse durable recorded selectors and pixels without coupling them to step kinds. */
import type {
  RecordedNodeEvidence,
  RecordedSelectorCandidate,
  RecordedStepEvidence,
} from "@relay/protocol";
import {
  isNumber,
  isObject,
  isString,
  parsePoint,
  parseTarget,
  stepErr,
} from "./recipe-validation-primitives.js";

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

export function parseRecordedEvidence(
  raw: unknown,
  index: number,
): RecordedStepEvidence | undefined {
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
      if (
        !(["identifier", "ref", "label", "text", "point"] as unknown[]).includes(candidate.strategy)
      ) {
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
