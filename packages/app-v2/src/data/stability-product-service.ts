import type { ProductRunSummary, ProductRunFilter } from "@relay/product/catalog";
import type { ProductBatchCase, ProductBatchReport } from "@relay/product/run-across";
import type { RunOutcome } from "@relay/protocol";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";
import { groupComparableStabilitySamples } from "./stability-cohort";

/** A product-level observation projected from durable Run or Batch evidence. */
export type ProductStabilitySample = {
  readonly id: string;
  readonly runId?: string;
  readonly appMapId?: string;
  readonly testId?: string;
  readonly environmentId?: string;
  readonly testRevision?: string | number;
  readonly sourceRevision?: string;
  readonly buildId?: string;
  readonly targetProfileId?: string;
  readonly accountId?: string;
  readonly dataSetId?: string;
  readonly startupMode?: string;
  readonly outcome?: RunOutcome;
  readonly status?: string;
  readonly queuedAt?: number;
  readonly finishedAt?: number;
  readonly durationMs?: number;
  /** Review owner from Batch triage. Absent on ordinary Run history. */
  readonly assignee?: string;
  /** Failure-cluster identity when the caller joined cluster members. */
  readonly clusterId?: string;
};

export type ProductStabilityScope = {
  readonly appMapId?: string;
  readonly testId?: string;
  readonly environmentId?: string;
};

export type ProductStabilityConfidence = "complete" | "partial" | "unknown";
export type ProductStabilityTrend = "improving" | "regressing" | "stable" | "unknown";

export type ProductStabilityBucket = {
  readonly environmentId: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly unknown: number;
  readonly passRate: number | null;
  readonly confidence: ProductStabilityConfidence;
};

export type ProductStabilitySignal = {
  readonly kind:
    | "possible-flakiness"
    | "mixed-outcomes"
    | "environment-recurrence"
    | "duration-regression"
    | "open-ownership";
  readonly severity: "info" | "warning";
  readonly summary: string;
  readonly runIds: readonly string[];
  readonly environmentId?: string;
  /** Present on possible-flakiness when the comparable cohort has a Test id. */
  readonly testId?: string;
};

export type ProductStabilityOwner = {
  readonly assignee: string;
  readonly caseCount: number;
  readonly problemCount: number;
};

export type ProductStabilityAppBucket = {
  readonly appMapId: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly unknown: number;
  readonly passRate: number | null;
  readonly confidence: ProductStabilityConfidence;
};

export type ProductStabilityClusterBucket = {
  readonly clusterId: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly unknown: number;
  readonly passRate: number | null;
  readonly confidence: ProductStabilityConfidence;
};

export type ProductStabilityRecommendation = {
  readonly id: string;
  readonly action: "rerun-flake" | "inspect-environment" | "inspect-duration" | "review-owned";
  readonly summary: string;
  readonly runIds: readonly string[];
  readonly environmentId?: string;
};

export type ProductStabilitySummary = {
  readonly scope: ProductStabilityScope;
  readonly sampleCount: number;
  readonly completedCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly unknownCount: number;
  readonly passRate: number | null;
  readonly medianDurationMs: number | null;
  readonly trend: ProductStabilityTrend;
  readonly confidence: ProductStabilityConfidence;
  /** False means the caller supplied a bounded/partial history window. */
  readonly historyComplete: boolean;
  readonly runIds: readonly string[];
  readonly byEnvironment: readonly ProductStabilityBucket[];
  readonly byApp: readonly ProductStabilityAppBucket[];
  readonly byCluster: readonly ProductStabilityClusterBucket[];
  readonly owners: readonly ProductStabilityOwner[];
  readonly signals: readonly ProductStabilitySignal[];
  readonly recommendations: readonly ProductStabilityRecommendation[];
};

export type ProductStabilitySummaryInput = {
  readonly samples: readonly ProductStabilitySample[];
  /** Explicitly identifies whether the caller loaded the complete history. */
  readonly historyComplete: boolean;
  readonly scope?: ProductStabilityScope;
};

