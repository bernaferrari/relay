/**
 * Automatic destination survey (DX 2026-08-22, Data Controls locale QA): a
 * Test that lands on a screen the map itself declares scrollable must not make
 * the operator rediscover `device survey` with a bespoke script. After the
 * destination verifies, one bounded scroll survey captures the hidden copy and
 * persists every frame with its tree as run evidence.
 *
 * The survey is evidence, never a gate: any failure degrades to a warning
 * while the verified first viewport stands. Only an iOS mutation whose outcome
 * is unknown stays terminal, exactly like every other iOS device effect.
 */
import type { RecipeStep } from "@relay/protocol";
import { persistDestinationSurveyFrames } from "./capture-surface-survey-frames.js";
import type { SnapshotNode } from "./device.js";
import { rethrowIosMutationOutcomeUnknown } from "./ios-mutation-policy.js";
import { markNavigationUnknown, type RecipeStepContext } from "./recipe-runner-context.js";
import { visualEvidenceAllowed } from "./redaction.js";
import { observeScreenIdentity } from "./screen-identity.js";
import {
  captureScrollableSurveyForTarget,
  type ScrollSurveyTargetInput,
} from "./scrollable-survey.js";
import type { ScrollSurveyCapture, ScrollSurveyResult } from "./scrollable-survey-types.js";
import type { ScreenshotPayload } from "./workspace-capture.js";

export type DestinationSurveyStep = Pick<
  Extract<RecipeStep, { kind: "expect-screen" }>,
  "id" | "screenId" | "screenTitle"
> & {
  destinationSurvey?: NonNullable<
    Extract<RecipeStep, { kind: "expect-screen" }>["destinationSurvey"]
  > & {
    /** Runtime-only. False skips the restore swipes when this landing is the
     * last input step. Never parsed from recipe YAML. */
    restore?: boolean;
  };
};

export type DestinationSurveyDependencies = {
  /** Host/test seam; production always uses the physical target survey. */
  captureSurvey?: (input: ScrollSurveyTargetInput) => Promise<ScrollSurveyResult>;
  /** Remaining recipe after this expect-screen. When omitted, the survey
   * looks at the job's frozen recipe graph. */
  remainingSteps?: readonly Pick<RecipeStep, "kind">[];
};

const DESTINATION_SURVEY_VIEWPORT_KINDS: Record<string, true> = {
  tap: true,
  swipe: true,
  scroll: true,
  key: true,
  interact: true,
  type: true,
  "wait-for": true,
  expect: true,
  "expect-screen": true,
  "assert-layout": true,
  screenshot: true,
  "capture-surface": true,
  tour: true,
  // A sibling module may inspect or mutate this same landing. Its body is
  // intentionally conservative here; a passive tail never justifies leaving
  // a taught viewport behind before another instruction executes.
  module: true,
};

/** Later checks and screenshots depend on the taught viewport just as input
 * does. Only a genuinely passive terminal tail may skip restoration. */
export function destinationSurveyShouldRestore(
  remainingSteps: readonly Pick<RecipeStep, "kind">[],
): boolean {
  return remainingSteps.some((step) => DESTINATION_SURVEY_VIEWPORT_KINDS[step.kind] === true);
}

function remainingRecipeStepsAfter(
  step: DestinationSurveyStep,
  ctx: RecipeStepContext,
): readonly Pick<RecipeStep, "kind">[] | undefined {
  const graph = { ...ctx.recipeGraph, ...ctx.job?.recipeGraph };
  const matches = (candidate: RecipeStep) =>
    step.id
      ? candidate.id === step.id
      : candidate.kind === "expect-screen" &&
        candidate.screenId === step.screenId &&
        candidate.destinationSurvey !== undefined;
  const visit = (
    recipe: { steps: readonly RecipeStep[]; id?: string },
    ancestors: ReadonlySet<string>,
  ): readonly Pick<RecipeStep, "kind">[] | undefined => {
    if (recipe.id && ancestors.has(recipe.id)) return undefined;
    const seen = new Set(ancestors);
    if (recipe.id) seen.add(recipe.id);
    for (const [index, candidate] of recipe.steps.entries()) {
      if (matches(candidate)) return recipe.steps.slice(index + 1);
      if (candidate.kind !== "module") continue;
      const child = graph[candidate.recipeId];
      const remaining = child ? visit(child, seen) : undefined;
      if (remaining) return [...remaining, ...recipe.steps.slice(index + 1)];
    }
    return undefined;
  };
  // Search from the executable root first so a child's local end does not
  // hide the next instruction in its caller.
  const roots = [ctx.job?.recipeSnapshot, ...Object.values(graph)];
  for (const recipe of roots) {
    if (!recipe) continue;
    const remaining = visit(recipe, new Set());
    if (remaining) return remaining;
  }
  return undefined;
}

