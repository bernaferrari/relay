import type { Recipe, RecipeStep } from "./recipes.js";
import { now } from "./events.js";
import {
  campaignCoverageForbiddenEffect,
  type RecipeStepContext,
} from "./recipe-runner-context.js";

export type FrozenCampaignEffect = {
  recipeId: string;
  stepId?: string;
  reason: string;
};

/** Recursively classify nested coverage recipes. Proposed cold recovery is excluded
 * so a later single-use approval can still name the exact reset path. */
export function frozenColdCoverageEffects(input: {
  graph: Readonly<Record<string, Recipe>>;
  coverageRecipeId: string;
  warmRecoveryRecipeId?: string;
  cleanupRecipeId?: string;
  excludedRecipeIds?: Array<string | undefined>;
}): FrozenCampaignEffect[] {
  const excluded = new Set(input.excludedRecipeIds?.filter((id): id is string => Boolean(id)));
  const seen = new Set<string>();
  const found: FrozenCampaignEffect[] = [];
  walkRecipe(input.graph, input.coverageRecipeId, excluded, seen, found);
  if (input.warmRecoveryRecipeId) {
    walkRecipe(input.graph, input.warmRecoveryRecipeId, excluded, seen, found);
  }
  if (input.cleanupRecipeId) {
    walkRecipe(input.graph, input.cleanupRecipeId, excluded, seen, found);
  }
  return found;
}

function walkRecipe(
  graph: Readonly<Record<string, Recipe>>,
  recipeId: string,
  excluded: Set<string>,
  seen: Set<string>,
  found: FrozenCampaignEffect[],
): void {
  if (!recipeId || excluded.has(recipeId) || seen.has(recipeId)) return;
  seen.add(recipeId);
  const recipe = graph[recipeId];
  if (!recipe) return;
  for (const step of recipe.steps) walkStep(graph, recipeId, step, excluded, seen, found);
}

function walkStep(
  graph: Readonly<Record<string, Recipe>>,
  recipeId: string,
  step: RecipeStep,
  excluded: Set<string>,
  seen: Set<string>,
  found: FrozenCampaignEffect[],
): void {
  const reason = campaignCoverageForbiddenEffect(step);
  if (reason) {
    found.push({
      recipeId,
      ...(step.id ? { stepId: step.id } : {}),
      reason,
    });
  }
  if (step.kind === "module" || step.kind === "repeat") {
    walkRecipe(graph, step.recipeId, excluded, seen, found);
  }
  if (step.kind === "branch") {
    walkRecipe(graph, step.thenRecipeId, excluded, seen, found);
    if (step.elseRecipeId) walkRecipe(graph, step.elseRecipeId, excluded, seen, found);
  }
}

export function rejectForbiddenCoverageEffect(step: RecipeStep, ctx: RecipeStepContext): void {
  if (!ctx.runtime?.campaignCoverageStarted) return;
  const blockedEffect = campaignCoverageForbiddenEffect(step);
  if (!blockedEffect) return;
  const capturedAt = now();
  ctx.job?.artifacts.push({
    kind: "campaign-effect-blocked",
    capturedAt,
    data: {
      schemaVersion: 1,
      stepId: step.id,
      stepKind: step.kind,
      effect: {
        kind: step.kind,
        ...("action" in step ? { action: step.action } : {}),
        ...("app" in step && step.app ? { app: step.app } : {}),
        ...("relaunch" in step && step.relaunch !== undefined ? { relaunch: step.relaunch } : {}),
        ...("url" in step && step.url ? { hasUrl: true } : {}),
        ...("setting" in step ? { setting: step.setting } : {}),
        ...("key" in step ? { key: step.key } : {}),
      },
      reason: blockedEffect,
      coverageStarted: true,
    },
  });
  ctx.log(`campaign safety: blocked ${step.kind} — ${blockedEffect}`);
  throw new Error(`Campaign safety blocked ${step.kind}: ${blockedEffect}`);
}

export function boundCoverageExpectScreen<T extends Extract<RecipeStep, { kind: "expect-screen" }>>(
  step: T,
  ctx: RecipeStepContext,
): T {
  if (!ctx.runtime?.campaignCoverageStarted || !step.recovery) return step;
  if ((step.recovery.maxAttempts ?? 8) <= 1) return step;
  ctx.log("campaign safety: bounded semantic Back recovery to one reviewed attempt");
  return { ...step, recovery: { ...step.recovery, maxAttempts: 1 } };
}
