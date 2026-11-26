import type { RecipeStep } from "@relay/protocol";

type ReturnRequirementStep = Extract<RecipeStep, { kind: "expect-screen" }>;

/** Resolve the actual repair direction represented by a runtime return marker.
 * The expectation target is authoritative even on repeated-state paths. */
export function appMapTestReturnRepairEndpoints(
  step: ReturnRequirementStep,
): { sourceScreenId: string; destinationScreenId: string } | undefined {
  if (!step.returnRequirement) return undefined;
  const sourceScreenId = step.returnRequirement.destinationScreenId;
  const destinationScreenId = step.screenId;
  return sourceScreenId === destinationScreenId
    ? undefined
    : { sourceScreenId, destinationScreenId };
}
