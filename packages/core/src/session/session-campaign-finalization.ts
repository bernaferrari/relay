import { finalizeDeferredCampaignChecks } from "../recipe/recipe-runner-campaign-checks.js";
import type { RecipeRuntimeState, RecipeStepContext } from "../recipe/recipe-runner-context.js";
import type { TestJob } from "./session-contract.js";

export function finalizeDeferredChecksForJob(
  job: TestJob,
  log: (line: string) => void,
  runtime: RecipeRuntimeState,
): void {
  const ctx: RecipeStepContext = { log, job, recipeGraph: job.recipeGraph, runtime };
  finalizeDeferredCampaignChecks(ctx);
}
