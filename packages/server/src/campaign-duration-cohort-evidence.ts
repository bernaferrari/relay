import {
  campaignCohortDurationEvidenceForPreflight,
  DEFAULT_CAMPAIGN_DURATION_MAX_SAMPLES,
  DEFAULT_CAMPAIGN_DURATION_MIN_SAMPLES,
  estimateCampaignDurationForCohort,
  listPersistedRuns,
  MIN_CAMPAIGN_DURATION_MIN_SAMPLES,
  type CampaignDurationEstimate,
  type CampaignDurationRunRecord,
} from "@relay/core";
import {
  MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
  type CampaignCapacityCohortDurationEstimate,
  type CampaignCapacityCohortDurationEstimateRequest,
  type CampaignCapacityCohortDurationEstimateResponse,
  type CampaignCapacityCohortDurationEvidence,
  type CampaignCapacityDurationCohort,
} from "@relay/protocol";
import { HttpError } from "./http.js";
import type { RequestContext } from "./security.js";

export const MAX_CAMPAIGN_DURATION_ESTIMATE_COHORTS = 100;
export const MAX_CAMPAIGN_DURATION_PERSISTED_RUN_SCAN = 1_000;

type NormalizedEstimateRequest = {
  cohorts: CampaignCapacityDurationCohort[];
  maxAgeMs: number;
  minSamples: number;
  maxSamples: number;
  percentile: "p50" | "p95";
  durationSource: "run-wall-clock" | "evidence-completion";
};

export type CampaignDurationCohortEvidenceRuntime = {
  listPersistedRuns: typeof listPersistedRuns;
  now: () => number;
};

const defaultRuntime: CampaignDurationCohortEvidenceRuntime = {
  listPersistedRuns,
  now: () => Date.now(),
};

function invalid(message: string, body: Record<string, unknown> = {}): HttpError {
  return new HttpError(400, message, {
    code: "CAMPAIGN_DURATION_COHORTS_INVALID",
    ...body,
  });
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw invalid(`${label} is required`);
  return value.trim();
}

function safeNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalid(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw invalid(`${label} must be a positive safe integer`);
  }
  return value;
}

export function campaignDurationCohortKey(cohort: CampaignCapacityDurationCohort): string {
  return JSON.stringify([cohort.targetId, cohort.platform, cohort.testId, cohort.action]);
}

export function normalizeCampaignDurationCohort(
  raw: CampaignCapacityDurationCohort,
): CampaignCapacityDurationCohort {
  const targetId = requiredString(raw?.targetId, "Campaign duration cohort targetId");
  if (raw?.platform !== "android" && raw?.platform !== "ios") {
    throw invalid("Campaign duration cohort platform must be android or ios");
  }
  return {
    targetId,
    platform: raw.platform,
    testId: requiredString(raw.testId, "Campaign duration cohort testId"),
    action: requiredString(raw.action, "Campaign duration cohort action"),
  };
}

function normalizeEstimateRequest(
  raw: CampaignCapacityCohortDurationEstimateRequest,
): NormalizedEstimateRequest {
  if (!Array.isArray(raw?.cohorts) || !raw.cohorts.length) {
    throw invalid("Campaign duration estimates require at least one cohort");
  }
  if (raw.cohorts.length > MAX_CAMPAIGN_DURATION_ESTIMATE_COHORTS) {
    throw invalid(
      `Campaign duration estimates allow at most ${MAX_CAMPAIGN_DURATION_ESTIMATE_COHORTS} cohorts per request`,
    );
  }
  const cohorts = raw.cohorts.map(normalizeCampaignDurationCohort);
  const seen = new Set<string>();
  for (const cohort of cohorts) {
    const key = campaignDurationCohortKey(cohort);
    if (seen.has(key)) {
      throw invalid("Campaign duration estimate cohorts must be unique", { cohort });
    }
    seen.add(key);
  }
  const maxAgeMs = safeNonNegativeInteger(raw.maxAgeMs, "Campaign duration maxAgeMs");
  if (maxAgeMs > MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS) {
    throw invalid(
      `Campaign duration maxAgeMs must not exceed ${MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS}`,
      { maxAgeMs, maxAllowedMs: MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS },
    );
  }
  const minSamples =
    raw.minSamples === undefined
      ? DEFAULT_CAMPAIGN_DURATION_MIN_SAMPLES
      : positiveSafeInteger(raw.minSamples, "Campaign duration minSamples");
  if (minSamples < MIN_CAMPAIGN_DURATION_MIN_SAMPLES) {
    throw invalid(
      `Campaign duration minSamples must be at least ${MIN_CAMPAIGN_DURATION_MIN_SAMPLES}`,
    );
  }
  const maxSamples =
    raw.maxSamples === undefined
      ? DEFAULT_CAMPAIGN_DURATION_MAX_SAMPLES
      : positiveSafeInteger(raw.maxSamples, "Campaign duration maxSamples");
  if (maxSamples < minSamples || maxSamples > DEFAULT_CAMPAIGN_DURATION_MAX_SAMPLES) {
    throw invalid(
      `Campaign duration maxSamples must be between minSamples and ${DEFAULT_CAMPAIGN_DURATION_MAX_SAMPLES}`,
    );
  }
  const percentile = raw.percentile ?? "p95";
  if (percentile !== "p50" && percentile !== "p95") {
    throw invalid("Campaign duration percentile must be p50 or p95");
  }
  const durationSource = raw.durationSource ?? "run-wall-clock";
  if (durationSource !== "run-wall-clock" && durationSource !== "evidence-completion") {
    throw invalid("Campaign duration source must be run-wall-clock or evidence-completion");
  }
  return { cohorts, maxAgeMs, minSamples, maxSamples, percentile, durationSource };
}

