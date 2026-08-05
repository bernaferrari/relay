import type { AuthoringInteraction, StepTarget } from "@relay/protocol";
import { describeStep, type RecordingTakeAction } from "../context/recorder";
import { defaultTapTarget } from "../lib/take-action-conversion";
import { defaultStrategy, parsePoint, type Strategy } from "../lib/step-target";

export type TakeActionKind = AuthoringInteraction["kind"];

/** One compact catalog for every editable recorded interaction. */

export const TAKE_ACTION_KINDS: Array<{ id: TakeActionKind; label: string }> = [
  { id: "tap", label: "Tap" },
  { id: "type", label: "Type text" },
  { id: "clipboard", label: "Clipboard" },
  { id: "app", label: "App control" },
  { id: "device", label: "Device control" },
  { id: "rotate", label: "Rotate device" },
  { id: "swipe", label: "Swipe" },
  { id: "key", label: "Device key" },
  { id: "wait", label: "Wait" },
  { id: "observe", label: "Observe only" },
  { id: "screenshot", label: "Take screenshot" },
  { id: "reusable", label: "Run routine" },
  { id: "steps", label: "Custom recorded action" },
];

export function interactionForAction(action: RecordingTakeAction): AuthoringInteraction {
  if (action.steps.length === 0)
    return { kind: "observe", ...(action.label ? { label: action.label } : {}) };
  if (action.steps.length !== 1) {
    return {
      kind: "steps",
      steps: structuredClone(action.steps),
      ...(action.label ? { label: action.label } : {}),
    };
  }
  const step = action.steps[0]!;
  switch (step.kind) {
    case "tap":
      return { kind: "tap", target: structuredClone(step.target) };
    case "type":
      return {
        kind: "type",
        text: step.text,
        ...(step.target ? { target: structuredClone(step.target) } : {}),
        ...(step.mode ? { mode: step.mode } : {}),
      };
    case "clipboard":
      return {
        kind: "clipboard",
        action: step.action,
        ...(step.text !== undefined ? { text: step.text } : {}),
        ...(step.target ? { target: structuredClone(step.target) } : {}),
        ...(step.expect !== undefined ? { expect: step.expect } : {}),
        ...(step.match ? { match: step.match } : {}),
      };
    case "app":
      return {
        kind: "app",
        action: step.action,
        ...(step.app !== undefined ? { app: step.app } : {}),
        ...(step.url !== undefined ? { url: step.url } : {}),
        ...(step.relaunch !== undefined ? { relaunch: step.relaunch } : {}),
        ...(step.artifact !== undefined ? { artifact: step.artifact } : {}),
        ...(step.as !== undefined ? { as: step.as } : {}),
        ...(step.version !== undefined ? { version: step.version } : {}),
        ...(step.versionMatch ? { versionMatch: step.versionMatch } : {}),
      };
    case "device":
      return { kind: "device", action: step.action };
    case "rotate":
      return { kind: "rotate", orientation: step.orientation };
    case "swipe":
      return {
        kind: "swipe",
        from: structuredClone(step.from),
        to: structuredClone(step.to),
        ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
      };
    case "key":
      return { kind: "key", key: step.key };
    case "sleep":
      return { kind: "wait", ms: step.ms };
    case "screenshot":
      return { kind: "screenshot", ...(step.caption ? { label: step.caption } : {}) };
    case "module":
      return {
        kind: "reusable",
        recipeId: step.recipeId,
        ...(step.bindings ? { bindings: structuredClone(step.bindings) } : {}),
      };
    default:
      return {
        kind: "steps",
        steps: [structuredClone(step)],
        ...(action.label ? { label: action.label } : {}),
      };
  }
}

function targetFrom(interaction: AuthoringInteraction): StepTarget | undefined {
  if (interaction.kind === "tap" || interaction.kind === "type" || interaction.kind === "clipboard")
    return interaction.target;
  return undefined;
}

export function interactionWithKind(
  current: AuthoringInteraction,
  kind: TakeActionKind,
): AuthoringInteraction {
  if (current.kind === kind) return structuredClone(current);
  const target = targetFrom(current);
  switch (kind) {
    case "tap":
      return { kind, target: structuredClone(target ?? defaultTapTarget()) };
    case "type":
      return {
        kind,
        text: "",
        ...(target ? { target: structuredClone(target) } : {}),
      };
    case "clipboard":
      return { kind, action: "write", text: "" };
    case "app":
      return { kind, action: "switcher" };
    case "device":
      return { kind, action: "keyboard-dismiss" };
    case "rotate":
      return { kind, orientation: "portrait" };
    case "swipe":
      return { kind, from: { x: 540, y: 1_600 }, to: { x: 540, y: 800 }, durationMs: 300 };
    case "key":
      return { kind, key: "back" };
    case "wait":
      return { kind, ms: 1_000 };
    case "observe":
      return { kind };
    case "screenshot":
      return { kind };
    case "reusable":
      return { kind, recipeId: "" };
    case "steps":
      return current.kind === "steps" ? structuredClone(current) : { kind, steps: [] };
  }
}

