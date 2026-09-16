import {
  describeCoverageStepReason,
  describeCoverageStepReasons,
  type CoverageStepReason,
  type RecipeStep,
} from "@relay/protocol";
import type { TraceStep } from "./trace.js";

export { describeCoverageStepReason, describeCoverageStepReasons };
export type { CoverageStepReason };

type CoverageArtifact = { kind?: unknown; data?: unknown };

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function leftoverSkipForbidden(step: RecipeStep): boolean {
  return step.coverage === "transition" && step.when?.condition === "absent";
}

export function inspectSetupSkip(step: RecipeStep): boolean {
  return step.coverage === "inspect" && step.when?.condition === "absent";
}

export function coverageStepReasonFromArtifact(
  artifact: CoverageArtifact,
): CoverageStepReason | undefined {
  const data = record(artifact.data);
  const reason = data?.reason;
  if (reason !== "inspect-setup-skipped" && reason !== "transition-executed") return undefined;
  if (artifact.kind === "conditional-step-skipped" && reason === "inspect-setup-skipped") {
    return reason;
  }
  if (artifact.kind === "coverage-step-result" && reason === "transition-executed") return reason;
  return undefined;
}

export function coverageOutcomesFromArtifacts(
  artifacts: readonly CoverageArtifact[],
): CoverageStepReason[] {
  const reasons: CoverageStepReason[] = [];
  const seen = new Set<CoverageStepReason>();
  for (const artifact of artifacts) {
    const reason = coverageStepReasonFromArtifact(artifact);
    if (!reason || seen.has(reason)) continue;
    seen.add(reason);
    reasons.push(reason);
  }
  return reasons;
}

export function applyCoverageOutcomeToTrace(
  step: TraceStep,
  artifacts: readonly CoverageArtifact[],
): void {
  const reasons = coverageOutcomesFromArtifacts(artifacts);
  if (reasons.includes("inspect-setup-skipped")) {
    step.title = describeCoverageStepReason("inspect-setup-skipped");
    step.glyphs = ["wait"];
    step.actions = [];
    return;
  }
  if (reasons.includes("transition-executed")) {
    step.title = describeCoverageStepReason("transition-executed");
  }
}
