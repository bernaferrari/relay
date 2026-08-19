import type {
  NavigationProofCursor as PublicNavigationProofCursor,
  NavigationProofCursorArtifact,
} from "@relay/protocol";
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

/**
 * The runner's single answer to "where is the target now?".
 *
 * A proven cursor may come from a full screen observation or from a compiled
 * transition whose destination assertion completed. Unknown is a real state,
 * never permission to reuse a logical itinerary. The previous proof is kept
 * only for diagnostics; callers must not execute from it.
 */
export type NavigationProofCursor = PublicNavigationProofCursor & {
  checkpoint?: VerifiedScreenCheckpoint;
};

/** Mutable, run-local state shared through nested reusable recipes. It is
 * deliberately never persisted: every mutation invalidates the proof and a
 * later run must establish its own checkpoint from the live target. */
export type RecipeRuntimeState = {
  /** Latest exact tree/raster observation, reusable only until a mutation. */
  observation?: FreshDeviceObservation;
  navigationCursor?: NavigationProofCursor;
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
  /** Becomes true at the first coverage check and never resets during the run.
   * Destructive setup effects are firewalled after this boundary, including
   * when they are hidden inside reusable modules or graph routines. */
  campaignCoverageStarted?: boolean;
};

function previousProof(
  cursor: NavigationProofCursor | undefined,
): { screenId: string; proofToken: string } | undefined {
  return cursor?.status === "proven"
    ? { screenId: cursor.screenId, proofToken: cursor.proofToken }
    : cursor?.previous;
}

function recordNavigationCursor(ctx: RecipeStepContext, cursor: NavigationProofCursor): void {
  // The cursor is persisted for campaign coverage, where it is part of the
  // user-visible proof graph. Standalone authoring/preview steps keep it
  // ephemeral so ordinary evidence ordering remains stable.
  if (!ctx.runtime?.campaignCoverageStarted || !Array.isArray(ctx.job?.artifacts)) return;
  const data: NavigationProofCursorArtifact =
    cursor.status === "proven"
      ? {
          schemaVersion: 1,
          status: cursor.status,
          screenId: cursor.screenId,
          proofToken: cursor.proofToken,
          source: cursor.source,
          updatedAt: cursor.updatedAt,
        }
      : cursor.status === "external-handoff"
        ? {
            schemaVersion: 1,
            status: cursor.status,
            foregroundApp: cursor.foregroundApp,
            reason: cursor.reason,
            updatedAt: cursor.updatedAt,
            ...(cursor.previous ? { previous: cursor.previous } : {}),
          }
        : {
            schemaVersion: 1,
            status: cursor.status,
            reason: cursor.reason,
            updatedAt: cursor.updatedAt,
            ...(cursor.previous ? { previous: cursor.previous } : {}),
          };
  ctx.job.artifacts.push({
    kind: "navigation-proof-cursor",
    capturedAt: cursor.updatedAt,
    data,
  });
}

export function currentVerifiedScreen(
  runtime: RecipeRuntimeState | undefined,
): VerifiedScreenCheckpoint | undefined {
  return runtime?.navigationCursor?.status === "proven"
    ? runtime.navigationCursor.checkpoint
    : undefined;
}

export function proveNavigationScreen(
  ctx: RecipeStepContext,
  checkpoint: VerifiedScreenCheckpoint,
): void {
  if (!ctx.runtime) return;
  const cursor: NavigationProofCursor = {
    status: "proven",
    screenId: checkpoint.screenId,
    proofToken: `${ctx.job?.id ?? "local"}:${checkpoint.screenId}:${checkpoint.verifiedAt}`,
    source: "screen-observation",
    updatedAt: checkpoint.verifiedAt,
    checkpoint,
  };
  ctx.runtime.navigationCursor = cursor;
  recordNavigationCursor(ctx, cursor);
}

export function proveNavigationDestination(
  ctx: RecipeStepContext,
  input: { screenId: string; source: "transition" | "cleanup"; at: number; token?: string },
): void {
  if (!ctx.runtime) return;
  const cursor: NavigationProofCursor = {
    status: "proven",
    screenId: input.screenId,
    proofToken:
      input.token ?? `${ctx.job?.id ?? "local"}:${input.source}:${input.screenId}:${input.at}`,
    source: input.source,
    updatedAt: input.at,
  };
  ctx.runtime.navigationCursor = cursor;
  recordNavigationCursor(ctx, cursor);
}

export function markNavigationUnknown(ctx: RecipeStepContext, reason: string): void {
  if (!ctx.runtime) return;
  const previous = previousProof(ctx.runtime.navigationCursor);
  const cursor: NavigationProofCursor = {
    status: "unknown",
    reason,
    updatedAt: Date.now(),
    ...(previous ? { previous } : {}),
  };
  ctx.runtime.navigationCursor = cursor;
  recordNavigationCursor(ctx, cursor);
}

export function markNavigationExternalHandoff(
  ctx: RecipeStepContext,
  foregroundApp: string,
  reason: string,
): void {
  if (!ctx.runtime) return;
  const previous = previousProof(ctx.runtime.navigationCursor);
  const cursor: NavigationProofCursor = {
    status: "external-handoff",
    foregroundApp,
    reason,
    updatedAt: Date.now(),
    ...(previous ? { previous } : {}),
  };
  ctx.runtime.navigationCursor = cursor;
  recordNavigationCursor(ctx, cursor);
}

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
    markNavigationUnknown(ctx, "A device mutation invalidated the last proven screen.");
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