export type StabilityProductService = {
  /** Reads canonical Run summaries; it does not create or persist history. */
  listRuns(filter?: ProductRunFilter): Promise<readonly ProductRunSummary[]>;
  summarize(input: ProductStabilitySummaryInput): ProductStabilitySummary;
  summarizeRuns(input: {
    readonly filter?: ProductRunFilter;
    readonly historyComplete: boolean;
    readonly scope?: ProductStabilityScope;
  }): Promise<ProductStabilitySummary>;
  summarizeBatch(
    report: ProductBatchReport,
    scope?: ProductStabilityScope,
  ): ProductStabilitySummary;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function runIdentity(run: ProductRunSummary): Pick<ProductStabilitySample, "appMapId" | "testId"> {
  return {
    appMapId: run.appMapId ?? run.identity.appMapId,
    testId: run.testId ?? run.identity.testId,
  };
}

/** Converts the existing catalog projection without copying raw evidence. */
export function stabilitySampleFromRun(run: ProductRunSummary): ProductStabilitySample {
  const identity = runIdentity(run);
  const execution = run.executionIdentity;
  const targetProfileId = execution?.targetProfileId ?? execution?.deviceId;
  return {
    id: run.id,
    runId: run.identity.runId || run.id,
    ...identity,
    ...(targetProfileId ? { environmentId: targetProfileId, targetProfileId } : {}),
    ...(execution?.appMapRevision !== undefined ? { testRevision: execution.appMapRevision } : {}),
    ...(execution?.sourceRevision ? { sourceRevision: execution.sourceRevision } : {}),
    ...(execution?.buildId ? { buildId: execution.buildId } : {}),
    ...(execution?.accountId ? { accountId: execution.accountId } : {}),
    ...(execution?.dataSetId ? { dataSetId: execution.dataSetId } : {}),
    ...(run.outcome ? { outcome: run.outcome } : {}),
    status: run.status,
    queuedAt: run.queuedAt,
    ...(run.finishedAt !== undefined ? { finishedAt: run.finishedAt } : {}),
    ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
  };
}

export function stabilitySamplesFromRuns(
  runs: readonly ProductRunSummary[],
): readonly ProductStabilitySample[] {
  return runs.map(stabilitySampleFromRun);
}

/** Join current failure-cluster membership onto Batch samples by exact case id. */
export function attachStabilityClusterIds(
  samples: readonly ProductStabilitySample[],
  clusters: readonly { id: string; caseIds: readonly string[] }[],
): readonly ProductStabilitySample[] {
  const clusterByCase = new Map<string, string>();
  for (const cluster of clusters) {
    for (const caseId of cluster.caseIds) {
      if (!clusterByCase.has(caseId)) clusterByCase.set(caseId, cluster.id);
    }
  }
  return samples.map((sample) => {
    const clusterId = clusterByCase.get(sample.id);
    return clusterId ? { ...sample, clusterId } : sample;
  });
}

export function stabilityMaintenanceRecommendations(
  signals: readonly ProductStabilitySignal[],
): readonly ProductStabilityRecommendation[] {
  const recommendations: ProductStabilityRecommendation[] = [];
  for (const signal of signals) {
    if (signal.kind === "possible-flakiness") {
      recommendations.push({
        id: `rerun-flake:${signal.environmentId ?? "all"}`,
        action: "rerun-flake",
        summary:
          "Compare these Runs. They used the same Test revision, build, target, account, and starting state.",
        runIds: signal.runIds,
        ...(signal.environmentId ? { environmentId: signal.environmentId } : {}),
      });
    } else if (signal.kind === "mixed-outcomes") {
      recommendations.push({
        id: `compare-mixed:${signal.environmentId ?? "all"}`,
        action: "inspect-environment",
        summary: "Different outcomes were observed. Compare these Runs.",
        runIds: signal.runIds,
        ...(signal.environmentId ? { environmentId: signal.environmentId } : {}),
      });
    } else if (signal.kind === "environment-recurrence") {
      recommendations.push({
        id: `inspect-environment:${signal.environmentId ?? "all"}`,
        action: "inspect-environment",
        summary: "Inspect this environment before adding more coverage there.",
        runIds: signal.runIds,
        ...(signal.environmentId ? { environmentId: signal.environmentId } : {}),
      });
    } else if (signal.kind === "duration-regression") {
      recommendations.push({
        id: "inspect-duration",
        action: "inspect-duration",
        summary: "Investigate the duration increase before the next release.",
        runIds: signal.runIds,
      });
    } else if (signal.kind === "open-ownership") {
      recommendations.push({
        id: "review-owned",
        action: "review-owned",
        summary: "Review the assigned cases with their owners.",
        runIds: signal.runIds,
      });
    }
  }
  return recommendations;
}

function terminalBatchStatus(status: ProductBatchCase["status"]): boolean {
  return (
    status === "passed" || status === "failed" || status === "blocked" || status === "cancelled"
  );
}

/** Converts a durable Batch report. Cases without identity remain visible as unknown. */
export function stabilitySamplesFromBatch(
  report: ProductBatchReport,
): readonly ProductStabilitySample[] {
  return report.cases.map((item) => ({
    id: item.id,
    ...(item.runId ? { runId: item.runId } : {}),
    ...(item.identity
      ? {
          appMapId: report.setup?.appMapId,
          testId: item.identity.testId,
          environmentId: item.identity.environmentId,
        }
      : {}),
    status: item.status,
    ...(item.assignee ? { assignee: item.assignee } : {}),
  }));
}

function sampleOutcome(sample: ProductStabilitySample): "passed" | "failed" | "unknown" {
  if (sample.outcome === "passed") return "passed";
  if (sample.outcome === "product-failure") return "failed";
  // A Batch's `failed` state does not distinguish product from harness failure.
  if (sample.outcome !== undefined) return "unknown";
  return sample.status === "passed" ? "passed" : "unknown";
}

function inScope(sample: ProductStabilitySample, scope: ProductStabilityScope): boolean {
  return (
    (scope.appMapId === undefined ||
      sample.appMapId === undefined ||
      sample.appMapId === scope.appMapId) &&
    (scope.testId === undefined || sample.testId === undefined || sample.testId === scope.testId) &&
    (scope.environmentId === undefined ||
      sample.environmentId === undefined ||
      sample.environmentId === scope.environmentId)
  );
}

function hasIdentity(sample: ProductStabilitySample, scope: ProductStabilityScope): boolean {
  return (
    sample.appMapId !== undefined &&
    sample.testId !== undefined &&
    (scope.environmentId === undefined || sample.environmentId !== undefined)
  );
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function timeOf(sample: ProductStabilitySample): number | undefined {
  return finite(sample.finishedAt)
    ? sample.finishedAt
    : finite(sample.queuedAt)
      ? sample.queuedAt
      : undefined;
}

function confidence(
  count: number,
  historyComplete: boolean,
  identityComplete: boolean,
  outcomesComplete: boolean,
): ProductStabilityConfidence {
  if (!count) return "unknown";
  return historyComplete && identityComplete && outcomesComplete ? "complete" : "partial";
}

function signalRunIds(samples: readonly ProductStabilitySample[]): readonly string[] {
  return [...new Set(samples.map((sample) => sample.runId ?? sample.id))];
}

function stabilityTrend(
  samples: readonly ProductStabilitySample[],
  passRate: number | null,
  confidenceValue: ProductStabilityConfidence,
): ProductStabilityTrend {
  if (passRate === null || confidenceValue !== "complete" || samples.length < 4) return "unknown";
  const ordered = [...samples].sort(
    (a, b) => (timeOf(a) ?? Number.NaN) - (timeOf(b) ?? Number.NaN),
  );
  if (ordered.some((sample) => timeOf(sample) === undefined)) return "unknown";
  const split = Math.floor(ordered.length / 2);
  const first = ordered.slice(0, split).map(sampleOutcome);
  const second = ordered.slice(split).map(sampleOutcome);
  const rate = (values: readonly ("passed" | "failed" | "unknown")[]) => {
    if (values.some((value) => value === "unknown")) return null;
    return values.filter((value) => value === "passed").length / values.length;
  };
  const firstRate = rate(first);
  const secondRate = rate(second);
  if (firstRate === null || secondRate === null) return "unknown";
  const delta = secondRate - firstRate;
  if (delta >= 0.15) return "improving";
  if (delta <= -0.15) return "regressing";
  return "stable";
}

function durationSignal(
  samples: readonly ProductStabilitySample[],
): ProductStabilitySignal | undefined {
  if (
    samples.length < 4 ||
    samples.some((sample) => !finite(sample.durationMs) || timeOf(sample) === undefined)
  ) {
    return undefined;
  }
  const ordered = [...samples].sort((a, b) => timeOf(a)! - timeOf(b)!);
  const split = Math.floor(ordered.length / 2);
  const first = median(ordered.slice(0, split).map((sample) => sample.durationMs!));
  const second = median(ordered.slice(split).map((sample) => sample.durationMs!));
  if (first === null || second === null || first <= 0 || second <= first * 1.2) return undefined;
  return {
    kind: "duration-regression",
    severity: "warning",
    summary: `Median duration increased from ${first}ms to ${second}ms.`,
    runIds: signalRunIds(ordered),
  };
}

export function summarizeProductStability(
  input: ProductStabilitySummaryInput,
): ProductStabilitySummary {
  const scope = input.scope ?? {};
  const samples = input.samples.filter((sample) => inScope(sample, scope));
  const outcomes = samples.map(sampleOutcome);
  const passedCount = outcomes.filter((value) => value === "passed").length;
  const failedCount = outcomes.filter((value) => value === "failed").length;
  const unknownCount = outcomes.length - passedCount - failedCount;
  const identityComplete = samples.every((sample) => hasIdentity(sample, scope));
  const outcomesComplete = unknownCount === 0;
  const confidenceValue = confidence(
    samples.length,
    input.historyComplete,
    identityComplete,
    outcomesComplete,
  );
  const passRate = confidenceValue === "complete" ? passedCount / samples.length : null;
  const durations = samples.map((sample) => sample.durationMs);
  const medianDurationMs =
    confidenceValue === "complete" && durations.every(finite)
      ? median(durations as number[])
      : null;

  const environmentIds = [
    ...new Set(samples.flatMap((sample) => (sample.environmentId ? [sample.environmentId] : []))),
  ].sort();
  const byEnvironment = environmentIds.map((environmentId) => {
    const members = samples.filter((sample) => sample.environmentId === environmentId);
    const memberOutcomes = members.map(sampleOutcome);
    const memberPassed = memberOutcomes.filter((value) => value === "passed").length;
    const memberFailed = memberOutcomes.filter((value) => value === "failed").length;
    const memberUnknown = members.length - memberPassed - memberFailed;
    const memberIdentityComplete = members.every((sample) =>
      hasIdentity(sample, { ...scope, environmentId }),
    );
    const memberConfidence = confidence(
      members.length,
      input.historyComplete,
      memberIdentityComplete,
      memberUnknown === 0,
    );
    return {
      environmentId,
      total: members.length,
      passed: memberPassed,
      failed: memberFailed,
      unknown: memberUnknown,
      passRate: memberConfidence === "complete" ? memberPassed / members.length : null,
      confidence: memberConfidence,
    };
  });

  const appIds = [
    ...new Set(samples.flatMap((sample) => (sample.appMapId ? [sample.appMapId] : []))),
  ].sort();
  const byApp = appIds.map((appMapId) => {
    const members = samples.filter((sample) => sample.appMapId === appMapId);
    const memberOutcomes = members.map(sampleOutcome);
    const memberPassed = memberOutcomes.filter((value) => value === "passed").length;
    const memberFailed = memberOutcomes.filter((value) => value === "failed").length;
    const memberUnknown = members.length - memberPassed - memberFailed;
    const memberIdentityComplete = members.every((sample) => sample.appMapId !== undefined);
    const memberConfidence = confidence(
      members.length,
      input.historyComplete,
      memberIdentityComplete,
      memberUnknown === 0,
    );
    return {
      appMapId,
      total: members.length,
      passed: memberPassed,
      failed: memberFailed,
      unknown: memberUnknown,
      passRate: memberConfidence === "complete" ? memberPassed / members.length : null,
      confidence: memberConfidence,
    };
  });

  const clusterIds = [
    ...new Set(samples.flatMap((sample) => (sample.clusterId ? [sample.clusterId] : []))),
  ].sort();
  const byCluster = clusterIds.map((clusterId) => {
    const members = samples.filter((sample) => sample.clusterId === clusterId);
    const memberOutcomes = members.map(sampleOutcome);
    const memberPassed = memberOutcomes.filter((value) => value === "passed").length;
    const memberFailed = memberOutcomes.filter((value) => value === "failed").length;
    const memberUnknown = members.length - memberPassed - memberFailed;
    const memberConfidence = confidence(
      members.length,
      input.historyComplete,
      true,
      memberUnknown === 0,
    );
    return {
      clusterId,
      total: members.length,
      passed: memberPassed,
      failed: memberFailed,
      unknown: memberUnknown,
      passRate: memberConfidence === "complete" ? memberPassed / members.length : null,
      confidence: memberConfidence,
    };
  });

  const signals: ProductStabilitySignal[] = [];
  if (input.historyComplete && identityComplete && outcomesComplete) {
    const comparable = groupComparableStabilitySamples(samples);
    const comparableIds = new Set(
      [...comparable.values()].flatMap((group) => group.map((sample) => sample.id)),
    );
    for (const group of comparable.values()) {
      const groupOutcomes = new Set(group.map(sampleOutcome));
      if (group.length >= 2 && groupOutcomes.has("passed") && groupOutcomes.has("failed")) {
        signals.push({
          kind: "possible-flakiness",
          severity: "warning",
          summary:
            "This Test passed and failed on the same revision, build, target, account, and starting state.",
          environmentId: group[0]!.environmentId ?? group[0]!.targetProfileId,
          runIds: signalRunIds(group),
          ...(group[0]!.testId ? { testId: group[0]!.testId } : {}),
        });
      }
    }
    const mixed = samples.filter((sample) => !comparableIds.has(sample.id));
    const mixedOutcomes = new Set(mixed.map(sampleOutcome));
    if (mixed.length >= 2 && mixedOutcomes.has("passed") && mixedOutcomes.has("failed")) {
      signals.push({
        kind: "mixed-outcomes",
        severity: "info",
        summary: "Different outcomes were observed. Compare these Runs.",
        runIds: signalRunIds(mixed),
      });
    }
    for (const bucket of byEnvironment) {
      if (bucket.failed < 2) continue;
      const failed = samples.filter(
        (sample) =>
          sample.environmentId === bucket.environmentId && sampleOutcome(sample) === "failed",
      );
      signals.push({
        kind: "environment-recurrence",
        severity: "warning",
        summary: `${bucket.failed} product failures recurred in this environment.`,
        environmentId: bucket.environmentId,
        runIds: signalRunIds(failed),
      });
    }
    const duration = durationSignal(samples);
    if (duration) signals.push(duration);
  }

  const owners = [
    ...new Set(samples.flatMap((sample) => (sample.assignee ? [sample.assignee] : []))),
  ]
    .sort()
    .map((assignee) => {
      const members = samples.filter((sample) => sample.assignee === assignee);
      return {
        assignee,
        caseCount: members.length,
        problemCount: members.filter(
          (sample) =>
            sample.status === "failed" ||
            sample.status === "blocked" ||
            sample.status === "cancelled" ||
            sampleOutcome(sample) === "failed",
        ).length,
      };
    });
  if (owners.some((owner) => owner.problemCount > 0)) {
    const assignedProblems = owners.reduce((total, owner) => total + owner.problemCount, 0);
    signals.push({
      kind: "open-ownership",
      severity: "info",
      summary:
        assignedProblems === 1
          ? "1 assigned case has a review owner."
          : `${assignedProblems} assigned cases have a review owner.`,
      runIds: signalRunIds(samples.filter((sample) => sample.assignee)),
    });
  }

  return {
    scope,
    sampleCount: samples.length,
    completedCount: passedCount + failedCount,
    passedCount,
    failedCount,
    unknownCount,
    passRate,
    medianDurationMs,
    trend: stabilityTrend(samples, passRate, confidenceValue),
    confidence: confidenceValue,
    historyComplete: input.historyComplete,
    runIds: signalRunIds(samples),
    byEnvironment,
    byApp,
    byCluster,
    owners,
    signals,
    recommendations: stabilityMaintenanceRecommendations(signals),
  };
}

/** Test ids labelled flaky from a comparable Stability cohort. Mixed-outcomes is not flaky. */
export function flakyTestIdsFromStability(summary: ProductStabilitySummary): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const signal of summary.signals) {
    if (signal.kind !== "possible-flakiness") continue;
    const testId = signal.testId?.trim();
    if (testId) ids.add(testId);
  }
  return ids;
}

