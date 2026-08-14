import type {
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

const MAX_WAIT_MS = 15 * 60 * 1000;

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
  return Boolean(t.identifier || t.ref || t.label || t.text || t.point);
}

function stepErr(index: number, why: string): Error {
  return new Error(`step ${index}: ${why}`);
}

function parseTarget(raw: unknown, index: number, field: string): StepTarget {
  if (!isObject(raw)) throw stepErr(index, `${field} must be an object`);
  const t: StepTarget = {};
  if (raw.identifier !== undefined) {
    if (!isString(raw.identifier)) throw stepErr(index, `${field}.identifier must be a string`);
    t.identifier = raw.identifier;
  }
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

function parseStepMetadata(
  raw: Record<string, unknown>,
  index: number,
): {
  id?: string;
  group?: string;
  evidence?: RecordedStepEvidence;
  note?: string;
  optional?: boolean;
  when?: RecipeStep["when"];
} {
  const metadata: {
    id?: string;
    group?: string;
    evidence?: RecordedStepEvidence;
    note?: string;
    optional?: boolean;
    when?: RecipeStep["when"];
  } = {};
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
  if (raw.optional !== undefined) {
    if (typeof raw.optional !== "boolean") throw stepErr(index, "optional must be a boolean");
    metadata.optional = raw.optional;
  }
  if (raw.when !== undefined) {
    if (!isObject(raw.when)) throw stepErr(index, "when must be an object");
    if (!(raw.when.condition === "present" || raw.when.condition === "absent")) {
      throw stepErr(index, 'when.condition must be "present" or "absent"');
    }
    const target = parseTarget(raw.when.target, index, "when.target");
    if (!target.identifier && !target.ref && !target.label && !target.text) {
      throw stepErr(index, "when.target must contain identifier, ref, label, or text");
    }
    let region: NonNullable<RecipeStep["when"]>["region"];
    if (raw.when.region !== undefined) {
      if (!isObject(raw.when.region)) throw stepErr(index, "when.region must be an object");
      const parsed: NonNullable<RecipeStep["when"]>["region"] = {};
      for (const key of ["minX", "maxX", "minY", "maxY"] as const) {
        const value = raw.when.region[key];
        if (value === undefined) continue;
        if (!isNumber(value) || value < 0 || value > 1) {
          throw stepErr(index, `when.region.${key} must be between 0 and 1`);
        }
        parsed[key] = value;
      }
      if (parsed.minX !== undefined && parsed.maxX !== undefined && parsed.minX >= parsed.maxX) {
        throw stepErr(index, "when.region.minX must be less than maxX");
      }
      if (parsed.minY !== undefined && parsed.maxY !== undefined && parsed.minY >= parsed.maxY) {
        throw stepErr(index, "when.region.minY must be less than maxY");
      }
      region = parsed;
    }
    metadata.when = {
      target,
      condition: raw.when.condition,
      ...(region ? { region } : {}),
    };
  }
  return metadata;
}

/**
 * Validate an unknown steps array field-by-field. Throws `Error` naming the
 * first invalid step index and why. Returns the narrowed `RecipeStep[]`.
 */

export {
  MAX_WAIT_MS,
  PARAMETER_NAME,
  isNumber,
  isObject,
  isString,
  parsePoint,
  parseRecordedEvidence,
  parseStepMetadata,
  parseStepPoint,
  parseTarget,
  stepErr,
  targetHasStrategy,
};
