import type { RecipeStep, RecordedStepEvidence, StepTarget } from "./api-types";

/** Compiler-generated destination checks are intrinsic to graph edges and are
 * intentionally absent from the manual action picker. */
/** Action kinds that can be edited before a Take is committed. */
export type EditableActionKind = Exclude<
  RecipeStep["kind"],
  "expect-screen" | "capture-surface" | "tour" | "reveal"
>;

export type TapGesture = "single" | "multi" | "hold";

export const FALLBACK_DEVICE_BOUNDS = { width: 1_080, height: 2_400 } as const;

export function defaultTapTarget(
  bounds: { width: number; height: number } = FALLBACK_DEVICE_BOUNDS,
): StepTarget {
  return {
    point: {
      x: Math.round(bounds.width / 2),
      y: Math.round(bounds.height / 2),
      referenceBounds: { ...bounds },
    },
  };
}

export function createTapStep(): Extract<RecipeStep, { kind: "tap" }> {
  return { kind: "tap", target: defaultTapTarget() };
}

export function isTapAction(step: RecipeStep): step is Extract<RecipeStep, { kind: "tap" }> {
  return step.kind === "tap";
}

export function tapGesture(step: RecipeStep): TapGesture {
  if (step.kind !== "tap") return "single";
  return step.gesture ?? "single";
}

function evidenceFrom(step: RecipeStep): RecordedStepEvidence | undefined {
  return step.evidence;
}

function targetFrom(step: RecipeStep): StepTarget {
  if ("target" in step && step.target) return step.target;
  if (step.kind === "assert-layout") return step.first;
  const evidence = evidenceFrom(step);
  if (step.kind === "swipe") {
    return {
      point: {
        ...step.from,
        ...(evidence?.deviceBounds ? { referenceBounds: { ...evidence.deviceBounds } } : {}),
      },
    };
  }
  return (
    evidence?.candidates?.[0]?.target ?? (evidence?.pointer ? { point: evidence.pointer } : {})
  );
}

function hasTarget(target: StepTarget): boolean {
  return Boolean(target.identifier || target.ref || target.label || target.text || target.point);
}

function swipePoints(
  target: StepTarget,
  evidence: RecordedStepEvidence | undefined,
): {
  from: NonNullable<StepTarget["point"]>;
  to: NonNullable<StepTarget["point"]>;
} {
  const bounds = evidence?.deviceBounds ?? target.point?.referenceBounds;
  const withPin = (point: { x: number; y: number }) => ({
    ...point,
    ...(target.point?.anchor
      ? { anchor: { ...target.point.anchor } }
      : bounds
        ? {
            anchor: { horizontal: "left" as const, vertical: "top" as const },
          }
        : {}),
    ...(target.point?.referenceBounds
      ? { referenceBounds: { ...target.point.referenceBounds } }
      : bounds
        ? { referenceBounds: { ...bounds } }
        : {}),
  });
  const from = target.point
    ? withPin({ x: Math.round(target.point.x), y: Math.round(target.point.y) })
    : bounds
      ? withPin({ x: Math.round(bounds.width / 2), y: Math.round(bounds.height * 0.68) })
      : withPin({ x: 360, y: 640 });
  const distance = Math.max(120, Math.round((bounds?.height ?? 1_000) * 0.28));
  const canMoveUp = from.y - distance >= 0;
  const unclampedY = canMoveUp ? from.y - distance : from.y + distance;
  const toY = bounds ? Math.min(bounds.height, unclampedY) : unclampedY;
  return { from, to: withPin({ x: from.x, y: Math.round(toY) }) };
}

