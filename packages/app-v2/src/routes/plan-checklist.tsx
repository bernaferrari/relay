/** @jsxImportSource react */
import { useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import type { ProductRunSummary } from "@relay/product/catalog";
import { CircleAlert, CircleCheck, CircleDashed, Eye, LoaderCircle } from "lucide-react";
import { catalogQueryKeys } from "../data/catalog-queries";
import { ResultsBar } from "../components/results-bar";

type PlanTest = { id: string; name: string; status: string };

export type CheckState = "passed" | "review" | "failed" | "running" | "not-run";

export function checkState(run: ProductRunSummary | undefined): CheckState {
  if (!run) return "not-run";
  if (run.phase === "queued" || run.phase === "running") return "running";
  if (
    run.phase === "failed" ||
    run.outcome === "product-failure" ||
    run.outcome === "harness-failure" ||
    (run.captureSummary?.issue ?? 0) > 0
  )
    return "failed";
  if ((run.captureSummary?.pending ?? 0) > 0) return "review";
  if (run.phase === "completed") return "passed";
  return "not-run";
}

export function latestRunPerTest(
  runs: readonly ProductRunSummary[],
  testIds: readonly string[],
): Map<string, ProductRunSummary> {
  const wanted = new Set(testIds);
  const latest = new Map<string, ProductRunSummary>();
  for (const run of runs) {
    if (!run.testId || !wanted.has(run.testId)) continue;
    const current = latest.get(run.testId);
    if (!current || run.queuedAt > current.queuedAt) latest.set(run.testId, run);
  }
  return latest;
}

function ago(value?: number): string {
  if (!value) return "";
  const minutes = Math.round((Date.now() - value) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const STATE_PRESENTATION: Record<
  CheckState,
  { label: string; icon: typeof CircleCheck; className: string }
> = {
  passed: { label: "Passed", icon: CircleCheck, className: "text-success-foreground" },
  review: { label: "To review", icon: Eye, className: "text-warning-foreground" },
  failed: { label: "Failed", icon: CircleAlert, className: "text-destructive" },
  running: { label: "Running", icon: LoaderCircle, className: "text-info-foreground" },
  "not-run": { label: "Not run yet", icon: CircleDashed, className: "text-muted-foreground" },
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
  parts.push(ago(run.finishedAt ?? run.startedAt ?? run.queuedAt));
  return parts.filter(Boolean).join(" · ");
}

/** The Plan as a daily checklist: every Test with its latest result. */
export function PlanChecklist({
  appId,
  suiteId,
  tests,
}: {
  appId: string;
  suiteId: string;
  tests: readonly PlanTest[];
}) {
  const { catalogService } = useRouteContext({ from: "__root__" });
  const runs = useQuery({
    queryKey: [...catalogQueryKeys.runs, "app", appId],
    queryFn: () => catalogService.listRuns({ appMapId: appId }),
    staleTime: 5_000,
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.phase === "queued" || run.phase === "running")
        ? 3_000
        : 30_000,
  });
  const latest = latestRunPerTest(
    runs.data ?? [],
    tests.map((test) => test.id),
  );
  const states = tests.map((test) => checkState(latest.get(test.id)));
  const count = (state: CheckState) => states.filter((item) => item === state).length;
  const toReview = [...latest.values()].reduce(
    (total, run) => total + (run.captureSummary?.pending ?? 0),
    0,
  );
  const lastActivity = Math.max(
    0,
    ...[...latest.values()].map((run) => run.finishedAt ?? run.startedAt ?? run.queuedAt),
  );

  return (
    <section className="min-w-0" aria-labelledby="plan-checklist-title">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="grid gap-0.5">
          <h2 id="plan-checklist-title" className="text-sm font-semibold text-foreground">
            Latest results
          </h2>
          <span className="w-64 max-w-full">
            <ResultsBar states={states} />
          </span>
          <p className="text-xs text-muted-foreground tabular-nums">
            {runs.isPending
              ? "Loading results…"
              : lastActivity
                ? `Last activity ${ago(lastActivity)}`
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
          const run = latest.get(test.id);
          const state = states[index]!;
          const presentation = STATE_PRESENTATION[state];
          const Icon = presentation.icon;
          return (
            <li
              key={test.id}
              className="grid min-h-12 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/40"
            >
              <Icon
                className={`size-4 shrink-0 ${presentation.className} ${state === "running" ? "animate-spin motion-reduce:animate-none" : ""}`}
                aria-label={presentation.label}
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
                    : [presentation.label, detail(run, state)].filter(Boolean).join(" · ")}
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
