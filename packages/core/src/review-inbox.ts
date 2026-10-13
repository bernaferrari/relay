/**
 * One place to review screenshots: the latest run of every Test on every
 * device (and data set), keeping only captures a person still has to look at.
 * Older runs superseded by a newer run of the same Test, device and data are
 * left out; their screenshots no longer describe the app.
 */
import type {
  CaptureReviewItem,
  CaptureReviewSummary,
  ReviewInboxEntry,
  ReviewInboxResult,
  RunSummary,
} from "@relay/protocol";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { captureReviewQueueForRun } from "./capture-review-queue.js";
import { catalogRecords, type CatalogRecord } from "./run-catalog.js";
import { readPersistedRun, type PersistedRun } from "./runs.js";

const DAY_MS = 86_400_000;
const CACHE_LIMIT = 500;

type CachedRun = {
  stamp: string;
  run: Pick<PersistedRun, "projectId" | "ownerId">;
  entry?: Omit<ReviewInboxEntry, "finishedAt">;
};

/**
 * Run manifests can be megabytes of evidence; parsing them on every request
 * made the inbox take seconds. A run's screenshots to review only change when
 * its manifest is rewritten, so keep the small result keyed by that file.
 */
const reviewCache = new Map<string, CachedRun>();

async function manifestStamp(dir: string): Promise<string | undefined> {
  try {
    const info = await stat(join(dir, "run.json"));
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return undefined;
  }
}

async function reviewForRun(summary: CatalogRecord): Promise<CachedRun | undefined> {
  const stamp = await manifestStamp(summary.dir);
  if (!stamp) return undefined;
  const cached = reviewCache.get(summary.id);
  if (cached?.stamp === stamp) return cached;
  const run = await readPersistedRun(summary.id);
  if (!run) return undefined;
  const items = captureReviewQueueForRun(run).items.filter(needsPerson);
  const source = summary.sourceTest ?? summary.matrixCase;
  const next: CachedRun = {
    stamp,
    run: {
      ...(run.projectId ? { projectId: run.projectId } : {}),
      ...(run.ownerId ? { ownerId: run.ownerId } : {}),
    } as CachedRun["run"],
    ...(items.length
      ? {
          entry: {
            runId: run.id,
            title: run.title ?? summary.title ?? run.action,
            ...(source?.appMapId ? { appMapId: source.appMapId } : {}),
            ...(source?.testId ? { testId: source.testId } : {}),
            ...(run.targetProfile?.name || run.deviceName
              ? { targetName: run.targetProfile?.name ?? run.deviceName }
              : {}),
            ...(run.platform ? { platform: run.platform } : {}),
            ...(summary.matrixCase?.values && Object.keys(summary.matrixCase.values).length
              ? { data: summary.matrixCase.values }
              : {}),
            ...(run.outcome ? { outcome: run.outcome } : {}),
            items,
          },
        }
      : {}),
  };
  reviewCache.delete(summary.id);
  reviewCache.set(summary.id, next);
  if (reviewCache.size > CACHE_LIMIT) {
    const oldest = reviewCache.keys().next().value;
    if (oldest !== undefined) reviewCache.delete(oldest);
  }
  return next;
}

function testKey(summary: RunSummary): string {
  const source = summary.sourceTest ?? summary.matrixCase;
  if (source?.appMapId && source.testId) return `${source.appMapId}/${source.testId}`;
  return summary.action.replace(/:r\d+$/u, "");
}

function groupKey(summary: RunSummary): string {
  const values = summary.matrixCase?.values ?? {};
  const data = Object.keys(values)
    .sort()
    .map((key) => `${key}=${values[key]}`)
    .join("&");
  return [
    testKey(summary),
    summary.targetProfileId ?? summary.serial ?? summary.platform ?? "",
    data,
  ].join("|");
}

function needsPerson(item: CaptureReviewItem): boolean {
  return item.status === "pending";
}

function runTime(summary: RunSummary): number {
  return summary.finishedAt ?? summary.writtenAt ?? summary.queuedAt;
}

export async function listReviewInbox(
  root: string,
  options: {
    sinceDays?: number;
    now?: number;
    visible?: (run: Pick<PersistedRun, "projectId" | "ownerId">) => boolean;
    appMapId?: string;
    /**
     * Only the totals, from the run catalog: no manifest is opened. Use for
     * badges; callers that must hide other people's runs need the full list.
     */
    countOnly?: boolean;
  } = {},
): Promise<ReviewInboxResult> {
  const now = options.now ?? Date.now();
  const since = now - (options.sinceDays ?? 14) * DAY_MS;
  const summaries = (await catalogRecords(root, 2_000)).filter(
    (summary) =>
      runTime(summary) >= since &&
      (!options.appMapId ||
        (summary.sourceTest ?? summary.matrixCase)?.appMapId === options.appMapId),
  );
  const latest = new Map<string, CatalogRecord>();
  for (const summary of summaries) {
    const key = groupKey(summary);
    const current = latest.get(key);
    if (!current || runTime(summary) > runTime(current)) latest.set(key, summary);
  }
  const totals: CaptureReviewSummary = {
    captured: 0,
    missing: 0,
    pending: 0,
    accepted: 0,
    issue: 0,
    needMoreEvidence: 0,
    unchanged: 0,
    changed: 0,
    new: 0,
  };
  const entries: ReviewInboxEntry[] = [];
  const candidates = [...latest.values()].sort((left, right) => runTime(right) - runTime(left));
  for (const summary of candidates) {
    const captured = summary.captureSummary;
    if (!captured || captured.captured === 0) continue;
    for (const key of Object.keys(totals) as (keyof CaptureReviewSummary)[]) {
      totals[key] = (totals[key] ?? 0) + (captured[key] ?? 0);
    }
    if (!captured.pending || options.countOnly) continue;
    const review = await reviewForRun(summary);
    if (!review?.entry || (options.visible && !options.visible(review.run))) continue;
    entries.push({ ...review.entry, finishedAt: runTime(summary) });
  }
  // Changed screenshots first: they are the likely regressions.
  const weight = (entry: ReviewInboxEntry) =>
    entry.items.some((item) => item.reference?.state === "changed") ? 0 : 1;
  entries.sort((left, right) => weight(left) - weight(right) || right.finishedAt - left.finishedAt);
  return { entries, totals, runsConsidered: latest.size };
}
