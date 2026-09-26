/** @jsxImportSource react */
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import { ArrowRight, CircleX, Eye, Layers3, Plus } from "lucide-react";
import type { ProductRunSummary } from "@relay/product/catalog";
import { catalogQueryKeys } from "../data/catalog-queries";
import { createReviewProductService, reviewQueryKeys } from "../data/review-product-service";
import { ResultsBar } from "../components/results-bar";
import { RunThumb } from "../components/run-thumb";
import { StatusPill, runStateOf } from "../components/run-status";
import { latestRunPerTest } from "./plan-checklist";

function ago(value: number): string {
  const minutes = Math.round((Date.now() - value) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function runTime(run: ProductRunSummary): number {
  return run.finishedAt ?? run.startedAt ?? run.queuedAt;
}

function Counter({
  to,
  icon: Icon,
  value,
  label,
  tone,
}: {
  to: "/review" | "/runs" | "/suites";
  icon: typeof Eye;
  value: number | undefined;
  label: string;
  tone: "brand" | "danger" | "quiet";
}) {
  return (
    <Link
      to={to}
      {...(to === "/runs" ? { search: { view: "failed" } } : {})}
      className="group/counter flex min-w-0 flex-col items-start gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:gap-3.5 sm:p-4 transition-[border-color,box-shadow] duration-150 ease-out outline-none hover:border-primary/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={`hidden size-10 shrink-0 items-center sm:flex justify-center rounded-lg ${
          tone === "brand"
            ? "bg-brand-soft text-brand"
            : tone === "danger"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground"
        }`}
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-2xl leading-8 font-semibold tabular-nums">{value ?? "–"}</span>
        <span className="text-xs text-muted-foreground sm:text-sm">{label}</span>
      </span>
      <ArrowRight
        className="hidden size-4 text-muted-foreground transition-transform duration-150 group-hover/counter:translate-x-0.5 sm:block"
        aria-hidden="true"
      />
    </Link>
  );
}

/** The daily starting point: what needs a person now, and the checks to run. */
export function TodayPage() {
  const { platform, catalogService, suiteProfileService } = useRouteContext({ from: "__root__" });
  const review = useMemo(() => createReviewProductService(platform), [platform]);
  const inbox = useQuery({
    queryKey: reviewQueryKeys.inbox(),
    queryFn: () => review.inbox(),
    staleTime: 30_000,
  });
  const suites = useQuery({
    queryKey: ["suites", "all"],
    queryFn: () => suiteProfileService.listSuites(undefined),
    staleTime: 15_000,
  });
  const runs = useQuery({
    queryKey: catalogQueryKeys.runs,
    queryFn: () => catalogService.listRuns(),
    staleTime: 15_000,
  });
  const planApps = [...new Set((suites.data ?? []).map((suite) => suite.appMapId))];
  const appRuns = useQueries({
    queries: planApps.map((appMapId) => ({
      queryKey: [...catalogQueryKeys.runs, "app", appMapId],
      queryFn: () => catalogService.listRuns({ appMapId }),
      staleTime: 15_000,
    })),
  });
  const runsByApp = new Map(planApps.map((appMapId, index) => [appMapId, appRuns[index]?.data]));

  const toReview = inbox.data?.entries.reduce((total, entry) => total + entry.items.length, 0);
  const recent = [...(runs.data ?? [])].sort((left, right) => runTime(right) - runTime(left));
  const weekAgo = Date.now() - 86_400_000 * 7;
  const failed = recent.filter(
    (run) => runStateOf(run) === "failed" && runTime(run) >= weekAgo && !run.batchId,
  );
  // One row per Test: its newest run, when that run needs a person.
  const newestPerTest = new Map<string, ProductRunSummary>();
  for (const run of recent) {
    if (run.batchId) continue;
    const key = run.testId ?? run.id;
    if (!newestPerTest.has(key)) newestPerTest.set(key, run);
  }
  const attention = [...newestPerTest.values()]
    .filter((run) => {
      const state = runStateOf(run);
      return state === "failed" || state === "review";
    })
    .slice(0, 6);
  const plans = (suites.data ?? [])
    .map((suite) => {
      const latest = latestRunPerTest(
        runsByApp.get(suite.appMapId) ?? [],
        suite.tests.map((test) => test.id),
      );
      const states = suite.tests.map((test) => runStateOf(latest.get(test.id)));
      const last = Math.max(0, ...[...latest.values()].map(runTime));
      return { suite, states, last };
    })
    .sort((left, right) => right.last - left.last)
    .slice(0, 6);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <section className="mx-auto w-full max-w-6xl px-[clamp(20px,3vw,40px)] pt-8 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-sm text-muted-foreground">{today}</p>
          <h1 className="text-3xl leading-9 font-semibold tracking-tight">Today</h1>
        </div>
        <Button nativeButton={false} render={<Link to="/tests/new" />}>
          <Plus aria-hidden="true" /> New test
        </Button>
      </header>

      <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
        <Counter
          to="/review"
          icon={Eye}
          value={toReview}
          label="screenshots to review"
          tone="brand"
        />
        <Counter
          to="/runs"
          icon={CircleX}
          value={runs.data ? failed.length : undefined}
          label="failed this week"
          tone={failed.length ? "danger" : "quiet"}
        />
        <Counter
          to="/suites"
          icon={Layers3}
          value={suites.data?.length}
          label="test plans"
          tone="quiet"
        />
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="today-plans">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="today-plans" className="text-base font-semibold">
              Your test plans
            </h2>
            <Link className="text-sm font-medium text-primary hover:underline" to="/suites">
              All plans
            </Link>
          </div>
          {plans.length ? (
            <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
              {plans.map(({ suite, states, last }) => (
                <li key={`${suite.appMapId}:${suite.id}`}>
                  <Link
                    to="/apps/$appId/suites/$suiteId"
                    params={{ appId: suite.appMapId, suiteId: suite.id }}
                    className="grid h-full gap-3 rounded-xl border border-border bg-card p-4 transition-[border-color,box-shadow] duration-150 ease-out outline-none hover:border-primary/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-start gap-3">
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"
                        aria-hidden="true"
                      >
                        <Layers3 className="size-4" />
                      </span>
                      <span className="grid min-w-0">
                        <strong className="truncate text-sm font-semibold">{suite.name}</strong>
                        <span className="truncate text-xs text-muted-foreground">
                          {suite.appName} · {suite.tests.length}{" "}
                          {suite.tests.length === 1 ? "check" : "checks"}
                          {last ? ` · ${ago(last)}` : ""}
                        </span>
                      </span>
                    </span>
                    <ResultsBar states={states} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid justify-items-start gap-3 rounded-xl border border-dashed border-border p-6">
              <p className="text-sm text-muted-foreground">
                Group the checks you run every day into a plan and run them together.
              </p>
              <Button
                nativeButton={false}
                variant="outline"
                size="sm"
                render={<Link to="/suites" />}
              >
                Create a test plan
              </Button>
            </div>
          )}
        </section>

        <section aria-labelledby="today-attention">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="today-attention" className="text-base font-semibold">
              Needs attention
            </h2>
            <Link className="text-sm font-medium text-primary hover:underline" to="/runs">
              All results
            </Link>
          </div>
          {attention.length ? (
            <ul className="m-0 grid list-none gap-1 p-0">
              {attention.map((run) => (
                <li key={run.id}>
                  <Link
                    to="/runs/$runId"
                    params={{ runId: run.id }}
                    className="flex min-w-0 items-center gap-3 rounded-lg p-2 transition-colors duration-150 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <RunThumb runId={run.id} label={run.testName ?? run.title} />
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="truncate text-sm font-medium">
                        {run.testName ?? run.title}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <StatusPill state={runStateOf(run)} />
                        {ago(runTime(run))}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              Nothing needs you right now.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
