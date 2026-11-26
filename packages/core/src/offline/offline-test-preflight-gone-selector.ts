import type { NormalizedSemanticNode, OfflineTestPreflightSelector } from "@relay/protocol";
import type { SelectorAssessment } from "./offline-test-preflight-selector-assessment.js";
import {
  boundedCandidates,
  matchesTarget,
  targetDescription,
} from "./offline-test-preflight-selector-utils.js";

/** Disappearance is a presence check, so disabled and non-hittable content
 * still counts. Frozen absence permits replay; it never proves the live wait. */
export function goneSelectorAssessment(input: {
  base: Omit<OfflineTestPreflightSelector, "status" | "evidence">;
  evidence: OfflineTestPreflightSelector["evidence"];
  observations: readonly { nodes: NormalizedSemanticNode[] }[];
}): SelectorAssessment {
  const matches = input.observations.map((observation) =>
    matchesTarget(observation.nodes, input.base.target),
  );
  const ambiguous = matches.find((candidates) => candidates.length > 1);
  const candidates = ambiguous ?? matches.find((candidates) => candidates.length) ?? [];
  return {
    selector: {
      ...input.base,
      status: ambiguous ? "ambiguous" : "resolved",
      evidence: input.evidence,
      ...(candidates.length ? { candidates: boundedCandidates(candidates) } : {}),
      detail: ambiguous
        ? `${ambiguous.length} frozen candidates match the disappearance check.`
        : candidates.length
          ? "One target is present in frozen evidence; its disappearance remains a runtime check."
          : "The target is absent in frozen evidence; its disappearance remains a runtime check.",
    },
    findings: ambiguous
      ? [
          {
            severity: "blocker",
            code: "selector-ambiguous",
            recipeId: input.base.recipeId,
            ...(input.base.recipeStepId ? { recipeStepId: input.base.recipeStepId } : {}),
            message: `${targetDescription(input.base.target)} matches ${ambiguous.length} frozen candidates; make the disappearance selector unambiguous before replay.`,
            candidates: boundedCandidates(ambiguous),
          },
        ]
      : [],
  };
}
