import type { RecipeStep, StandaloneStepReview } from "@relay/protocol";

export type TransitionReplayResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      failedStepIndex: number;
      /** The connection must stop for an explicit current-screen review. */
      terminal?: "review-needed";
      stepReview?: StandaloneStepReview;
    };

type ReplayStepResult =
  | { ok: true }
  | { ok: false; error?: string; terminal?: "review-needed"; stepReview?: StandaloneStepReview };

/**
 * Reproduce one connection without running the rest of the Flow. Keeping this
 * orchestration pure makes transition approval deterministic and prevents a
 * failed action from spilling into the next screen.
 */
export async function replayTransitionSteps(
  steps: RecipeStep[],
  runStep: (step: RecipeStep) => Promise<ReplayStepResult>,
): Promise<TransitionReplayResult> {
  if (steps.length === 0) {
    return { ok: false, error: "This transition has no actions to replay.", failedStepIndex: 0 };
  }
  for (let index = 0; index < steps.length; index += 1) {
    const result = await runStep(steps[index]!);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error?.trim() || `Action ${index + 1} did not complete.`,
        failedStepIndex: index,
        ...(result.terminal === "review-needed"
          ? {
              terminal: "review-needed" as const,
              ...(result.stepReview ? { stepReview: result.stepReview } : {}),
            }
          : {}),
      };
    }
  }
  return { ok: true };
}
