import type {
  CompatibilityProfileReport,
  CompatibilityReport,
  FailureCategory,
  RunOutcome,
  RunReview,
  TargetProfile,
} from "@relay/protocol";

export type CompatibilityRunEvidence = {
  id: string;
  action: string;
  batchId?: string;
  targetProfile?: TargetProfile;
  status: string;
  outcome?: RunOutcome;
  review?: RunReview;
  failureCategory?: FailureCategory;
  queuedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  artifacts?: Array<{ kind: string; data: unknown }>;
};

function timestamp(run: CompatibilityRunEvidence): number {
  return run.finishedAt ?? run.startedAt ?? run.queuedAt ?? 0;
}

function duration(run: CompatibilityRunEvidence): number | null {
  const started = run.startedAt ?? run.queuedAt;
  return started != null && run.finishedAt != null ? Math.max(0, run.finishedAt - started) : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function classify(
  run: CompatibilityRunEvidence,
): "passed" | "product" | "harness" | "uncertain" | "pending" {
  if (run.status === "queued" || run.status === "running" || run.status === "paused")
    return "pending";
  if (run.review?.status === "pending" || run.review?.status === "rejected") return "uncertain";
  if (run.outcome === "passed" || run.status === "ok" || run.status === "healed") return "passed";
  if (run.outcome === "product-failure") return "product";
  if (run.outcome === "uncertain") return "uncertain";
  return "harness";
}

function reportForProfile(
  profile: TargetProfile,
  current: CompatibilityRunEvidence[],
  history: CompatibilityRunEvidence[],
): CompatibilityProfileReport {
  const summary = (runs: CompatibilityRunEvidence[]) => {
    let passed = 0;
    let productFailures = 0;
    let harnessFailures = 0;
    let uncertain = 0;
    let pending = 0;
    for (const run of runs) {
      const status = classify(run);
      if (status === "passed") passed++;
      else if (status === "product") productFailures++;
      else if (status === "harness") harnessFailures++;
      else if (status === "uncertain") uncertain++;
      else pending++;
    }
    const judged = passed + productFailures;
    return {
      total: runs.length,
      passed,
      productFailures,
      harnessFailures,
      uncertain,
      pending,
      passRate: judged ? passed / judged : null,
      medianDurationMs: median(
        runs.map(duration).filter((value): value is number => value != null),
      ),
    };
  };
  const currentSummary = summary(current);
  const baseline = history.length ? summary(history) : null;
  return {
    profile,
    runIds: current.map((run) => run.id),
    ...currentSummary,
    ...(baseline
      ? {
          baseline: {
            total: baseline.total,
            passRate: baseline.passRate,
            medianDurationMs: baseline.medianDurationMs,
            passRateDelta:
              currentSummary.passRate != null && baseline.passRate != null
                ? currentSummary.passRate - baseline.passRate
                : null,
            durationDeltaMs:
              currentSummary.medianDurationMs != null && baseline.medianDurationMs != null
                ? currentSummary.medianDurationMs - baseline.medianDurationMs
                : null,
          },
        }
      : {}),
  };
}

function matrixMetadata(runs: CompatibilityRunEvidence[]): {
  matrixId?: string;
  matrixName?: string;
} {
  for (const run of runs) {
    const artifact = run.artifacts?.find((item) => item.kind === "compatibility-profile");
    if (!artifact?.data || typeof artifact.data !== "object") continue;
    const data = artifact.data as { matrixId?: unknown; matrixName?: unknown };
    return {
      ...(typeof data.matrixId === "string" ? { matrixId: data.matrixId } : {}),
      ...(typeof data.matrixName === "string" ? { matrixName: data.matrixName } : {}),
    };
  }
  return {};
}

/**
 * Group a frozen compatibility batch into a release-oriented view. Historical
 * runs are consulted only for the same recipe + immutable profile and never
 * mutate the evidence captured for this batch.
 */
export function buildCompatibilityReport(
  runs: CompatibilityRunEvidence[],
  batchId: string,
): CompatibilityReport | null {
  const current = runs.filter((run) => run.batchId === batchId && run.targetProfile);
  if (!current.length) return null;
  const recipeId = current[0]!.action;
  const currentStartedAt = Math.min(...current.map(timestamp));
  const groups = new Map<string, { profile: TargetProfile; current: CompatibilityRunEvidence[] }>();
  for (const run of current) {
    const profile = run.targetProfile!;
    const group = groups.get(profile.id) ?? { profile, current: [] };
    group.current.push(run);
    groups.set(profile.id, group);
  }
  const profiles = [...groups.values()]
    .map((group) => {
      const history = runs.filter(
        (run) =>
          run.action === recipeId &&
          run.batchId !== batchId &&
          run.targetProfile?.id === group.profile.id &&
          timestamp(run) < currentStartedAt,
      );
      return reportForProfile(group.profile, group.current, history);
    })
    .sort((left, right) => left.profile.name.localeCompare(right.profile.name));
  return {
    batchId,
    recipeId,
    ...matrixMetadata(current),
    generatedAt: Date.now(),
    total: current.length,
    profiles,
  };
}