/** Convert an inspector action without discarding compatible recorded context. */
export function convertStepAction(step: RecipeStep, kind: EditableActionKind): RecipeStep {
  if (step.kind === kind || (kind === "tap" && isTapAction(step))) return step;
  const target = targetFrom(step);
  const evidence = evidenceFrom(step);
  const withMetadata = {
    ...(step.id ? { id: step.id } : {}),
    ...(evidence ? { evidence } : {}),
    ...(step.note ? { note: step.note } : {}),
  };

  switch (kind) {
    case "tap":
      return {
        kind,
        target: hasTarget(target) ? target : defaultTapTarget(evidence?.deviceBounds),
        ...withMetadata,
      };
    case "type":
      return {
        kind,
        text: step.kind === "type" ? step.text : "",
        ...(hasTarget(target) ? { target } : {}),
        ...(step.kind === "type" && step.mode ? { mode: step.mode } : {}),
        ...withMetadata,
      };
    case "expect":
      return { kind, target, condition: "visible", ...withMetadata };
    case "expect-set":
      return { kind, identifierPrefix: "", labels: [], ...withMetadata };
    case "wait-for":
      return { kind, target, timeoutMs: 5_000, ...withMetadata };
    case "sleep":
      return { kind, ms: 1_000, ...withMetadata };
    case "screenshot":
      return { kind, ...withMetadata };
    case "pause":
      return { kind, message: "Continue when ready", ...withMetadata };
    case "review":
      return {
        kind,
        capability: "",
        reason: "",
        ...withMetadata,
      };
    case "scroll":
      return { kind, direction: "down", ...withMetadata };
    case "swipe":
      return {
        kind,
        ...swipePoints(target, evidence),
        ...withMetadata,
      };
    case "key":
      return { kind, key: "back", ...withMetadata };
    case "wait-response":
      return { kind, target, timeoutMs: 90_000, stableForMs: 2_000, ...withMetadata };
    case "extract":
      return { kind, as: "response", target, role: "assistant", ...withMetadata };
    case "assert-content":
      return { kind, input: "response", expected: "", match: "contains", ...withMetadata };
    case "assert-layout":
      return {
        kind,
        relation: "non-overlap",
        first: target,
        second: {},
        ...withMetadata,
      };
    case "evaluate-semantic":
      return {
        kind,
        input: "response",
        criteria: ["The response satisfies the requested intent."],
        threshold: 0.9,
        ...withMetadata,
      };
    case "flow":
      return { kind, flow: "", ...withMetadata };
    case "module":
      return { kind, recipeId: "", ...withMetadata };
    case "branch":
      return {
        kind,
        input: "response",
        operator: "contains",
        expected: "",
        thenRecipeId: "",
        ...withMetadata,
      };
    case "repeat":
      return { kind, count: 3, recipeId: "", ...withMetadata };
    case "script":
      return { kind, source: "set name = value", ...withMetadata };
    case "clipboard":
      return { kind, action: "write", text: "", ...withMetadata };
    case "app":
      return { kind, action: "open", app: "", ...withMetadata };
    case "device":
      return { kind, action: "keyboard-dismiss", ...withMetadata };
    case "rotate":
      return { kind, orientation: "portrait", ...withMetadata };
    case "settings":
      return { kind, setting: "wifi", state: "on", ...withMetadata };
    case "location":
      return { kind, latitude: 0, longitude: 0, ...withMetadata };
    case "permission":
      return { kind, action: "grant", permission: "camera", ...withMetadata };
    case "alert":
      return { kind, action: "accept", ...withMetadata };
    case "network":
      return { kind, action: "dump", include: "headers", limit: 100, ...withMetadata };
    case "logs":
      return { kind, action: "mark", message: "checkpoint", ...withMetadata };
  }
}

/** Change only the physical tap gesture; the recorded target remains untouched. */
export function convertTapGesture(
  step: RecipeStep,
  gesture: TapGesture,
): Extract<RecipeStep, { kind: "tap" }> {
  const target = targetFrom(step);
  const evidence = evidenceFrom(step);
  const withEvidence = evidence ? { evidence } : {};
  const withMetadata = {
    ...(step.id ? { id: step.id } : {}),
    ...withEvidence,
    ...(step.note ? { note: step.note } : {}),
  };
  const durationMs = step.kind === "tap" ? (step.durationMs ?? 700) : 700;
  const tapCount = step.kind === "tap" ? (step.tapCount ?? 2) : 2;
  const intervalMs = step.kind === "tap" ? (step.intervalMs ?? 100) : 100;
  return {
    kind: "tap",
    target,
    ...(gesture === "single" ? {} : { gesture }),
    ...(gesture === "hold" ? { durationMs } : {}),
    ...(step.kind === "tap" && step.durationMs !== undefined && gesture !== "hold"
      ? { durationMs }
      : {}),
    ...(gesture === "multi" || (step.kind === "tap" && step.tapCount !== undefined)
      ? { tapCount }
      : {}),
    ...(gesture === "multi" || (step.kind === "tap" && step.intervalMs !== undefined)
      ? { intervalMs }
      : {}),
    ...withMetadata,
  };
}
