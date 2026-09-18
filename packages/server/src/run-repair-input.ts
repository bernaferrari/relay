import {
  createAppMapTestExecutionIntent,
  deriveAppMapTestRepairExecutionPlan,
  loadFrozenRawAccessibilityEvidence,
  preflightCompiledAppMapTestOffline,
  type CampaignRepairReconciliation,
  type AppMapTestExecutionIntent,
  type EnqueueJobInput,
} from "@relay/core";
import { HttpError } from "./http.js";

/** Freeze a selective repair to the failed Test checkpoint before enqueueing. */
export async function scopedCampaignRepairInput(input: {
  sourceIntent: AppMapTestExecutionIntent | undefined;
  repairInput: EnqueueJobInput;
  reconciliation?: CampaignRepairReconciliation;
}): Promise<EnqueueJobInput> {
  if (!input.sourceIntent) return input.repairInput;
  const root = input.repairInput.recipeSnapshot;
  const graph = input.repairInput.recipeGraph;
  const checkpoint = root?.steps.find(
    (step): step is Extract<(typeof root.steps)[number], { kind: "expect-screen" }> =>
      step.kind === "expect-screen",
  );
  if (!root || !graph || !checkpoint) {
    throw new HttpError(409, "Selective repair has no frozen Test checkpoint to preflight.", {
      code: "APP_MAP_TEST_EXECUTION_INTENT_REVIEW_REQUIRED",
      recovery: "Review the failed check and start a new scoped Test run before retrying it.",
    });
  }
  const plan = deriveAppMapTestRepairExecutionPlan({
    sourcePlan: input.reconciliation?.compiledPlan ?? input.sourceIntent.plan,
    selectedRuntimeTargetProfile: input.sourceIntent.selectedRuntimeTargetProfile,
    recipeGraph: graph,
    rootRecipeId: root.id,
    checkpointScreenId: checkpoint.screenId,
  });
  const preflight = preflightCompiledAppMapTestOffline(
    plan,
    await loadFrozenRawAccessibilityEvidence(plan),
    input.sourceIntent.selectedRuntimeTargetProfile
      ? { targetProfileId: input.sourceIntent.selectedRuntimeTargetProfile.id }
      : {},
  );
  if (preflight.summary.blockers) {
    throw new HttpError(
      409,
      "Selective repair needs offline review before Relay can control the target.",
      {
        code: "APP_MAP_TEST_EXECUTION_INTENT_REVIEW_REQUIRED",
        preflight,
        recovery:
          "Repair the frozen evidence or current Test plan, then start a new scoped Test run before retrying this check.",
      },
    );
  }
  const executionIntent = createAppMapTestExecutionIntent({ plan, recipeGraph: graph, preflight });
  const capturedAt = Date.now();
  return {
    ...input.repairInput,
    artifacts: [
      { kind: "app-map-test-execution-intent", capturedAt, data: executionIntent },
      // A repair is a distinct frozen Test contract; do not leave competing
      // prior plan or intent roots beside it.
      { kind: "app-map-test-plan", capturedAt, data: structuredClone(plan) },
      ...(input.repairInput.artifacts ?? []).filter(
        (artifact) =>
          artifact.kind !== "app-map-test-execution-intent" &&
          artifact.kind !== "app-map-test-plan",
      ),
    ],
  };
}
