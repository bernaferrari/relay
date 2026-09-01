import type { RecipeStep } from "./api-types";
import { sentenceForStep, stepIssue } from "./step-sentence";

export type RecordingCompileConfidence = "high" | "medium" | "low";
export type RecordingCompileStatus = "ready" | "partial" | "blocked";

export type RecordingCompileStep = {
  id: string;
  actionId: string;
  sentence: string;
  confidence: RecordingCompileConfidence;
  status: "ready" | "needs-review" | "failed";
  feedback?: string;
};

export type RecordingCompileGroup = {
  id: string;
  title: string;
  actionIds: string[];
  confidence: RecordingCompileConfidence;
  steps: RecordingCompileStep[];
};

export type RecordingCompileFeedback = {
  actionId: string;
  stepId?: string;
  severity: "warning" | "error";
  message: string;
};

export type RecordingCompileProjection = {
  status: RecordingCompileStatus;
  actionCount: number;
  proposedStepCount: number;
  groups: RecordingCompileGroup[];
  feedback: RecordingCompileFeedback[];
};

type ActionLike = {
  id: string;
  label?: string;
  source?: "captured" | "manual" | "reusable";
  startedAt?: number;
  finishedAt?: number;
  steps: RecipeStep[];
  proof?: {
    status?: "verified" | "pixels-only" | "unresolved";
    outcome?: "passed" | "failed" | "unobserved" | "not-run";
    transition?: "changed" | "unchanged" | "unproven";
    error?: string;
  };
};

function confidenceFor(action: ActionLike): RecordingCompileConfidence {
  if (action.proof?.status === "verified" && action.proof.outcome === "passed") return "high";
  if (action.proof?.status === "pixels-only") return "medium";
  if (action.proof?.status === "verified") return "medium";
  return "low";
}

function confidenceRank(value: RecordingCompileConfidence): number {
  return value === "high" ? 2 : value === "medium" ? 1 : 0;
}

function lowestConfidence(
  values: readonly RecordingCompileConfidence[],
): RecordingCompileConfidence {
  return values.reduce(
    (lowest, value) => (confidenceRank(value) < confidenceRank(lowest) ? value : lowest),
    "high" as RecordingCompileConfidence,
  );
}

function actionBoundary(action: ActionLike): boolean {
  return action.steps.some((step) =>
    ["expect-screen", "pause", "capture-surface", "screenshot"].includes(step.kind),
  );
}

function canJoinRapidGroup(previous: ActionLike, current: ActionLike): boolean {
  if (actionBoundary(previous) || actionBoundary(current)) return false;
  if (previous.label?.trim() && previous.label.trim() === current.label?.trim()) return true;
  if (previous.finishedAt === undefined || current.startedAt === undefined) return false;
  const gap = current.startedAt - previous.finishedAt;
  return gap >= 0 && gap <= 1_000;
}

function groupTitle(
  actions: readonly ActionLike[],
  steps: readonly RecordingCompileStep[],
): string {
  const label = actions.map((action) => action.label?.trim()).find(Boolean);
  if (label) return label;
  const first = steps[0]?.sentence;
  if (!first) return "Uncompiled recording action";
  return actions.length > 1 ? `${first} · ${actions.length} actions` : first;
}

function feedbackFor(
  action: ActionLike,
  step: RecipeStep,
  compiled: RecordingCompileStep,
): RecordingCompileFeedback | undefined {
  const issue = stepIssue(step);
  if (issue) {
    return {
      actionId: action.id,
      stepId: step.id,
      severity: "error",
      message: issue,
    };
  }
  if (action.proof?.outcome === "failed") {
    return {
      actionId: action.id,
      stepId: step.id,
      severity: "error",
      message:
        action.proof.error || "Replay failed; edit this action and replay the recording again.",
    };
  }
  if (action.proof?.outcome === "unobserved" || action.proof?.outcome === "not-run") {
    return {
      actionId: action.id,
      stepId: step.id,
      severity: "warning",
      message: "Replay did not observe this action; replay the reviewed revision before approval.",
    };
  }
  if (action.proof?.transition === "unchanged") {
    return {
      actionId: action.id,
      stepId: step.id,
      severity: "warning",
      message: "No screen change was observed; review whether this action belongs in the Test.",
    };
  }
  if (compiled.confidence !== "high") {
    return {
      actionId: action.id,
      stepId: step.id,
      severity: "warning",
      message:
        action.proof?.status === "pixels-only"
          ? "Pixels were captured, but semantic endpoint proof is still missing."
          : "Replay this action to establish a trustworthy endpoint before approval.",
    };
  }
  return undefined;
}

/** Project an immutable recording revision into review copy. This is a
 * presentation-only view: it groups adjacent actions and reports confidence
 * without rewriting actions, inventing bindings, or creating another recipe. */
export function projectRecordingCompile(
  actions: readonly ActionLike[],
): RecordingCompileProjection {
  const feedback: RecordingCompileFeedback[] = [];
  const groups: RecordingCompileGroup[] = [];
  let current: RecordingCompileGroup | undefined;
  let previous: ActionLike | undefined;

  for (const action of actions) {
    const compiledSteps = action.steps.map((step, stepIndex): RecordingCompileStep => {
      const confidence = confidenceFor(action);
      const invalid = stepIssue(step);
      const status = invalid ? "failed" : confidence === "high" ? "ready" : "needs-review";
      const compiled = {
        id: step.id ?? `${action.id}-step-${stepIndex + 1}`,
        actionId: action.id,
        sentence: sentenceForStep(step),
        confidence,
        status,
        ...(invalid ? { feedback: invalid } : {}),
      } satisfies RecordingCompileStep;
      const feedbackItem = feedbackFor(action, step, compiled);
      if (feedbackItem) feedback.push(feedbackItem);
      return compiled;
    });
    if (!compiledSteps.length) {
      feedback.push({
        actionId: action.id,
        severity: "error",
        message: "No executable steps were compiled from this recording action.",
      });
    }
    const shouldJoin =
      previous !== undefined && current !== undefined && canJoinRapidGroup(previous, action);
    if (!shouldJoin || !current) {
      current = {
        id: `recording-group-${groups.length + 1}`,
        title: groupTitle([action], compiledSteps),
        actionIds: [action.id],
        confidence: confidenceFor(action),
        steps: compiledSteps,
      };
      groups.push(current);
    } else {
      current.actionIds.push(action.id);
      current.steps.push(...compiledSteps);
      current.confidence = lowestConfidence([current.confidence, confidenceFor(action)]);
      current.title = groupTitle(
        current.actionIds
          .map((id) => actions.find((candidate) => candidate.id === id)!)
          .filter(Boolean),
        current.steps,
      );
    }
    previous = action;
  }

  const hasErrors = feedback.some((item) => item.severity === "error");
  const hasWarnings = feedback.some((item) => item.severity === "warning");
  return {
    status:
      actions.length === 0
        ? "blocked"
        : hasErrors
          ? groups.some((group) => group.steps.some((step) => step.status !== "failed"))
            ? "partial"
            : "blocked"
          : hasWarnings
            ? "partial"
            : "ready",
    actionCount: actions.length,
    proposedStepCount: groups.reduce((count, group) => count + group.steps.length, 0),
    groups,
    feedback,
  };
}
