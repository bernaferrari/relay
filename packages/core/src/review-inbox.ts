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
import { captureReviewQueueForRun } from "./capture-review-queue.js";
import { catalogSummaries } from "./run-catalog.js";
import { readPersistedRun, type PersistedRun } from "./runs.js";

const DAY_MS = 86_400_000;

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
    visible?: (run: PersistedRun) => boolean;
    appMapId?: string;
  } = {},
): Promise<ReviewInboxResult> {
  const now = options.now ?? Date.now();
  const since = now - (options.sinceDays ?? 14) * DAY_MS;
  const summaries = (await catalogSummaries(root, 2_000)).filter(
    (summary) =>
      runTime(summary) >= since &&
      (!options.appMapId ||
        (summary.sourceTest ?? summary.matrixCase)?.appMapId === options.appMapId),
  );
  const latest = new Map<string, RunSummary>();
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
    if (!captured.pending) continue;
    const run = await readPersistedRun(summary.id);
    if (!run || (options.visible && !options.visible(run))) continue;
    const items = captureReviewQueueForRun(run).items.filter(needsPerson);
    if (!items.length) continue;
    const source = summary.sourceTest ?? summary.matrixCase;
    entries.push({
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
      finishedAt: runTime(summary),
      ...(run.outcome ? { outcome: run.outcome } : {}),
      items,
    });
  }
  // Changed screenshots first: they are the likely regressions.
  const weight = (entry: ReviewInboxEntry) =>
    entry.items.some((item) => item.reference?.state === "changed") ? 0 : 1;
  entries.sort((left, right) => weight(left) - weight(right) || right.finishedAt - left.finishedAt);
  return { entries, totals, runsConsidered: latest.size };
}
