import type {
  CampaignCapacityDurationInput,
  EvidenceManifest,
  RunReview,
  RunSummary,
} from "@relay/protocol";
import { extractEvidenceMetrics } from "./evidence-metrics.js";

/**
 * Twenty completed executions is a deliberately conservative default for a
 * p95. Callers can require more, but cannot lower this guard below five.
 */
export const DEFAULT_CAMPAIGN_DURATION_MIN_SAMPLES = 20;
export const MIN_CAMPAIGN_DURATION_MIN_SAMPLES = 5;
export const DEFAULT_CAMPAIGN_DURATION_MAX_SAMPLES = 200;

export type CampaignDurationPlatform = "android" | "ios";

/**
 * The estimator only needs this narrow persisted-run projection. `PersistedRun`
 * and `RunSummary` are both structurally compatible, so the estimator does not
 * own storage, perform I/O, or depend on a provider/driver implementation.
 */
export type CampaignDurationRunRecord = Pick<
  RunSummary,
  | "id"
  | "action"
  | "status"
  | "queuedAt"
  | "startedAt"
  | "finishedAt"
  | "durationMs"
  | "platform"
  | "outcome"
  | "review"
  | "writtenAt"
> & {
  evidence?: EvidenceManifest;
};

export type CampaignDurationRecordSource =
  | "persisted-runs"
  | "run-summaries"
  | "mixed-read-only-records";

/** A specific duration clock; campaign preflight normally wants wall-clock work. */
export type CampaignDurationSource = "run-wall-clock" | "evidence-completion";

export type CampaignDurationEstimateInput = {
  /** The only platform whose records may contribute to the percentile cohort. */
  platform: CampaignDurationPlatform;
  /** A stable independently-executable work-item identity, usually a recipe/action id. */
  action: string;
  /** Read-only records already selected by the caller. This function never reads or writes storage. */
  runs: readonly CampaignDurationRunRecord[];
  /** Makes audit output honest about whether records came from manifests, summaries, or both. */
  source: CampaignDurationRecordSource;
  /** The time at which freshness is evaluated. Defaults to the local clock for ordinary callers. */
  at?: number;
  /** Explicitly bounded freshness window passed through to the preflight candidate. */
  maxAgeMs: number;
  /** Defaults to 20 and may not be lowered below five. */
  minSamples?: number;
  /** Bounds computation and makes the cohort favor the most recent observations. */
  maxSamples?: number;
  /** Uses evidence's completion-duration metric only when its input evidence is sufficient. */
  durationSource?: CampaignDurationSource;
};

export type CampaignDurationExclusionReason =
  | "duplicate-run"
  | "missing-platform"
  | "platform-mismatch"
  | "action-mismatch"
  | "non-terminal"
  | "uncertain"
  | "non-successful-terminal"
  | "invalid-run-timestamps"
  | "inconsistent-run-duration"
  | "evidence-duration-unavailable";

export type CampaignDurationFilteringProvenance = {
  recordSource: CampaignDurationRecordSource;
  durationSource: CampaignDurationSource;
  requestedPlatform: CampaignDurationPlatform;
  requestedAction: string;
  totalRecords: number;
  acceptedBeforeSampleCap: number;
  excludedByReason: Partial<Record<CampaignDurationExclusionReason, number>>;
  /** The estimator considers newest completed runs first, then bounds the cohort. */
  sampleCap: number;
  omittedBySampleCap: number;
  terminalStatuses: readonly ["ok", "healed"];
  quantileMethod: "linear-interpolation-rounded-up";
};

export type ObservedCampaignDurationInput = CampaignCapacityDurationInput & {
  provenance: "observed-p50" | "observed-p95";
  observedAt: number;
  sampleCount: number;
  maxAgeMs: number;
};

export type CampaignDurationEstimate = {
  schemaVersion: 1;
  platform: CampaignDurationPlatform;
  action: string;
  checkedAt: number;
  /** `stale` remains inspectable but is not a current measurement or SLA. */
  status: "current" | "stale" | "insufficient-samples";
  minSamples: number;
  maxAgeMs: number;
  sampleCount: number;
  observedAt?: number;
  observationWindow?: { startedAt: number; finishedAt: number };
  filtering: CampaignDurationFilteringProvenance;
  /** Present only when there are enough homogeneous, successful terminal samples. */
  candidates?: {
    p50: ObservedCampaignDurationInput;
    p95: ObservedCampaignDurationInput;
  };
};

type AcceptedSample = { durationMs: number; observedAt: number; id: string };

