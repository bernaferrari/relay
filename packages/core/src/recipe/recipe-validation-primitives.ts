/** Shared structural parsers used by recipe-step and evidence validation. */
import type {
  HorizontalCoordinateAnchor,
  StepPoint,
  StepTarget,
  VerticalCoordinateAnchor,
} from "@relay/protocol";

export const MAX_WAIT_MS = 15 * 60 * 1000;

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function isString(v: unknown): v is string {
  return typeof v === "string";
}

export function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function stepErr(index: number, why: string): Error {
  return new Error(`step ${index}: ${why}`);
}

export function targetHasStrategy(target: StepTarget): boolean {
  return Boolean(
    target.identifier ||
    target.ref ||
    target.label ||
    target.text ||
    target.relation ||
    target.point,
  );
}

export function parseTarget(raw: unknown, index: number, field: string): StepTarget {
  if (!isObject(raw)) throw stepErr(index, `${field} must be an object`);
  assertKnownKeys(
    raw,
    ["identifier", "ref", "label", "role", "text", "relation", "point"],
    index,
    field,
  );
  const target: StepTarget = {};
  if (raw.identifier !== undefined) {
    if (!isString(raw.identifier)) throw stepErr(index, `${field}.identifier must be a string`);
    target.identifier = raw.identifier;
  }
  if (raw.ref !== undefined) {
    if (!isString(raw.ref)) throw stepErr(index, `${field}.ref must be a string`);
    target.ref = raw.ref;
  }
  if (raw.label !== undefined) {
    if (!isString(raw.label)) throw stepErr(index, `${field}.label must be a string`);
    target.label = raw.label;
  }
  if (raw.role !== undefined) {
    if (!isString(raw.role)) throw stepErr(index, `${field}.role must be a string`);
    target.role = raw.role;
  }
  if (raw.text !== undefined) {
    if (!isString(raw.text)) throw stepErr(index, `${field}.text must be a string`);
    target.text = raw.text;
  }
  if (raw.relation !== undefined) {
    if (!isObject(raw.relation)) throw stepErr(index, `${field}.relation must be an object`);
    assertKnownKeys(raw.relation, ["kind", "anchor"], index, `${field}.relation`);
    if (raw.relation.kind !== "following-row") {
      throw stepErr(index, `${field}.relation.kind must be following-row`);
    }
    const anchor = parseTarget(raw.relation.anchor, index, `${field}.relation.anchor`);
    if (anchor.point || anchor.relation) {
      throw stepErr(index, `${field}.relation.anchor must be a non-relative semantic target`);
    }
    if (!anchor.identifier && !anchor.ref && !anchor.label && !anchor.text) {
      throw stepErr(index, `${field}.relation.anchor must contain a semantic selector`);
    }
    target.relation = { kind: "following-row", anchor };
  }
  if (raw.point !== undefined) {
    target.point = parseStepPoint(raw.point, index, `${field}.point`);
  }
  return target;
}

/** Parse an authored point with its optional responsive pin-to constraint. */
export function parseStepPoint(raw: unknown, index: number, field: string): StepPoint {
  if (!isObject(raw) || !isNumber(raw.x) || !isNumber(raw.y)) {
    throw stepErr(index, `${field} must be { x: number, y: number }`);
  }
  assertKnownKeys(
    raw,
    ["x", "y", "fallbackPolicy", "anchor", "referenceBounds", "relativeTo"],
    index,
    field,
  );
  const point: StepPoint = { x: raw.x, y: raw.y };
  if (raw.fallbackPolicy !== undefined) {
    if (raw.fallbackPolicy !== "reviewed") {
      throw stepErr(index, `${field}.fallbackPolicy must be reviewed`);
    }
    point.fallbackPolicy = "reviewed";
  }
  if (raw.anchor !== undefined) {
    if (!isObject(raw.anchor)) {
      throw stepErr(index, `${field}.anchor must contain horizontal and vertical anchors`);
    }
    assertKnownKeys(raw.anchor, ["horizontal", "vertical"], index, `${field}.anchor`);
    if (
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
    if (!isObject(raw.referenceBounds)) {
      throw stepErr(index, `${field}.referenceBounds must be { width, height }`);
    }
    assertKnownKeys(raw.referenceBounds, ["width", "height"], index, `${field}.referenceBounds`);
    if (
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
  if (raw.relativeTo !== undefined) {
    if (!isObject(raw.relativeTo)) {
      throw stepErr(
        index,
        `${field}.relativeTo must contain a semantic target and xRatio/yRatio between 0 and 1`,
      );
    }
    assertKnownKeys(raw.relativeTo, ["target", "xRatio", "yRatio"], index, `${field}.relativeTo`);
    if (
      !isObject(raw.relativeTo.target) ||
      !isNumber(raw.relativeTo.xRatio) ||
      !isNumber(raw.relativeTo.yRatio) ||
      raw.relativeTo.xRatio < 0 ||
      raw.relativeTo.xRatio > 1 ||
      raw.relativeTo.yRatio < 0 ||
      raw.relativeTo.yRatio > 1
    ) {
      throw stepErr(
        index,
        `${field}.relativeTo must contain a semantic target and xRatio/yRatio between 0 and 1`,
      );
    }
    const target = parseTarget(raw.relativeTo.target, index, `${field}.relativeTo.target`);
    if (target.point) {
      throw stepErr(index, `${field}.relativeTo.target cannot contain a point`);
    }
    if (!target.identifier && !target.ref && !target.label && !target.text) {
      throw stepErr(index, `${field}.relativeTo.target must contain a semantic selector`);
    }
    point.relativeTo = {
      target,
      xRatio: raw.relativeTo.xRatio,
      yRatio: raw.relativeTo.yRatio,
    };
  }
  return point;
}

function assertKnownKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  index: number,
  field: string,
): void {
  const known = new Set<string>(allowed);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw stepErr(index, `${field} unknown field: ${key}`);
  }
}

/** Parse a required { x, y } coordinate object. */
export function parsePoint(raw: unknown, index: number, field: string): { x: number; y: number } {
  if (!isObject(raw) || !isNumber(raw.x) || !isNumber(raw.y)) {
    throw stepErr(index, `${field} must be { x: number, y: number }`);
  }
  return { x: raw.x, y: raw.y };
}
