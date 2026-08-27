import type { RecipeStep } from "./recipes.js";
import { writeFramePng } from "./runs.js";
import { writeFrameTree } from "./run-frame-tree.js";
import type { ScrollSurveyResult } from "./scrollable-survey-types.js";
import type { TestJob } from "./session-contract.js";

const UNUSABLE_SURVEY_REASONS = new Set([
  "inspection-unavailable",
  "missing-page-anchor",
  "screen-changed",
  "scroll-failed",
  "restore-failed",
  "start-viewport-unproven",
  "seam-ambiguous",
  "dimension-changed",
]);

export function captureSurfaceSurveyFailure(input: { screenTitle: string; reason: string }): Error {
  return new Error(
    `surface: ${input.screenTitle} · full-surface survey did not run (${input.reason}). A single viewport is not complete.`,
  );
}

/** A requested full-surface survey is complete only when every frame kept its tree. */
export function assertCaptureSurfaceSurveyUsable(
  survey: Pick<ScrollSurveyResult, "frames" | "reason">,
  step: Pick<Extract<RecipeStep, { kind: "capture-surface" }>, "screenTitle">,
): void {
  if (!survey.frames.length) {
    throw captureSurfaceSurveyFailure({ screenTitle: step.screenTitle, reason: "no frames" });
  }
  if (UNUSABLE_SURVEY_REASONS.has(survey.reason)) {
    throw captureSurfaceSurveyFailure({ screenTitle: step.screenTitle, reason: survey.reason });
  }
  if (survey.frames.some((frame) => !frame.snapshot.nodes.length)) {
    throw captureSurfaceSurveyFailure({
      screenTitle: step.screenTitle,
      reason: "a viewport had no tree",
    });
  }
}

async function persistSurveyFrames(
  job: TestJob,
  screenTitle: string,
  survey: Pick<ScrollSurveyResult, "frames">,
  label: string,
): Promise<void> {
  for (const [index, frame] of survey.frames.entries()) {
    const written = await writeFramePng(
      job,
      frame.screenshot.base64,
      `${label}:${screenTitle} · ${index + 1}`,
    );
    if (frame.snapshot.nodes.length) {
      await writeFrameTree(job, written.path, frame.snapshot.nodes);
    }
  }
}

export async function persistCaptureSurfaceSurveyFrames(
  job: TestJob,
  step: Pick<Extract<RecipeStep, { kind: "capture-surface" }>, "screenTitle">,
  survey: Pick<ScrollSurveyResult, "frames">,
): Promise<void> {
  await persistSurveyFrames(job, step.screenTitle, survey, "surface");
}

/** Destination-landing evidence uses the same frame+tree persistence, labeled
 * so a reviewer can tell an automatic survey apart from a bound full-surface
 * comparison. */
export async function persistDestinationSurveyFrames(
  job: TestJob,
  destination: Pick<Extract<RecipeStep, { kind: "expect-screen" }>, "screenTitle">,
  survey: Pick<ScrollSurveyResult, "frames">,
): Promise<void> {
  await persistSurveyFrames(job, destination.screenTitle, survey, "destination");
}