const TERMINAL_SUCCESS_STATUSES = ["ok", "healed"] as const;

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireSafeNonNegativeInteger(value: unknown, label: string): number {
  if (!isSafeNonNegativeInteger(value)) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function uncertain(review: RunReview | undefined, outcome: unknown): boolean {
  return review?.status === "pending" || review?.status === "rejected" || outcome === "uncertain";
}

function terminalSuccess(status: string): boolean {
  return status === "ok" || status === "healed";
}

function wallClockDuration(
  run: CampaignDurationRunRecord,
): number | CampaignDurationExclusionReason {
  if (!isSafeNonNegativeInteger(run.startedAt) || !isSafeNonNegativeInteger(run.finishedAt)) {
    return "invalid-run-timestamps";
  }
  if (run.finishedAt < run.startedAt) return "invalid-run-timestamps";
  const durationMs = run.finishedAt - run.startedAt;
  if (run.durationMs !== undefined) {
    if (!isSafeNonNegativeInteger(run.durationMs) || run.durationMs !== durationMs) {
      return "inconsistent-run-duration";
    }
  }
  return durationMs;
}

function evidenceCompletionDuration(
  run: CampaignDurationRunRecord,
): number | CampaignDurationExclusionReason {
  const manifest = run.evidence;
  if (
    !manifest ||
    !isSafeNonNegativeInteger(manifest.startedAt) ||
    !isSafeNonNegativeInteger(manifest.finishedAt) ||
    manifest.finishedAt < manifest.startedAt
  ) {
    return "evidence-duration-unavailable";
  }
  const metric = extractEvidenceMetrics(manifest).find(
    (candidate) => candidate.id === "completion.duration",
  );
  if (
    metric?.status !== "available" ||
    !isSafeNonNegativeInteger(metric.value) ||
    metric.value !== manifest.finishedAt - manifest.startedAt
  ) {
    return "evidence-duration-unavailable";
  }
  return metric.value;
}

function sampleFor(
  run: CampaignDurationRunRecord,
  input: Pick<CampaignDurationEstimateInput, "platform" | "action" | "durationSource">,
): AcceptedSample | CampaignDurationExclusionReason {
  if (!run.platform) return "missing-platform";
  if (run.platform !== input.platform) return "platform-mismatch";
  if (run.action !== input.action) return "action-mismatch";
  if (uncertain(run.review, run.outcome)) return "uncertain";
  if (!terminalSuccess(run.status)) {
    return ["queued", "running", "paused"].includes(run.status)
      ? "non-terminal"
      : "non-successful-terminal";
  }
  if (run.outcome !== undefined && run.outcome !== "passed") return "non-successful-terminal";
  const duration =
    input.durationSource === "evidence-completion"
      ? evidenceCompletionDuration(run)
      : wallClockDuration(run);
  if (typeof duration === "string") return duration;
  const observedAt =
    input.durationSource === "evidence-completion" ? run.evidence!.finishedAt! : run.finishedAt!;
  return { id: run.id, durationMs: duration, observedAt };
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) throw new Error("Cannot calculate a percentile with no samples");
  const index = (values.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = values[lower]!;
  const upperValue = values[upper]!;
  return Math.ceil(lowerValue + (upperValue - lowerValue) * (index - lower));
}

function candidate(
  workItemDurationMs: number,
  provenance: ObservedCampaignDurationInput["provenance"],
  observedAt: number,
  sampleCount: number,
  maxAgeMs: number,
): ObservedCampaignDurationInput {
  return { workItemDurationMs, provenance, observedAt, sampleCount, maxAgeMs };
}

/**
 * Derive duration inputs for an already-read, homogeneous platform/action
 * cohort. The result is diagnostic-only: no target is queried, leased,
 * reserved, or queued. Callers must still pass a selected candidate through
 * the read-only capacity preflight at their actual scheduling time.
 */
export function estimateCampaignDuration(
  rawInput: CampaignDurationEstimateInput,
): CampaignDurationEstimate {
  const action = rawInput.action.trim();
  if (!action) throw new Error("Campaign duration action must be a non-empty string");
  const maxAgeMs = requireSafeNonNegativeInteger(rawInput.maxAgeMs, "Campaign duration maxAgeMs");
  const minSamples = rawInput.minSamples ?? DEFAULT_CAMPAIGN_DURATION_MIN_SAMPLES;
  requirePositiveSafeInteger(minSamples, "Campaign duration minSamples");
  if (minSamples < MIN_CAMPAIGN_DURATION_MIN_SAMPLES) {
    throw new Error(
      `Campaign duration minSamples must be at least ${MIN_CAMPAIGN_DURATION_MIN_SAMPLES}`,
    );
  }
  const maxSamples = rawInput.maxSamples ?? DEFAULT_CAMPAIGN_DURATION_MAX_SAMPLES;
  requirePositiveSafeInteger(maxSamples, "Campaign duration maxSamples");
  if (maxSamples < minSamples) {
    throw new Error("Campaign duration maxSamples cannot be lower than minSamples");
  }
  const checkedAt = rawInput.at ?? Date.now();
  requireSafeNonNegativeInteger(checkedAt, "Campaign duration check time");
  const durationSource = rawInput.durationSource ?? "run-wall-clock";
  if (durationSource !== "run-wall-clock" && durationSource !== "evidence-completion") {
    throw new Error("Campaign duration source must be run-wall-clock or evidence-completion");
  }

  const excludedByReason: Partial<Record<CampaignDurationExclusionReason, number>> = {};
  const accepted: AcceptedSample[] = [];
  const acceptedRunIds = new Set<string>();
  for (const run of rawInput.runs) {
    const sample = sampleFor(run, { platform: rawInput.platform, action, durationSource });
    if (typeof sample === "string") {
      excludedByReason[sample] = (excludedByReason[sample] ?? 0) + 1;
    } else if (acceptedRunIds.has(sample.id)) {
      // A summary and its full manifest may be supplied together. It is one
      // execution, not two independent percentile observations.
      excludedByReason["duplicate-run"] = (excludedByReason["duplicate-run"] ?? 0) + 1;
    } else {
      acceptedRunIds.add(sample.id);
      accepted.push(sample);
    }
  }

  const newestFirst = [...accepted].sort(
    (left, right) => right.observedAt - left.observedAt || left.id.localeCompare(right.id),
  );
  const capped = newestFirst.slice(0, maxSamples);
  const sortedDurations = capped
    .map((sample) => sample.durationMs)
    .sort((left, right) => left - right);
  const observedAt = capped.reduce<number | undefined>(
    (latest, sample) =>
      latest === undefined || sample.observedAt > latest ? sample.observedAt : latest,
    undefined,
  );
  const earliestObservation = capped.reduce<number | undefined>(
    (earliest, sample) =>
      earliest === undefined || sample.observedAt < earliest ? sample.observedAt : earliest,
    undefined,
  );
  const filtering: CampaignDurationFilteringProvenance = {
    recordSource: rawInput.source,
    durationSource,
    requestedPlatform: rawInput.platform,
    requestedAction: action,
    totalRecords: rawInput.runs.length,
    acceptedBeforeSampleCap: accepted.length,
    excludedByReason,
    sampleCap: maxSamples,
    omittedBySampleCap: Math.max(0, accepted.length - capped.length),
    terminalStatuses: TERMINAL_SUCCESS_STATUSES,
    quantileMethod: "linear-interpolation-rounded-up",
  };
  const base = {
    schemaVersion: 1 as const,
    platform: rawInput.platform,
    action,
    checkedAt,
    minSamples,
    maxAgeMs,
    sampleCount: capped.length,
    filtering,
  };
  if (capped.length < minSamples || observedAt === undefined || earliestObservation === undefined) {
    return { ...base, status: "insufficient-samples" };
  }

  const p50 = percentile(sortedDurations, 0.5);
  const p95 = percentile(sortedDurations, 0.95);
  const fresh = observedAt <= checkedAt && checkedAt - observedAt <= maxAgeMs;
  return {
    ...base,
    status: fresh ? "current" : "stale",
    observedAt,
    observationWindow: { startedAt: earliestObservation, finishedAt: observedAt },
    candidates: {
      p50: candidate(p50, "observed-p50", observedAt, capped.length, maxAgeMs),
      p95: candidate(p95, "observed-p95", observedAt, capped.length, maxAgeMs),
    },
  };
}

/**
 * Copy one candidate into the existing preflight input shape. A stale estimate
 * is intentionally still returned: the capacity preflight checks freshness at
 * its own clock and will refuse to present it as achievable/current.
 */
export function campaignDurationInputForPreflight(
  estimate: CampaignDurationEstimate,
  percentile: "p50" | "p95",
): ObservedCampaignDurationInput | undefined {
  const selected = estimate.candidates?.[percentile];
  return selected ? { ...selected } : undefined;
}
