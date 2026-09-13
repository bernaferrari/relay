import type { AppMapCombineObservedDuration } from "@relay/protocol";
import { listStoredCombineCampaigns, type StoredCombineCampaign } from "./combine-campaign.js";
import { readPersistedRun } from "./runs.js";

const PACK_P95_MIN_SAMPLES = 3;

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) throw new Error("Cannot calculate a percentile with no samples");
  const index = (values.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = values[lower]!;
  const upperValue = values[upper]!;
  return Math.ceil(lowerValue + (upperValue - lowerValue) * (index - lower));
}

export function quoteObservedPackDuration(input: {
  workItemCount: number;
  samples: readonly { campaignId: string; durationMs: number }[];
}): AppMapCombineObservedDuration | undefined {
  if (!Number.isSafeInteger(input.workItemCount) || input.workItemCount <= 0) return undefined;
  const samples = input.samples
    .filter((sample) => Number.isSafeInteger(sample.durationMs) && sample.durationMs > 0)
    .sort((left, right) => left.durationMs - right.durationMs);
  if (!samples.length) return undefined;
  const durations = samples.map((sample) => sample.durationMs);
  const campaignIds = samples.map((sample) => sample.campaignId);
  if (samples.length < PACK_P95_MIN_SAMPLES) {
    return {
      durationMs: Math.max(...durations),
      provenance: "observed-sample",
      sampleCount: samples.length,
      workItemCount: input.workItemCount,
      campaignIds,
    };
  }
  return {
    durationMs: percentile(durations, 0.95),
    provenance: "observed-p95",
    sampleCount: samples.length,
    workItemCount: input.workItemCount,
    campaignIds,
  };
}

async function campaignPackWallClockMs(
  campaign: StoredCombineCampaign,
): Promise<number | undefined> {
  if (!campaign.cases.length) return undefined;
  const runs = await Promise.all(
    campaign.cases.map((item) => (item.jobId ? readPersistedRun(item.jobId) : Promise.resolve(null))),
  );
  if (runs.some((run) => !run || (run.status !== "ok" && !run.healed))) return undefined;
  const started = runs.map((run) => run!.startedAt ?? run!.queuedAt);
  const finished = runs.map((run) => run!.finishedAt);
  if (started.some((value) => !Number.isSafeInteger(value)) || finished.some((value) => !value)) {
    return undefined;
  }
  const durationMs = Math.max(...finished.map((value) => value!)) - Math.min(...started);
  return durationMs > 0 ? durationMs : undefined;
}

/** Serial wall-clock of completed Plan runs whose cell count matches this Combine. */
export async function quoteObservedCombinePackDuration(input: {
  projectId: string;
  appMapId: string;
  combineId: string;
  workItemCount: number;
}): Promise<AppMapCombineObservedDuration | undefined> {
  const campaigns = await listStoredCombineCampaigns(input.projectId);
  const samples: { campaignId: string; durationMs: number }[] = [];
  for (const campaign of campaigns) {
    if (campaign.appMapId !== input.appMapId || campaign.combineId !== input.combineId) continue;
    if (campaign.cases.length !== input.workItemCount) continue;
    const durationMs = await campaignPackWallClockMs(campaign);
    if (durationMs === undefined) continue;
    samples.push({ campaignId: campaign.id, durationMs });
  }
  return quoteObservedPackDuration({ workItemCount: input.workItemCount, samples });
}