function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "JobCancelledError";
}

/** The first viewport the destination verification just observed, reused as
 * the survey's opening frame so the landing raster is never captured twice. */
function verifiedInitialCapture(input: {
  serial: string;
  screenshot?: ScreenshotPayload;
  nodes?: SnapshotNode[];
}): ScrollSurveyCapture | undefined {
  const { screenshot, nodes } = input;
  if (!screenshot || !nodes?.length || !screenshot.width || !screenshot.height) {
    return undefined;
  }
  const bounds = nodes.reduce(
    (current, node) =>
      node.rect
        ? {
            width: Math.max(current.width, node.rect.x + node.rect.width),
            height: Math.max(current.height, node.rect.y + node.rect.height),
          }
        : current,
    { width: 0, height: 0 },
  );
  return {
    screenshot,
    snapshot: {
      serial: input.serial,
      capturedAt: screenshot.capturedAt,
      nodes,
      interactive: nodes.filter((node) => node.hittable === true),
      ...(bounds.width > 0 && bounds.height > 0 ? { bounds } : {}),
      inspectable: true,
      source: "sdk",
      ...(screenshot.foregroundApp ? { foregroundApp: screenshot.foregroundApp } : {}),
      screenIdentity: observeScreenIdentity(nodes),
    },
  };
}

/** Survey the verified destination and persist its frames as run evidence.
 * Never throws for a survey failure — the run result stays with the verified
 * first viewport. */
export async function runDestinationEvidenceSurvey(
  step: DestinationSurveyStep,
  ctx: RecipeStepContext,
  verified: { nodes?: SnapshotNode[]; screenshot?: ScreenshotPayload },
  dependencies: DestinationSurveyDependencies = {},
): Promise<void> {
  const survey = step.destinationSurvey;
  const job = ctx.job;
  if (!survey || !job) return;
  const serial = job.serial?.trim();
  // Browser targets and jobs without a device serial have no scroll surface
  // to survey, and redaction forbids keeping the pixels at all.
  if (!serial || job.targetKind === "browser" || !visualEvidenceAllowed()) return;
  const initialCapture = verifiedInitialCapture({
    serial,
    screenshot: verified.screenshot,
    nodes: verified.nodes,
  });
  let result: ScrollSurveyResult | undefined;
  try {
    const remaining = dependencies.remainingSteps ?? remainingRecipeStepsAfter(step, ctx);
    const restore =
      survey.restore === false ||
      (survey.restore !== true &&
        remaining !== undefined &&
        !destinationSurveyShouldRestore(remaining))
        ? false
        : undefined;
    result = await (dependencies.captureSurvey ?? captureScrollableSurveyForTarget)({
      serial,
      maxScrolls: survey.maxScrolls,
      ...(restore === false ? { restore: false } : {}),
      ...(initialCapture ? { initialCapture } : {}),
    });
    await persistDestinationSurveyFrames(job, step, result);
    ctx.log(
      `destination survey: ${step.screenTitle} · ${result.frames.length} viewport frame(s) · ${result.reason}`,
    );
  } catch (error) {
    if (isCancellation(error)) throw error;
    // An unknown iOS scroll outcome leaves the viewport unreliable; that
    // mutation-safety contract stays terminal like every other iOS effect.
    rethrowIosMutationOutcomeUnknown(error);
    ctx.log(
      `warn: destination survey of ${step.screenTitle} failed; the verified first viewport remains the evidence (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  } finally {
    // The landing proof describes the top viewport. A survey that could not
    // prove its way back leaves that proof stale, and an honest cursor is
    // cheaper than a later step trusting a mid-scroll tree.
    if (!result?.restoredStartViewport && ctx.runtime) {
      ctx.runtime.observation = undefined;
      markNavigationUnknown(
        ctx,
        "The destination survey could not prove the first viewport was restored.",
      );
    }
  }
}
