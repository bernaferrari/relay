import { resolveStepPoint } from "@relay/protocol";
import type {
  AuthoringObservation,
  ConnectionSourceAnchor,
  RecipeStep,
  StepPoint,
  StepTarget,
} from "@relay/protocol";

type SourceViewport = { width: number; height: number };

function sourceViewport(value: unknown): SourceViewport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.width !== "number" ||
    typeof candidate.height !== "number" ||
    !Number.isFinite(candidate.width) ||
    !Number.isFinite(candidate.height) ||
    candidate.width <= 0 ||
    candidate.height <= 0
  ) {
    return undefined;
  }
  return { width: candidate.width, height: candidate.height };
}

function normalizedStepPoint(
  point: StepPoint | undefined,
  viewport: SourceViewport,
): ConnectionSourceAnchor["point"] | undefined {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  if (point.referenceBounds && !sourceViewport(point.referenceBounds)) return undefined;
  const resolved = resolveStepPoint(point, viewport);
  if (!Number.isFinite(resolved.x) || !Number.isFinite(resolved.y)) return undefined;
  return {
    x: Math.max(0, Math.min(viewport.width, resolved.x)) / viewport.width,
    y: Math.max(0, Math.min(viewport.height, resolved.y)) / viewport.height,
  };
}

function normalizedSourceRect(
  value: unknown,
  viewport: SourceViewport,
): ConnectionSourceAnchor["rect"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rect = value as Record<string, unknown>;
  if (
    typeof rect.x !== "number" ||
    typeof rect.y !== "number" ||
    typeof rect.width !== "number" ||
    typeof rect.height !== "number" ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height)
  ) {
    return undefined;
  }
  const left = Math.max(0, Math.min(viewport.width, rect.x));
  const top = Math.max(0, Math.min(viewport.height, rect.y));
  const right = Math.max(left, Math.min(viewport.width, rect.x + rect.width));
  const bottom = Math.max(top, Math.min(viewport.height, rect.y + rect.height));
  if (right === left || bottom === top) return undefined;
  return {
    x: left / viewport.width,
    y: top / viewport.height,
    width: (right - left) / viewport.width,
    height: (bottom - top) / viewport.height,
  };
}

function nodeText(node: Record<string, unknown>, field: string): string | undefined {
  const value = node[field];
  return typeof value === "string" ? value : undefined;
}

function sourceNodeForTarget(
  nodes: readonly Record<string, unknown>[] | undefined,
  target: StepTarget,
): Record<string, unknown> | undefined {
  if (!nodes?.length) return undefined;
  const firstMatch = (value: string | undefined, fields: readonly string[]) =>
    value === undefined
      ? undefined
      : nodes.find((node) => fields.some((field) => nodeText(node, field) === value));
  return (
    firstMatch(target.identifier, ["identifier"]) ??
    firstMatch(target.ref, ["ref"]) ??
    firstMatch(target.label, ["label", "value"]) ??
    firstMatch(target.text, ["value", "label"])
  );
}

function sourceAnchorForTap(
  step: Extract<RecipeStep, { kind: "tap" }>,
  before?: AuthoringObservation,
): ConnectionSourceAnchor | undefined {
  const capturedViewport = sourceViewport(before?.bounds);
  const pointViewport = capturedViewport ?? sourceViewport(step.target.point?.referenceBounds);
  const rect = capturedViewport
    ? normalizedSourceRect(sourceNodeForTarget(before?.nodes, step.target)?.rect, capturedViewport)
    : undefined;
  const point = pointViewport ? normalizedStepPoint(step.target.point, pointViewport) : undefined;
  const fallbackPoint = rect
    ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    : undefined;
  if (!point && !fallbackPoint) return undefined;
  return {
    point: point ?? fallbackPoint!,
    ...(rect ? { rect } : {}),
  };
}

function sourceAnchorForSwipe(
  step: Extract<RecipeStep, { kind: "swipe" }>,
  before?: AuthoringObservation,
): ConnectionSourceAnchor | undefined {
  const viewport =
    sourceViewport(before?.bounds) ??
    sourceViewport(step.from.referenceBounds) ??
    sourceViewport(step.to.referenceBounds);
  const point = viewport ? normalizedStepPoint(step.from, viewport) : undefined;
  return point ? { point } : undefined;
}

/** Preserve the first source-side interaction as immutable connection evidence. */
export function recordedSourceAnchor(input: {
  actions: readonly { steps: readonly RecipeStep[] }[];
  before?: AuthoringObservation;
}): ConnectionSourceAnchor | undefined {
  for (const step of input.actions.flatMap((action) => action.steps)) {
    const anchor =
      step.kind === "tap"
        ? sourceAnchorForTap(step, input.before)
        : step.kind === "swipe"
          ? sourceAnchorForSwipe(step, input.before)
          : undefined;
    if (anchor) return anchor;
  }
  return undefined;
}
