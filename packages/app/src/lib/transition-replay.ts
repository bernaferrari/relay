import type { RecipeStep } from "@relay/protocol";

export type TransitionReplayResult =
  | { ok: true }
  | { ok: false; error: string; failedStepIndex: number };

/**
 * Reproduce one connection without running the rest of the Flow. Keeping this
 * orchestration pure makes transition approval deterministic and prevents a
 * failed action from spilling into the next screen.
 */
export async function replayTransitionSteps(
  steps: RecipeStep[],
  runStep: (step: RecipeStep) => Promise<{ ok: boolean; error?: string }>,
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
      };
    }
  }
  return { ok: true };
}