export function strategyForTarget(target: StepTarget | undefined): Strategy {
  return defaultStrategy(target);
}

export function targetValue(target: StepTarget | undefined, strategy: Strategy): string {
  if (!target) return "";
  if (strategy === "identifier") return target.identifier ?? "";
  if (strategy === "ref") return target.ref ?? "";
  if (strategy === "label") return target.label ?? "";
  if (strategy === "text") return target.text ?? "";
  return target.point ? `${target.point.x}, ${target.point.y}` : "";
}

export function targetWithStrategy(
  target: StepTarget | undefined,
  strategy: Strategy,
  value: string,
): StepTarget {
  if (strategy === "point") {
    const point = parsePoint(value);
    return point
      ? {
          point: {
            ...target?.point,
            ...point,
          },
        }
      : {};
  }
  const next: StepTarget = target?.point ? { point: structuredClone(target.point) } : {};
  const normalized = value.trim();
  if (strategy === "identifier" && normalized) next.identifier = normalized;
  if (strategy === "ref" && normalized)
    next.ref = normalized.startsWith("@") ? normalized : `@${normalized}`;
  if (strategy === "label" && normalized) next.label = normalized;
  if (strategy === "text" && normalized) next.text = normalized;
  return next;
}

export function takeActionError(interaction: AuthoringInteraction): string | undefined {
  if (interaction.kind === "tap" && !hasTarget(interaction.target))
    return "Choose what Relay should tap.";
  if (interaction.kind === "type") {
    if (!interaction.text.trim()) return "Enter the text Relay should type.";
    if (interaction.target && !hasTarget(interaction.target))
      return "Finish the typing target or remove it.";
  }
  if (interaction.kind === "clipboard") {
    if (
      (interaction.action === "copy" || interaction.action === "paste") &&
      !hasTarget(interaction.target)
    )
      return interaction.action === "copy"
        ? "Choose the text field or element to copy from."
        : "Choose the text field where Relay should paste.";
  }
  if (interaction.kind === "app") {
    if (
      interaction.action !== "switcher" &&
      !interaction.app &&
      !interaction.url &&
      !interaction.artifact
    )
      return "Choose an app, link, or local artifact.";
    if (
      (interaction.action === "install" || interaction.action === "update") &&
      !interaction.artifact
    )
      return "Choose the local app artifact to install.";
  }
  if (interaction.kind === "swipe") {
    const numbers = [interaction.from.x, interaction.from.y, interaction.to.x, interaction.to.y];
    if (numbers.some((value) => !Number.isFinite(value) || value < 0))
      return "Swipe coordinates must be zero or greater.";
    if (
      interaction.durationMs !== undefined &&
      (!Number.isFinite(interaction.durationMs) || interaction.durationMs < 0)
    )
      return "Swipe duration must be zero or greater.";
  }
  if (interaction.kind === "wait" && (!Number.isFinite(interaction.ms) || interaction.ms < 0))
    return "Wait time must be zero or greater.";
  if (interaction.kind === "reusable") {
    if (!interaction.recipeId.trim()) return "Choose a routine to run.";
    const keys = Object.keys(interaction.bindings ?? {});
    if (keys.some((key) => !key.trim())) return "Every routine input needs a name.";
    if (new Set(keys.map((key) => key.trim())).size !== keys.length)
      return "Routine input names must be unique.";
  }
  if (interaction.kind === "steps" && interaction.steps.length === 0)
    return "Choose another action type before saving.";
  return undefined;
}

export function moveActionIds(
  actions: readonly Pick<RecordingTakeAction, "id">[],
  actionId: string,
  toIndex: number,
): string[] {
  const ids = actions.map((action) => action.id);
  const fromIndex = ids.indexOf(actionId);
  if (fromIndex < 0) return ids;
  const boundedIndex = Math.max(0, Math.min(ids.length - 1, toIndex));
  if (fromIndex === boundedIndex) return ids;
  const [moved] = ids.splice(fromIndex, 1);
  ids.splice(boundedIndex, 0, moved!);
  return ids;
}

export function describeTakeAction(action: RecordingTakeAction): string {
  if (action.steps.length === 0) return action.label?.trim() || "Observe the next screen";
  if (action.steps.length === 1) return describeStep(action.steps[0]!);
  return `${action.steps.length} recorded steps`;
}

function hasTarget(target: StepTarget | undefined): boolean {
  return Boolean(
    target && (target.identifier || target.ref || target.label || target.text || target.point),
  );
}