async function persistedProjectRuns(
  scope: RequestContext,
  runtime: Pick<CampaignDurationCohortEvidenceRuntime, "listPersistedRuns">,
): Promise<CampaignDurationRunRecord[]> {
  let records: Awaited<ReturnType<typeof listPersistedRuns>>;
  try {
    records = await runtime.listPersistedRuns(MAX_CAMPAIGN_DURATION_PERSISTED_RUN_SCAN);
  } catch (error) {
    throw new HttpError(503, "Relay cannot read persisted runs for duration evidence", {
      code: "CAMPAIGN_DURATION_COHORTS_UNAVAILABLE",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  // A local host may store multiple projects. Do not borrow their measurements
  // merely because the same serial or App Map id happens to appear elsewhere.
  return records.filter(
    (run) =>
      run.projectId === scope.projectId && (scope.localTrusted || run.ownerId === scope.subject),
  );
}

function publicEstimate(input: {
  cohort: CampaignCapacityDurationCohort;
  estimate: CampaignDurationEstimate;
  percentile: "p50" | "p95";
}): CampaignCapacityCohortDurationEstimate {
  const { estimate } = input;
  const evidence = campaignCohortDurationEvidenceForPreflight(estimate, input.percentile);
  return {
    schemaVersion: 1,
    cohort: structuredClone(input.cohort),
    checkedAt: estimate.checkedAt,
    status: estimate.status,
    minSamples: estimate.minSamples,
    maxAgeMs: estimate.maxAgeMs,
    sampleCount: estimate.sampleCount,
    ...(estimate.observedAt === undefined ? {} : { observedAt: estimate.observedAt }),
    ...(estimate.observationWindow ? { observationWindow: { ...estimate.observationWindow } } : {}),
    ...(estimate.candidates ? { candidates: structuredClone(estimate.candidates) } : {}),
    filtering: {
      recordSource: estimate.filtering.recordSource,
      durationSource: estimate.filtering.durationSource,
      totalRecords: estimate.filtering.totalRecords,
      acceptedBeforeSampleCap: estimate.filtering.acceptedBeforeSampleCap,
      excludedByReason: { ...estimate.filtering.excludedByReason },
      sampleCap: estimate.filtering.sampleCap,
      omittedBySampleCap: estimate.filtering.omittedBySampleCap,
    },
    ...(evidence ? { evidence } : {}),
  };
}

function estimateFromRecords(input: {
  request: NormalizedEstimateRequest;
  records: readonly CampaignDurationRunRecord[];
  checkedAt: number;
}): CampaignCapacityCohortDurationEstimate[] {
  return input.request.cohorts.map((cohort) => {
    const estimate = estimateCampaignDurationForCohort({
      cohort,
      runs: input.records,
      source: "persisted-runs",
      at: input.checkedAt,
      maxAgeMs: input.request.maxAgeMs,
      minSamples: input.request.minSamples,
      maxSamples: input.request.maxSamples,
      durationSource: input.request.durationSource,
    });
    return publicEstimate({ cohort, estimate, percentile: input.request.percentile });
  });
}

/** Read immutable, project-scoped run evidence for a selected target/Test
 * cohort. This is deliberately safe to call before admission and returns no
 * fallback platform aggregate when a concrete cohort has no evidence. */
export async function estimateCampaignDurationCohorts(input: {
  scope: RequestContext;
  request: CampaignCapacityCohortDurationEstimateRequest;
  runtime?: Partial<CampaignDurationCohortEvidenceRuntime>;
}): Promise<CampaignCapacityCohortDurationEstimateResponse> {
  const runtime = { ...defaultRuntime, ...input.runtime };
  const request = normalizeEstimateRequest(input.request);
  const checkedAt = safeNonNegativeInteger(runtime.now(), "Campaign duration check time");
  const records = await persistedProjectRuns(input.scope, runtime);
  return {
    checkedAt,
    estimates: estimateFromRecords({ request, records, checkedAt }),
  };
}

function sameEvidence(
  actual: CampaignCapacityCohortDurationEvidence,
  expected: CampaignCapacityCohortDurationEvidence,
): boolean {
  return (
    actual.schemaVersion === expected.schemaVersion &&
    campaignDurationCohortKey(actual.cohort) === campaignDurationCohortKey(expected.cohort) &&
    actual.duration.workItemDurationMs === expected.duration.workItemDurationMs &&
    actual.duration.provenance === expected.duration.provenance &&
    actual.duration.observedAt === expected.duration.observedAt &&
    actual.duration.sampleCount === expected.duration.sampleCount &&
    actual.duration.maxAgeMs === expected.duration.maxAgeMs &&
    actual.measurement.estimator === expected.measurement.estimator &&
    actual.measurement.recordSource === expected.measurement.recordSource &&
    actual.measurement.durationSource === expected.measurement.durationSource &&
    actual.measurement.observationWindow.startedAt ===
      expected.measurement.observationWindow.startedAt &&
    actual.measurement.observationWindow.finishedAt ===
      expected.measurement.observationWindow.finishedAt &&
    actual.measurement.sampleIds.length === expected.measurement.sampleIds.length &&
    actual.measurement.sampleIds.every(
      (sampleId, index) => sampleId === expected.measurement.sampleIds[index],
    )
  );
}

/** Re-derive a caller-supplied admission proof from current immutable project
 * records. The submitted record remains useful as a serialized audit trail,
 * but cannot fabricate sample ids, use another project, or silently change a
 * percentile after the evidence-estimation read. */
export async function verifyCampaignDurationCohortEvidence(input: {
  scope: RequestContext;
  evidence: readonly CampaignCapacityCohortDurationEvidence[];
  at: number;
  runtime?: Partial<CampaignDurationCohortEvidenceRuntime>;
}): Promise<Map<string, CampaignCapacityCohortDurationEvidence>> {
  const runtime = { ...defaultRuntime, ...input.runtime };
  const checkedAt = safeNonNegativeInteger(input.at, "Campaign duration admission time");
  const records = await persistedProjectRuns(input.scope, runtime);
  const verified = new Map<string, CampaignCapacityCohortDurationEvidence>();
  for (const submitted of input.evidence) {
    const cohort = normalizeCampaignDurationCohort(submitted.cohort);
    const key = campaignDurationCohortKey(cohort);
    if (verified.has(key)) {
      throw new HttpError(409, "Campaign duration evidence contains a duplicate cohort", {
        code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_UNVERIFIED",
        cohort,
      });
    }
    const duration = submitted.duration;
    const measurement = submitted.measurement;
    if (
      !duration ||
      !measurement ||
      measurement.recordSource !== "persisted-runs" ||
      (duration.provenance !== "observed-p50" && duration.provenance !== "observed-p95")
    ) {
      throw new HttpError(
        409,
        "Local campaign duration evidence must come from persisted target/Test cohort runs.",
        {
          code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_UNVERIFIED",
          cohort,
          recovery:
            "Refresh the cohort estimate from Relay. Summary-only, mixed, or caller-authored evidence cannot promise a local deadline.",
        },
      );
    }
    const request = normalizeEstimateRequest({
      cohorts: [cohort],
      maxAgeMs: duration.maxAgeMs,
      minSamples: duration.sampleCount,
      maxSamples: duration.sampleCount,
      percentile: duration.provenance === "observed-p50" ? "p50" : "p95",
      durationSource: measurement.durationSource,
    });
    const estimate = estimateFromRecords({ request, records, checkedAt })[0];
    const expected = estimate?.evidence;
    if (!expected || !sameEvidence(submitted, expected)) {
      throw new HttpError(
        409,
        "Local campaign duration evidence no longer matches immutable target/Test cohort records.",
        {
          code: "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_UNVERIFIED",
          cohort,
          recovery:
            "Refresh the exact target/Test/action estimate. Relay will not accept handwritten sample ids, changed durations, or a cohort displaced by newer runs.",
        },
      );
    }
    verified.set(key, structuredClone(expected));
  }
  return verified;
}
