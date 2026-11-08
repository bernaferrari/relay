/** @jsxImportSource react */
import { useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import type { ProductRunSummary } from "@relay/product/catalog";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Eye,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { catalogQueryKeys } from "../data/catalog-queries";
import { ResultsBar } from "../components/results-bar";
import { relativeTime } from "#lib/relative-time";

type PlanTest = { id: string; name: string; status: string };

export type CheckState = "passed" | "review" | "failed" | "blocked" | "running" | "not-run";

export function checkState(run: ProductRunSummary | undefined): CheckState {
  if (!run) return "not-run";
  if (run.phase === "queued" || run.phase === "running") return "running";
  if (
    run.phase === "failed" ||
    run.outcome === "product-failure" ||
    (run.captureSummary?.issue ?? 0) > 0
  )
    return "failed";
  if (run.phase === "blocked" || run.outcome === "harness-failure") return "blocked";
  if (run.outcome === "uncertain" || (run.captureSummary?.pending ?? 0) > 0) return "review";
  if (run.phase === "needs-review") return "review";
  if (run.phase === "completed") return "passed";
  return "not-run";
}

/** Aggregate one execution cycle; never borrow a pass from an older cycle. */
export function latestCycleRuns(
  runs: readonly ProductRunSummary[],
  testIds: readonly string[],
  scope: { appMapId: string; combineId: string },
  occurrence?: { jobs: readonly { id: string }[] },
): Map<string, ProductRunSummary[]> {
  const wanted = new Set(testIds);
  const scoped = runs.filter(
    (run) =>
      run.appMapId === scope.appMapId &&
      run.combineId === scope.combineId &&
      Boolean(run.testId && wanted.has(run.testId)),
  );
  const newest = scoped.reduce<ProductRunSummary | undefined>(
    (latest, run) => (!latest || run.queuedAt > latest.queuedAt ? run : latest),
    undefined,
  );
  const jobIds = occurrence ? new Set(occurrence.jobs.map((job) => job.id)) : undefined;
  const cycle = scoped.filter((run) =>
    jobIds
      ? jobIds.has(run.id)
      : newest?.batchId
        ? run.batchId === newest.batchId
        : run.id === newest?.id,
  );
  const result = new Map<string, ProductRunSummary[]>();
  for (const run of cycle) {
    if (!run.testId || !wanted.has(run.testId)) continue;
    const group = result.get(run.testId) ?? [];
    group.push(run);
    result.set(run.testId, group);
  }
  return result;
}

export function aggregateCheckState(runs: readonly ProductRunSummary[]): CheckState {
  const states = runs.map(checkState);
  return (
    (["failed", "blocked", "running", "review", "not-run", "passed"] as const).find((state) =>
      states.includes(state),
    ) ?? "not-run"
  );
}

function representativeRun(runs: readonly ProductRunSummary[]): ProductRunSummary | undefined {
  const state = aggregateCheckState(runs);
  return runs.find((run) => checkState(run) === state);
}

const STATE_PRESENTATION: Record<
  CheckState,
  { label: string; icon: typeof CircleCheck; className: string }
> = {
  passed: { label: "Passed", icon: CircleCheck, className: "text-success-foreground" },
  review: { label: "To review", icon: Eye, className: "text-warning-foreground" },
  failed: { label: "Failed", icon: CircleAlert, className: "text-destructive" },
  blocked: { label: "Could not run", icon: TriangleAlert, className: "text-warning-foreground" },
  running: { label: "Running", icon: LoaderCircle, className: "text-info-foreground" },
  "not-run": {
    label: "Not run yet",
    icon: CircleDashed,
    className: "text-muted-foreground",
  },
};

function detail(run: ProductRunSummary | undefined, state: CheckState): string {
  if (!run) return "";
  const summary = run.captureSummary;
  const parts: string[] = [];
  if (state === "review" && summary) {
    if (summary.changed) parts.push(`${summary.changed} changed`);
    if (summary.new) parts.push(`${summary.new} new`);
    if (!summary.changed && !summary.new)
      parts.push(`${summary.pending} ${summary.pending === 1 ? "screenshot" : "screenshots"}`);
  }
  if (state === "passed" && summary?.unchanged) parts.push("matches references");
  if (state === "failed" && summary?.issue) parts.push(`${summary.issue} issue reported`);
  if (run.targetName) parts.push(run.targetName);
  parts.push(relativeTime(run.finishedAt ?? run.startedAt ?? run.queuedAt));
  return parts.filter(Boolean).join(" · ");
}

/** Coverage from one exact scheduled occurrence, or the latest manual batch. */
export function PlanChecklist({
  appId,
  suiteId,
  tests,
  occurrence: suppliedOccurrence,
  scheduleIds = [],
}: {
  appId: string;
  suiteId: string;
  tests: readonly PlanTest[];
  occurrence?: { jobs: readonly { id: string; testId?: string }[] };
  scheduleIds?: readonly string[];
}) {
  const { catalogService, suiteProfileService } = useRouteContext({ from: "__root__" });
  const occurrences = useQuery({
    queryKey: ["plan-occurrences", ...scheduleIds],
    queryFn: () => suiteProfileService.listPlanOccurrences!(scheduleIds),
    enabled: Boolean(scheduleIds.length && suiteProfileService?.listPlanOccurrences),
    refetchInterval: 5_000,
  });
  const latestOccurrence = occurrences.data?.reduce<(typeof occurrences.data)[number] | undefined>(
    (latest, item) => (!latest || item.scheduledAt > latest.scheduledAt ? item : latest),
    undefined,
  );
  const occurrence =
    suppliedOccurrence ?? latestOccurrence ?? (scheduleIds.length ? { jobs: [] } : undefined);
  const runs = useQuery({
    queryKey: [...catalogQueryKeys.runs, "app", appId],
    queryFn: () => catalogService.listRuns({ appMapId: appId }),
    staleTime: 5_000,
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.phase === "queued" || run.phase === "running")
        ? 3_000
        : 30_000,
  });
  const latest = latestCycleRuns(
    runs.data ?? [],
    tests.map((test) => test.id),
    { appMapId: appId, combineId: suiteId },
    occurrence,
  );
  const states = tests.map((test) => {
    const testRuns = latest.get(test.id) ?? [];
    const state = aggregateCheckState(testRuns);
    const expected = occurrence?.jobs.filter((job) => job.testId === test.id).length ?? 0;
    return state === "passed" && expected > testRuns.length ? "not-run" : state;
  });
  const cycleRuns = [...latest.values()].flat();
  const completeCoverage =
    !latestOccurrence ||
    (latestOccurrence.state === "completed" &&
      cycleRuns.length >= latestOccurrence.expectedCaseCount);
  const toReview = cycleRuns.reduce((total, run) => total + (run.captureSummary?.pending ?? 0), 0);
  const lastActivity = Math.max(
    0,
    ...cycleRuns.map((run) => run.finishedAt ?? run.startedAt ?? run.queuedAt),
  );

  return (
    <section className="min-w-0" aria-labelledby="plan-checklist-title">
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 pb-1">
        <div className="grid gap-0.5">
          {scheduleIds.length ? (
            <p className="text-xs text-muted-foreground">
              {occurrences.isError
                ? "Scheduled results unavailable"
                : occurrences.isPending
                  ? "Loading scheduled run…"
                  : latestOccurrence
                    ? `Latest scheduled run: ${latestOccurrence.state}${latestOccurrence.detail ? ` · ${latestOccurrence.detail}` : ""}`
                    : "Waiting for the first scheduled run"}
            </p>
          ) : null}
          <h2 id="plan-checklist-title" className="text-sm font-semibold text-foreground">
            Tests
          </h2>
          {runs.isSuccess && latest.size && completeCoverage ? (
            <span className="w-64 max-w-full">
              <ResultsBar states={states} />
            </span>
          ) : null}
          <p className="text-xs text-muted-foreground tabular-nums">
            {runs.isPending
              ? "Loading results…"
              : runs.error
                ? "Results unavailable"
                : lastActivity
                  ? `Last activity ${relativeTime(lastActivity)}`
                  : "Not run yet"}
          </p>
        </div>
        {toReview ? (
          <Button
            nativeButton={false}
            size="sm"
            render={<Link to="/review" search={{ app: appId }} />}
          >
            <Eye aria-hidden="true" />
            Review {toReview} {toReview === 1 ? "screenshot" : "screenshots"}
          </Button>
        ) : null}
      </div>

      <ul className="mt-3 grid min-w-0 list-none gap-1 p-0">
        {tests.map((test, index) => {
          const testRuns = latest.get(test.id) ?? [];
          const run = representativeRun(testRuns);
          const state = states[index]!;
          const presentation = STATE_PRESENTATION[state];
          const label =
            !run && runs.isPending
              ? "Loading result…"
              : !run && runs.error
                ? "Result unavailable"
                : presentation.label;
          const Icon = presentation.icon;
          return (
            <li
              key={test.id}
              className="grid min-h-12 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/40"
            >
              <Icon
                className={`size-4 shrink-0 ${presentation.className} ${state === "running" ? "animate-spin motion-reduce:animate-none" : ""}`}
                aria-label={label}
              />
              <span className="grid min-w-0 gap-0.5">
                <Link
                  className="truncate text-sm font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  to="/tests/$testId"
                  params={{ testId: test.id }}
                  search={{ plan: suiteId, planApp: appId }}
                >
                  {test.name}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {test.status === "needs-review"
                    ? "Steps need review before this can run"
                    : [
                        label,
                        testRuns.length > 1 ? `${testRuns.length} cases` : "",
                        detail(run, state),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </span>
              </span>
              {run ? (
                <Button
                  nativeButton={false}
                  size="sm"
                  variant="ghost"
                  render={<Link to="/runs/$runId" params={{ runId: run.id }} />}
                >
                  Result
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
