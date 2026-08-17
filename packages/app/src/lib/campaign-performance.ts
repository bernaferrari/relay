import type { JobInfo } from "./api-types";
import { campaignCheckResults, type CampaignCheckResult } from "./campaign-check-results";

export type CampaignPerformanceRecommendation = {
  id: string;
  title: string;
  detail: string;
  checkId?: string;
  evidenceKind?: string;
};

export type CampaignPerformanceReport = {
  totalDurationMs?: number;
  coverageDurationMs: number;
  checkCount: number;
  slowest: Array<{ id: string; title: string; durationMs: number }>;
  cacheHits: number;
  cacheMisses: number;
  cacheBypassed: number;
  viewportCount: number;
  restoreFailures: number;
  relaunchSignals: number;
  recommendations: CampaignPerformanceRecommendation[];
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function cacheStatus(value: unknown): "hit" | "miss" | "bypassed" | undefined {
  return value === "hit" || value === "miss" || value === "bypassed" ? value : undefined;
}

function surfaceStats(job: JobInfo): {
  cacheHits: number;
  cacheMisses: number;
  cacheBypassed: number;
  viewportCount: number;
  restoreFailures: number;
} {
  let cacheHits = 0;
  let cacheMisses = 0;
  let cacheBypassed = 0;
  let viewportCount = 0;
  let restoreFailures = 0;
  for (const artifact of job.artifacts ?? []) {
    const data = object(artifact.data);
    if (artifact.kind === "logical-scroll-surface-result" && data) {
      const status = cacheStatus(object(data.cache)?.status);
      if (status === "hit") cacheHits += 1;
      else if (status === "miss") cacheMisses += 1;
      else if (status === "bypassed") cacheBypassed += 1;
      const capture = object(data.capture);
      viewportCount += Array.isArray(capture?.viewports) ? capture.viewports.length : 0;
      if (capture?.restoredStartViewport === false) restoreFailures += 1;
    }
    if (
      artifact.kind === "campaign-recovery-intervention" &&
      object(artifact.data)?.reason === "viewport-restore-failed"
    ) {
      restoreFailures += 1;
    }
  }
  return { cacheHits, cacheMisses, cacheBypassed, viewportCount, restoreFailures };
}

function relaunchSignals(job: JobInfo): number {
  const logHits = (job.logs ?? []).filter((line) =>
    /cold launch|implicit-relaunch|app\.open relaunch/iu.test(line),
  ).length;
  const artifactHits = (job.artifacts ?? []).filter((artifact) => {
    const data = object(artifact.data);
    return (
      artifact.kind === "campaign-recovery-intervention" &&
      String(data?.reason ?? "").includes("cold")
    );
  }).length;
  return logHits + artifactHits;
}

function recommendations(
  checks: CampaignCheckResult[],
  stats: ReturnType<typeof surfaceStats>,
  relaunches: number,
  slowest: CampaignPerformanceReport["slowest"],
): CampaignPerformanceRecommendation[] {
  const items: CampaignPerformanceRecommendation[] = [];
  if (stats.cacheHits > 0) {
    items.push({
      id: "cache-hits",
      title: "Cached full-surface evidence",
      detail: `${stats.cacheHits} ${stats.cacheHits === 1 ? "surface reused" : "surfaces reused"} exact prior evidence. Use Capture fresh evidence only for benchmark runs.`,
      evidenceKind: "logical-scroll-surface-result",
    });
  }
  if (stats.cacheBypassed > 0) {
    items.push({
      id: "cache-bypassed",
      title: "Fresh full-surface capture",
      detail: `${stats.cacheBypassed} ${stats.cacheBypassed === 1 ? "surface bypassed" : "surfaces bypassed"} the comparison cache on this run.`,
      evidenceKind: "logical-scroll-surface-result",
    });
  }
  if (relaunches > 0) {
    items.push({
      id: "relaunches",
      title: "Cold recovery attempted",
      detail:
        "A relaunch or cold recovery signal appeared. Repair from the verified parent instead of reopening the app.",
    });
  }
  if (stats.restoreFailures > 0) {
    items.push({
      id: "restore",
      title: "Viewport restore was not proven",
      detail:
        "A full-surface capture finished without proving the starting viewport. Review the restore intervention before the next transition.",
      evidenceKind: "campaign-recovery-intervention",
    });
  }
  const blocked = checks.filter((check) => check.status === "blocked");
  if (blocked.length > 0) {
    items.push({
      id: "blocked",
      title: "Blocked checks skipped shared setup",
      detail: `${blocked.length} ${blocked.length === 1 ? "check waited" : "checks waited"} on an earlier failure instead of replaying the shared path.`,
      checkId: blocked[0]?.id,
    });
  }
  if (slowest[0] && (slowest[0].durationMs ?? 0) >= 8_000) {
    items.push({
      id: "slowest",
      title: `Slowest check: ${slowest[0].title}`,
      detail: "Start optimization from this check’s evidence rather than from generic logs.",
      checkId: slowest[0].id,
    });
  }
  return items;
}

export function campaignPerformanceFromJob(job: JobInfo): CampaignPerformanceReport {
  const checks = campaignCheckResults(job);
  const coverageDurationMs = checks.reduce((sum, check) => sum + (check.durationMs ?? 0), 0);
  const totalDurationMs =
    typeof job.startedAt === "number" && typeof job.finishedAt === "number"
      ? Math.max(0, job.finishedAt - job.startedAt)
      : undefined;
  const slowest = [...checks]
    .filter(
      (check): check is CampaignCheckResult & { durationMs: number } =>
        typeof check.durationMs === "number",
    )
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 3)
    .map((check) => ({ id: check.id, title: check.title, durationMs: check.durationMs }));
  const stats = surfaceStats(job);
  const relaunches = relaunchSignals(job);
  return {
    ...(totalDurationMs !== undefined ? { totalDurationMs } : {}),
    coverageDurationMs,
    checkCount: checks.length,
    slowest,
    ...stats,
    relaunchSignals: relaunches,
    recommendations: recommendations(checks, stats, relaunches, slowest),
  };
}
