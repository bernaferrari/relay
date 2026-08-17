import type { Recipe, RecipeStep } from "./recipes.js";
import type { SnapshotNode } from "./device.js";
import type { ScreenshotPayload } from "./workspace-capture.js";
import type { TestJob } from "./session.js";

export type FreshDeviceObservation = {
  nodes?: SnapshotNode[];
  observedAt: number;
  screenshot?: ScreenshotPayload;
};

export type VerifiedScreenCheckpoint = FreshDeviceObservation & {
  screenId: string;
  screenTitle: string;
  nodes: SnapshotNode[];
  verifiedAt: number;
};

/** Mutable, run-local state shared through nested reusable recipes. It is
 * deliberately never persisted: every mutation invalidates the proof and a
 * later run must establish its own checkpoint from the live target. */
export type RecipeRuntimeState = {
  /** Latest exact tree/raster observation, reusable only until a mutation. */
  observation?: FreshDeviceObservation;
  verifiedScreen?: VerifiedScreenCheckpoint;
  deferredCampaignChecks?: Array<{
    check: NonNullable<RecipeStep["check"]>;
    error: string;
    startedAt: number;
    deferredAt: number;
  }>;
  campaignRecoveryGroups?: Record<
    string,
    { status: "healthy" | "needs-recovery" | "blocked"; reason?: string }
  >;
  /** Run-local proof graph keyed by canonical App Map connection id. An open
   * circuit is terminal for this run and prevents every dependent mutation. */
  campaignTransitionProofs?: Record<
    string,
    {
      status: "verified" | "needs-confirmation" | "open";
      checkId: string;
      updatedAt: number;
      reason?: string;
    }
  >;
  /** Whether the next campaign check may use its compiled warm path. A failed
   * check invalidates that assumption; the next check gets exactly one
   * canonical recovery path instead of probing Back from an unknown state. */
  campaignItineraryTrusted?: boolean;
  /** Becomes true at the first coverage check and never resets during the run.
   * Destructive setup effects are firewalled after this boundary, including
   * when they are hidden inside reusable modules or graph routines. */
  campaignCoverageStarted?: boolean;
};

export function campaignCoverageForbiddenEffect(step: RecipeStep): string | undefined {
  if (step.kind === "app") {
    if (step.action === "open") {
      if (step.url) return "opening a URL is a reviewed handoff effect";
      if (step.relaunch === true) return "app relaunch is a setup/reset effect";
      return undefined;
    }
    if (!["inspect", "assert-installed", "assert-not-installed"].includes(step.action)) {
      return `app ${step.action} is a setup/reset effect`;
    }
  }
  if (["rotate", "settings", "location", "permission"].includes(step.kind)) {
    return `${step.kind} is a setup/device mutation effect`;
  }
  if (step.kind === "device" && ["lock", "unlock"].includes(step.action)) {
    return `device ${step.action} is a setup/device mutation effect`;
  }
  if (step.kind === "key" && step.key === "home") {
    return "device Home is a setup/navigation reset effect";
  }
  return undefined;
}

const checkpointBreakingSteps = new Set<RecipeStep["kind"]>([
  "tour",
  "wait-for",
  "wait-response",
  "expect",
  "expect-set",
  "extract",
  "evaluate-semantic",
  "pause",
  "review",
  "flow",
  "clipboard",
  "app",
  "device",
  "rotate",
  "settings",
  "location",
  "permission",
  "alert",
]);

export function stepBreaksVerifiedScreen(step: RecipeStep): boolean {
  return checkpointBreakingSteps.has(step.kind);
}

export function invalidateVerifiedScreen(ctx: RecipeStepContext): void {
  if (ctx.runtime) {
    ctx.runtime.observation = undefined;
    ctx.runtime.verifiedScreen = undefined;
  }
}

export function campaignExecutionStep(
  step: RecipeStep,
  recipeId?: string,
  bindings?: Record<string, string>,
): RecipeStep {
  return recipeId && step.kind === "module"
    ? {
        ...step,
        recipeId,
        ...(bindings ? { bindings: structuredClone(bindings) } : {}),
      }
    : step;
}
export type RecipeStepContext = {
  log: (line: string) => void;
  /**
   * Owning job. Required for `pause` steps (drives job.status + resume
   * checkpoint) and used to attach `screenshot` frames to a run. Standalone
   * single-step execution (no job, e.g. server's POST /step/run) omits it —
   * `pause` throws in that case (rejected upstream) and `screenshot` simply
   * captures without attaching to a job.
   */
  job?: TestJob;
  /** Ephemeral values and evidence for authoring replay and standalone flows.
   * They provide the same assertion semantics without inventing a persisted
   * TestJob merely to verify a proposal. */
  variables?: Record<string, string>;
  artifacts?: { kind: string; capturedAt: number; data: unknown }[];
  moduleStack?: string[];
  recipeGraph?: Readonly<Record<string, Recipe>>;
  runtime?: RecipeRuntimeState;
  /** Test seam and provider override for pixel-only destination identity. */
  observeVisualFingerprint?: () => Promise<string | undefined>;
};
