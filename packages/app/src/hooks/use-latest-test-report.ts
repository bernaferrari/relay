import { useQuery } from "@tanstack/react-query";
import type { RunProductService } from "../data/run-product-service";

export function useLatestTestReport(
  runService: RunProductService,
  testId: string,
  appMapId?: string,
) {
  const recentRuns = useQuery({
    queryKey: ["catalog", "runs", "test", testId, appMapId],
    queryFn: () => runService.listTestRuns!(testId, appMapId),
    enabled: typeof runService.listTestRuns === "function",
    staleTime: 10_000,
    refetchInterval: 3_000,
  });
  const latestRun = recentRuns.data?.slice().sort(latestRunFirst)[0];
  const latestReport = useQuery({
    queryKey: ["catalog", "run-report", latestRun?.id ?? "none"],
    queryFn: () => runService.getReport(latestRun!.id),
    enabled: Boolean(
      latestRun && (latestRun.phase === "completed" || latestRun.phase === "failed"),
    ),
    staleTime: 30_000,
    retry: false,
  });
  return {
    recentRuns,
    latestRun,
    latestReport,
    loading: recentRuns.isLoading || latestReport.isLoading,
  };
}

function latestRunFirst(
  left: { finishedAt?: number; startedAt?: number; queuedAt: number; id: string },
  right: { finishedAt?: number; startedAt?: number; queuedAt: number; id: string },
): number {
  const leftAt = left.finishedAt ?? left.startedAt ?? left.queuedAt;
  const rightAt = right.finishedAt ?? right.startedAt ?? right.queuedAt;
  return rightAt - leftAt || right.id.localeCompare(left.id);
}
