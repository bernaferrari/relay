import type {
  AppMap,
  AppMapScenarioTest,
  AppMapScenarioTestEdit,
  AppMapScenarioTestStep,
  AppMapTestProposalReview,
  AppMapTestProposalSnapshot,
  Proposal,
} from "./model.js";
import { appMapFail } from "./errors.js";
import { applyScenarioTestStepEdits, findScenarioTestStep } from "./test-step-operations.js";

function allSteps(steps: AppMapScenarioTestStep[]): AppMapScenarioTestStep[] {
  return steps.flatMap((step) => [
    step,
    ...(step.kind === "decision"
      ? allSteps([...step.thenSteps, ...(step.elseSteps ?? [])])
      : step.kind === "loop"
        ? allSteps(step.steps)
        : []),
  ]);
}

function snapshot(test: AppMapScenarioTest): AppMapTestProposalSnapshot {
  const steps = allSteps(test.steps);
  const resolvedStepCount = steps.filter((step) => step.binding.status === "resolved").length;
  return {
    name: test.name,
    stepCount: steps.length,
    resolvedStepCount,
    unresolvedStepCount: steps.length - resolvedStepCount,
  };
}

function shortIntent(step: AppMapScenarioTestStep): string {
  const intent = step.intent.trim().replace(/\s+/gu, " ");
  const clipped = intent.length > 80 ? `${intent.slice(0, 77)}…` : intent;
  return `“${clipped}”`;
}

function placementSummary(edit: Extract<AppMapScenarioTestEdit, { kind: "step.add" }>): string {
  if (!edit.placement?.parentStepId) return "at the top level";
  const branch = edit.placement.branch === "steps" ? "loop body" : edit.placement.branch;
  return `in ${branch} of ${edit.placement.parentStepId}`;
}

function summarizeEdit(test: AppMapScenarioTest, edit: AppMapScenarioTestEdit): string {
  switch (edit.kind) {
    case "test.patch": {
      const changes = [
        ...(edit.patch.name !== undefined && edit.patch.name !== test.name
          ? [`Rename “${test.name}” to “${edit.patch.name}”`]
          : []),
        ...(edit.patch.capture !== undefined ? ["Change evidence capture policy"] : []),
        ...(edit.patch.family !== undefined ? ["Change reviewed Test family routes"] : []),
      ];
      return changes.join("; ") || "Update Test settings";
    }
    case "step.add":
      return `Add ${edit.step.kind} step ${shortIntent(edit.step)} ${placementSummary(edit)}`;
    case "step.patch": {
      const step = findScenarioTestStep(test, edit.stepId)?.step;
      if (!step) return `Update missing step ${edit.stepId}`;
      const fields = [
        ...(edit.patch.intent !== undefined ? ["intent"] : []),
        ...(edit.patch.note !== undefined ? ["note"] : []),
        ...(edit.patch.capture !== undefined ? ["evidence capture"] : []),
        ...(edit.patch.binding !== undefined ? ["binding"] : []),
      ];
      return `Update ${fields.join(", ")} for ${step.kind} step ${shortIntent(step)}`;
    }
    case "step.remove": {
      const step = findScenarioTestStep(test, edit.stepId)?.step;
      if (!step) return `Remove missing step ${edit.stepId}`;
      const nestedCount = allSteps([step]).length - 1;
      return `Remove ${step.kind} step ${shortIntent(step)}${nestedCount ? ` and ${nestedCount} nested ${nestedCount === 1 ? "step" : "steps"}` : ""}`;
    }
    case "step.reorder":
      return `Reorder ${edit.orderedStepIds.length} ${edit.placement?.parentStepId ? `steps in ${edit.placement.parentStepId}` : "top-level steps"}`;
    case "step.bind": {
      const step = findScenarioTestStep(test, edit.stepId)?.step;
      return `Resolve ${step?.kind ?? "missing"} step ${step ? shortIntent(step) : edit.stepId}`;
    }
    case "step.unbind": {
      const step = findScenarioTestStep(test, edit.stepId)?.step;
      return `Mark ${step?.kind ?? "missing"} step ${step ? shortIntent(step) : edit.stepId} unresolved: ${edit.reason}`;
    }
  }
}

/** Applies the canonical semantic operations to a clone and returns a compact,
 * deterministic review projection. Invalid batches fail before submission. */
export function deriveTestProposalReview(
  test: AppMapScenarioTest,
  edits: AppMapScenarioTestEdit[],
): AppMapTestProposalReview {
  let current = structuredClone(test);
  const summaries = edits.map((edit) => {
    const summary = summarizeEdit(current, edit);
    current = applyScenarioTestStepEdits(current, [edit]);
    return {
      kind: edit.kind,
      summary,
      ...("stepId" in edit ? { stepId: edit.stepId } : {}),
    };
  });
  return { before: snapshot(test), after: snapshot(current), edits: summaries };
}

/** Recomputes derived review text from the approved Test and never trusts an
 * agent-supplied preview. This also validates every semantic batch eagerly. */
export function materializeProposalReviews(map: AppMap, proposal: Proposal): Proposal {
  return {
    ...structuredClone(proposal),
    changes: proposal.changes.map((change) => {
      if (change.kind !== "test.edit") return structuredClone(change);
      const test = map.tests[change.testId];
      if (!test) appMapFail("missing-reference", `Test ${change.testId} does not exist`);
      return {
        kind: change.kind,
        testId: change.testId,
        edits: structuredClone(change.edits),
        review: deriveTestProposalReview(test, change.edits),
      };
    }),
  };
}
