import type { RecipeStep, RecordedStepEvidence, StepTarget } from "./api-types";

export type EditableActionKind = RecipeStep["kind"];

export type TapGesture = "single" | "multi" | "hold";

export function isTapAction(step: RecipeStep): step is Extract<RecipeStep, { kind: "tap" }> {
  return step.kind === "tap";
}

export function tapGesture(step: RecipeStep): TapGesture {
  if (step.kind !== "tap") return "single";
  return step.gesture ?? "single";
}

function evidenceFrom(step: RecipeStep): RecordedStepEvidence | undefined {
  return "evidence" in step ? step.evidence : undefined;
}

function targetFrom(step: RecipeStep): StepTarget {
  if ("target" in step && step.target) return step.target;
  const evidence = evidenceFrom(step);
  return (
    evidence?.candidates?.[0]?.target ?? (evidence?.pointer ? { point: evidence.pointer } : {})
  );
}

function hasTarget(target: StepTarget): boolean {
  return Boolean(target.ref || target.label || target.text || target.point);
}

/** Convert an inspector action without discarding compatible recorded context. */
export function convertStepAction(step: RecipeStep, kind: EditableActionKind): RecipeStep {
  if (step.kind === kind || (kind === "tap" && isTapAction(step))) return step;
  const target = targetFrom(step);
  const evidence = evidenceFrom(step);
  const note = step.note;
  const withNote = note ? { note } : {};
  const withEvidence = evidence ? { evidence } : {};

  switch (kind) {
    case "tap":
      return { kind, target, ...withEvidence, ...withNote };
    case "type":
      return {
        kind,
        text: step.kind === "type" ? step.text : "",
        ...(hasTarget(target) ? { target } : {}),
        ...withEvidence,
        ...withNote,
      };
    case "expect":
      return { kind, target, condition: "visible", ...withEvidence, ...withNote };
    case "wait-for":
      return { kind, target, timeoutMs: 5_000, ...withEvidence, ...withNote };
    case "sleep":
      return { kind, ms: 1_000, ...withNote };
    case "screenshot":
      return { kind, ...withNote };
    case "pause":
      return { kind, message: "Continue when ready", ...withNote };
    case "scroll":
      return { kind, direction: "down", ...withNote };
    case "swipe":
      return {
        kind,
        from: target.point ?? { x: 0, y: 0 },
        to: target.point ?? { x: 0, y: 0 },
        ...withEvidence,
        ...withNote,
      };
    case "key":
      return { kind, key: "back", ...withNote };
    case "wait-response":
      return { kind, target, timeoutMs: 90_000, stableForMs: 2_000, ...withNote };
    case "extract":
      return { kind, as: "response", target, role: "assistant", ...withNote };
    case "assert-content":
      return { kind, input: "response", expected: "", match: "contains", ...withNote };
    case "evaluate-semantic":
      return {
        kind,
        input: "response",
        criteria: ["The response satisfies the requested intent."],
        threshold: 0.9,
        ...withNote,
      };
    case "flow":
      return { kind, flow: "", ...withNote };
    case "module":
      return { kind, recipeId: "", ...withNote };
    case "branch":
      return {
        kind,
        input: "response",
        operator: "contains",
        expected: "",
        thenRecipeId: "",
        ...withNote,
      };
    case "repeat":
      return { kind, count: 3, recipeId: "", ...withNote };
    case "script":
      return { kind, source: "set name = value", ...withNote };
    case "clipboard":
      return { kind, action: "write", text: "", ...withNote };
    case "app":
      return { kind, action: "open", app: "", ...withNote };
    case "device":
      return { kind, action: "keyboard-dismiss", ...withNote };
    case "rotate":
      return { kind, orientation: "portrait", ...withNote };
    case "settings":
      return { kind, setting: "wifi", state: "on", ...withNote };
    case "location":
      return { kind, latitude: 0, longitude: 0, ...withNote };
    case "permission":
      return { kind, action: "grant", permission: "camera", ...withNote };
    case "alert":
      return { kind, action: "accept", ...withNote };
    case "network":
      return { kind, action: "dump", include: "headers", limit: 100, ...withNote };
    case "logs":
      return { kind, action: "mark", message: "checkpoint", ...withNote };
  }
}

/** Change only the physical tap gesture; the recorded target remains untouched. */
export function convertTapGesture(
  step: RecipeStep,
  gesture: TapGesture,
): Extract<RecipeStep, { kind: "tap" }> {
  const target = targetFrom(step);
  const evidence = evidenceFrom(step);
  const note = step.note;
  const withEvidence = evidence ? { evidence } : {};
  const withNote = note ? { note } : {};
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
    ...withEvidence,
    ...withNote,
  };
}
