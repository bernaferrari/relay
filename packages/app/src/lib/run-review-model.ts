import type { JobInfo, TraceStep } from "./api-types";

export type RunReviewCounts = {
  checks: number;
  network: number;
  logs: number;
};

/** Start a report at the moment that best explains the outcome. */
export function initialRunReviewStep(job: JobInfo): number {
  const steps = job.steps ?? [];
  if (steps.length === 0) return 0;
  const failed = steps.findIndex(
    (step) => step.status === "error" || step.tone === "danger" || step.status === "failed",
  );
  if (failed >= 0) return failed;
  return steps.length - 1;
}

export function runReviewCounts(job: JobInfo): RunReviewCounts {
  const artifacts = job.artifacts ?? [];
  return {
    checks:
      (job.checks?.length ?? 0) +
      artifacts.filter((item) =>
        [
          "response-completion",
          "conversation-turn",
          "content-assertion",
          "semantic-evaluation",
          "judge-consensus",
          "frozen-inputs",
          "app-build",
        ].includes(item.kind),
      ).length,
    network: artifacts.filter((item) => item.kind === "network").length,
    logs: job.logs?.length ?? 0,
  };
}

export function runCompletion(
  job: JobInfo,
  plannedCount: number,
): {
  observed: number;
  total: number;
  percent: number;
} {
  const observed = job.steps?.length ?? 0;
  const total = Math.max(observed, plannedCount, 1);
  return { observed, total, percent: Math.round((observed / total) * 100) };
}

/**
 * Give each step a duration-aware share of the timeline without letting one
 * slow step make every other step impossible to target.
 */
export function runTimelineWeights(steps: TraceStep[], total: number): number[] {
  const durations = Array.from({ length: total }, (_, index) => {
    const duration = steps[index]?.durationMs;
    return Math.max(180, Math.min(duration ?? 600, 5_000));
  });
  const sum = durations.reduce((value, duration) => value + duration, 0) || 1;
  return durations.map((duration) => duration / sum);
}

export function runElapsedAtStep(steps: TraceStep[], index: number): number {
  return steps
    .slice(0, Math.max(0, index))
    .reduce((elapsed, step) => elapsed + Math.max(0, step.durationMs ?? 0), 0);
}

export function formatReviewTime(value: number): string {
  if (value < 1_000) return `${Math.round(value)}ms`;
  const seconds = value / 1_000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}
