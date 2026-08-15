import type { Device } from "./device.js";
import { retryDeferredCampaignChecks } from "./recipe-runner-extended-steps.js";
import { runRecipeStep } from "./recipe-runner.js";
import type { RecipeRuntimeState, RecipeStepContext } from "./recipe-runner-context.js";
import type { TestJob } from "./session-contract.js";

export async function retryDeferredChecksForJob(
  device: Device,
  job: TestJob,
  log: (line: string) => void,
  runtime: RecipeRuntimeState,
): Promise<void> {
  const ctx: RecipeStepContext = { log, job, recipeGraph: job.recipeGraph, runtime };
  await retryDeferredCampaignChecks(device, ctx, (recipeId) =>
    runRecipeStep(device, { kind: "module", recipeId }, ctx),
  );
}
