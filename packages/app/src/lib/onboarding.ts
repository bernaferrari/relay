import type { CompletedRun } from "./first-run";

export type FirstTestStage = "target" | "author" | "run" | "complete";

export type FirstTestState = {
  stage: FirstTestStage;
  targetReady: boolean;
  testReady: boolean;
  runComplete: boolean;
};

export function deriveFirstTestState(input: {
  serverOnline: boolean;
  targetSelected: boolean;
  targetAvailable: boolean;
  recipeSource?: "builtin" | "custom" | null;
  stepCount?: number;
  runs?: CompletedRun[];
  recipeId?: string | null;
}): FirstTestState {
  const targetReady = input.serverOnline && input.targetSelected && input.targetAvailable;
  const testReady = input.recipeSource === "custom" && (input.stepCount ?? 0) > 0;
  const runComplete = Boolean(
    input.recipeId &&
    input.runs?.some(
      (run) => run.action === input.recipeId && (run.status === "ok" || run.status === "healed"),
    ),
  );
  return {
    stage: runComplete ? "complete" : !targetReady ? "target" : !testReady ? "author" : "run",
    targetReady,
    testReady,
    runComplete,
  };
}
