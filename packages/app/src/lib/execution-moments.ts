import type { JobInfo, RecipeInfo, RecipeStep, TraceStep } from "../context/server";
import { sentenceForStep } from "./step-sentence";

export type ExecutionMomentState =
  | "planned"
  | "queued"
  | "running"
  | "paused"
  | "passed"
  | "failed"
  | "cancelled";

export type ExecutionMoment = {
  index: number;
  title: string;
  state: ExecutionMomentState;
  actions: string[];
  durationMs?: number;
  startedAt?: number;
  finishedAt?: number;
  frame?: TraceStep["frames"][number];
  observed: boolean;
};

export type ExecutionStateScope = "run" | "step";

export function executionStateForJob(status: JobInfo["status"]): ExecutionMomentState {
  if (status === "queued") return "queued";
  if (status === "running") return "running";
  if (status === "paused") return "paused";
  if (status === "ok" || status === "healed") return "passed";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

export function executionStateLabel(
  state: ExecutionMomentState,
  scope: ExecutionStateScope = "run",
): string {
  switch (state) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "paused":
      return "Waiting for you";
    case "passed":
      return "Passed";
    case "failed":
      return scope === "step" ? "Failed here" : "Failed";
    case "cancelled":
      return "Stopped";
    default:
      return scope === "step" ? "Not reached" : "Ready to run";
  }
}

export function executionStateDetail(state: ExecutionMomentState): string {
  switch (state) {
    case "queued":
      return "Relay will start when the target is free.";
    case "running":
      return "Watch the device and steps move together.";
    case "paused":
      return "Complete the action on the device, then continue.";
    case "passed":
      return "Every required step completed.";
    case "failed":
      return "Relay stopped where the result changed.";
    case "cancelled":
      return "This run was stopped before it finished.";
    default:
      return "Choose a Device, then run the Test.";
  }
}

export function executionStateForMoments(moments: ExecutionMoment[]): ExecutionMomentState {
  if (moments.some((moment) => moment.state === "running")) return "running";
  if (moments.some((moment) => moment.state === "paused")) return "paused";
  if (moments.some((moment) => moment.state === "failed")) return "failed";
  if (moments.some((moment) => moment.state === "cancelled")) return "cancelled";
  if (moments.length > 0 && moments.every((moment) => moment.state === "passed")) return "passed";
  if (moments.some((moment) => moment.state === "queued")) return "queued";
  return "planned";
}

const ACTION_GLYPH: Partial<Record<RecipeStep["kind"], string>> = {
  tap: "tap",
  type: "type",
  scroll: "swipe",
  swipe: "swipe",
  key: "tap",
  sleep: "wait",
  "wait-for": "wait",
  "wait-response": "wait",
  expect: "ok",
  extract: "type",
  "assert-content": "ok",
  "evaluate-semantic": "ai",
  pause: "wait",
  screenshot: "shot",
  flow: "store",
  module: "store",
  branch: "ai",
  repeat: "re",
  script: "bolt",
  clipboard: "type",
  app: "store",
  device: "tap",
};

/** Glyph code for a planned step kind — icon trails outside a live execution. */
export function stepGlyph(kind: RecipeStep["kind"]): string {
  return ACTION_GLYPH[kind] ?? "bolt";
}

function stateForTrace(
  job: JobInfo | undefined,
  trace: TraceStep | undefined,
): ExecutionMomentState {
  if (!trace) return job?.status === "queued" ? "queued" : "planned";
  if (trace.status === "error" || trace.tone === "danger" || trace.tone === "fail") return "failed";
  if (job?.status === "cancelled" && trace.index === (job.steps?.length ?? 1) - 1)
    return "cancelled";
  if (job?.status === "paused" && trace.index === (job.steps?.length ?? 1) - 1) return "paused";
  if (
    (trace.status === "running" || job?.status === "running") &&
    trace.index === (job?.steps?.length ?? 1) - 1
  )
    return "running";
  return "passed";
}

/**
 * The one UI model used before, during, and after execution. A moment is a
 * human-readable test step; `actions` preserves the smaller operations Relay
 * performed inside it even when those operations do not have screenshots.
 */
export function executionMoments(input: {
  steps?: RecipeStep[];
  recipe?: RecipeInfo | null;
  job?: JobInfo | null;
  recipes: RecipeInfo[];
}): ExecutionMoment[] {
  const steps = input.steps ?? input.recipe?.steps ?? input.job?.recipeSnapshot?.steps ?? [];
  const traces = input.job?.steps ?? [];
  const count = Math.max(steps.length, traces.length);

  return Array.from({ length: count }, (_, index) => {
    const step = steps[index];
    const trace = traces[index];
    const fallbackAction = step ? ACTION_GLYPH[step.kind] : undefined;
    return {
      index,
      title:
        trace?.title ??
        (step
          ? sentenceForStep(step, input.recipes)
          : `Step ${String(index + 1).padStart(2, "0")}`),
      state: stateForTrace(input.job ?? undefined, trace),
      actions:
        trace?.actions !== undefined
          ? trace.actions.map((action) => action.kind)
          : trace?.glyphs?.length
            ? trace.glyphs
            : fallbackAction
              ? [fallbackAction]
              : ["bolt"],
      durationMs: trace?.durationMs,
      startedAt: trace?.startedAt,
      finishedAt: trace?.finishedAt,
      frame: trace?.frames?.at(-1),
      observed: Boolean(trace),
    };
  });
}

export function executionElapsedAt(moments: ExecutionMoment[], selectedIndex: number): number {
  return moments
    .slice(0, Math.max(0, selectedIndex) + 1)
    .reduce((total, moment) => total + Math.max(0, moment.durationMs ?? 0), 0);
}

export function executionDuration(moments: ExecutionMoment[]): number {
  return moments.reduce((total, moment) => total + Math.max(0, moment.durationMs ?? 0), 0);
}