export function createStabilityProductService(platform: Platform): StabilityProductService {
  let catalogPromise: Promise<import("@relay/product/catalog").ProductCatalog> | undefined;
  function catalog() {
    catalogPromise ??= Promise.all([
      productClientForPlatform(platform),
      import("@relay/product/catalog"),
    ]).then(([{ client }, { createProductCatalog }]) => createProductCatalog(client));
    return catalogPromise;
  }
  const listRuns = (filter?: ProductRunFilter) =>
    catalog().then((service) =>
      service.listRunsComplete ? service.listRunsComplete(filter) : service.listRuns(filter),
    );
  return {
    listRuns,
    summarize: summarizeProductStability,
    async summarizeRuns(input) {
      const runs = await listRuns(input.filter);
      return summarizeProductStability({
        samples: stabilitySamplesFromRuns(runs),
        historyComplete: input.historyComplete,
        scope: input.scope,
      });
    },
    summarizeBatch(report, scope) {
      const historyComplete =
        report.status === "completed" ||
        report.status === "completed-with-problems" ||
        report.status === "needs-review" ||
        report.status === "cancelled"
          ? report.cases.every((item) => terminalBatchStatus(item.status))
          : false;
      return summarizeProductStability({
        samples: stabilitySamplesFromBatch(report),
        historyComplete,
        scope,
      });
    },
  };
}
