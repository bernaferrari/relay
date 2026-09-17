import { libraryRowSurface, libraryRowContent } from "../components/library-row-styles";
/** @jsxImportSource react */
import type { ProductRunPhase, ProductRunSummary } from "@relay/product/catalog";
import { Tabs, TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import { Button } from "@relay/ui-react/components/button";

import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { LibrarySearch, LibraryToolbar } from "../components/library-toolbar";
import { EmptyState, OutcomeMark } from "../components/product-patterns";
import { RunHistoryList, type RunHistoryRowInteraction } from "../components/run-history-list";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { catalogQueryKeys } from "../data/catalog-queries";
import { PageLoading, RecordingProblem } from "./recording-shared";
import { useCollectionReturnFocus } from "../hooks/use-collection-return-focus";
import { collapsePlanResultRows, planResultListCause } from "./runs-plan-results";

const routeApi = getRouteApi("/runs");

type RunView = "latest" | "all" | "failed" | "needs-review" | "active";

const runViews: readonly { id: RunView; label: string }[] = [
  { id: "all", label: "All Runs" },
  { id: "failed", label: "Failed" },
  { id: "needs-review", label: "Needs review" },
  { id: "active", label: "Active" },
  { id: "latest", label: "Latest per Test" },
];

export function RunsPage() {
  const { catalogService } = useRouteContext({ from: "__root__" });
  const search = routeApi.useSearch() as {
    app?: unknown;
    test?: unknown;
    view?: unknown;
    q?: unknown;
  };
  const navigate = useNavigate({ from: "/runs" });
  const [query, setQuery] = useState(() => (typeof search.q === "string" ? search.q : ""));
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const view = runView(search.view);
  const app = typeof search.app === "string" ? search.app : "";
  const testId = typeof search.test === "string" ? search.test : "";
  useEffect(() => {
    setQuery(typeof search.q === "string" ? search.q : "");
  }, [search.q]);
  const historyComplete = typeof catalogService.listRunsComplete === "function";
  const runs = useQuery({
    queryKey: [...catalogQueryKeys.runs, historyComplete ? "complete" : "first-page", app, testId],
    queryFn: () =>
      historyComplete
        ? catalogService.listRunsComplete!({
            appMapId: app || undefined,
            testId: testId || undefined,
          })
        : catalogService.listRuns({ appMapId: app || undefined, testId: testId || undefined }),
    staleTime: 10_000,
    refetchInterval: (queryState) =>
      queryState.state.data?.some((run) => run.phase === "queued" || run.phase === "running")
        ? 3_000
        : false,
  });
  const visibleRuns = useMemo(() => {
    const searched = (runs.data ?? []).filter(
      (run) =>
        (!app || run.appMapId === app) &&
        (!testId || run.testId === testId) &&
        (!deferredQuery ||
          `${run.title} ${run.testName ?? ""} ${run.appName ?? ""} ${run.targetName ?? ""}`
            .toLocaleLowerCase()
            .includes(deferredQuery)),
    );
    if (view === "latest") return collapsePlanResultRows(latestRuns(searched));
    if (view === "failed") {
      return collapsePlanResultRows(searched.filter((run) => run.phase === "failed"));
    }
    if (view === "needs-review") {
      return collapsePlanResultRows(
        searched.filter((run) => run.review?.status === "pending" || run.outcome === "uncertain"),
      );
    }
    if (view === "active") {
      return collapsePlanResultRows(
        searched.filter((run) => run.phase === "queued" || run.phase === "running"),
      );
    }
    return collapsePlanResultRows(searched);
  }, [app, deferredQuery, runs.data, testId, view]);
  const returnFocus = useCollectionReturnFocus("relay:focus:/runs", visibleRuns, [
    "/runs/",
    "/batches/",
  ]);
  function setView(next: RunView) {
    void navigate({
      search: (previous) => ({ ...previous, view: next === "all" ? undefined : next }),
    });
  }

  function clearFilters() {
    setQuery("");
    void navigate({
      search: (previous) => ({
        ...previous,
        app: undefined,
        test: undefined,
        view: undefined,
        q: undefined,
      }),
    });
  }

  return (
    <LibraryPage
      className="relay-library-page relay-runs-page mx-auto flex min-h-full w-full max-w-[1040px] flex-col"
      onClickCapture={returnFocus.onClickCapture}
    >
      <PageHeader
        title="Results"
        description="Review screenshots, investigate problems, and follow runs in progress."
      />

      <LibraryToolbar
        label="Filter Runs"
        tabs={
          <Tabs
            className="border-b border-border pb-1.5"
            value={view}
            onValueChange={(next) => setView(next as RunView)}
          >
            <TabsList variant="line" className="h-9 justify-start" aria-label="Run view">
              {runViews.map((item) => (
                <TabsTrigger key={item.id} value={item.id}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
        search={
          <LibrarySearch
            id="run-search"
            label="Search Runs"
            value={query}
            placeholder="Search by Test, app, or device"
            onChange={(next) => {
              setQuery(next);
              void navigate({
                search: (previous) => ({ ...previous, q: next || undefined }),
                replace: true,
              });
            }}
          />
        }
        filters={
          <>
            {view !== "all" || app || testId || query ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear
              </Button>
            ) : null}
          </>
        }
      />

      {runs.isPending ? <PageLoading label="Loading Runs…" /> : null}
      <RecordingProblem
        error={runs.data === undefined ? runs.error : null}
        onRetry={() => void runs.refetch()}
        retrying={runs.isFetching}
        layout="centered"
      />

      {runs.isError && runs.data !== undefined ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm"
        >
          <div>
            <p className="font-medium">Couldn’t refresh results</p>
            <p className="text-muted-foreground">
              Showing the last loaded results. Updates will resume when Relay reconnects.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={runs.isFetching}
            onClick={() => void runs.refetch()}
          >
            {runs.isFetching ? "Retrying…" : "Try again"}
          </Button>
        </div>
      ) : null}

      {runs.data !== undefined && visibleRuns.length ? (
        <section
          id="run-history-results"
          className="relay-library-results mt-3"
          aria-labelledby="run-history-title"
        >
          <div className="relay-library-results-heading flex min-h-8 items-center justify-between gap-5 px-0.5 pb-2.5">
            <h2 id="run-history-title" className="text-[13px] font-semibold">
              {visibleRuns.length === 1 ? "1 Result" : `${visibleRuns.length} Results`}
            </h2>
            <span className="text-xs text-[var(--text-weak)]" aria-live="polite">
              {runs.isError ? "Last loaded results" : runViewDescription(view, historyComplete)}
            </span>
          </div>
          <RunHistoryList runs={visibleRuns}>
            {(run, _index, interaction) => <RunRow run={run} interaction={interaction} />}
          </RunHistoryList>
        </section>
      ) : null}

      {runs.data !== undefined && !visibleRuns.length ? (
        runs.data?.length ? (
          <EmptyState
            title={emptyRunTitle(view)}
            detail="Choose another view, app, or search. Existing Reports remain unchanged."
            action={
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Show all Runs
              </Button>
            }
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              title="No results yet"
              detail="Open a saved Test and run it on a Device or Browser."
              action={
                <Link
                  className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
                  to="/tests"
                >
                  Browse saved Tests
                </Link>
              }
            />
          </div>
        )
      ) : null}
    </LibraryPage>
  );
}

function RunRow({
  run,
  interaction,
}: {
  run: ProductRunSummary;
  interaction?: RunHistoryRowInteraction;
}) {
  const plan = Boolean(run.batchId);
  const title = plan ? run.title : (run.testName ?? run.title);
  const device = run.targetName ?? platformName(run.platform);
  const cause = planResultListCause(run);
  const className = `relay-run-row ${libraryRowSurface} ${libraryRowContent} grid-cols-[minmax(0,1fr)_100px]`;
  const body = (
    <>
      <span className="relay-library-row-main grid min-w-0 gap-1">
        <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-[var(--text-strong)]">
          {title}
        </strong>
        <span className="relay-run-row-context flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-[var(--text-weak)]">
          <OutcomeMark outcome={run.outcome ?? phaseOutcome(run)} />
          <span className="truncate">
            {[device, cause].filter(Boolean).join(" · ") || (plan ? "Plan Result" : "Saved Run")}
          </span>
          {plan ? (
            <span className="shrink-0 font-semibold text-[var(--text-base)]">Plan Result</span>
          ) : null}
        </span>
      </span>
      <span className="relay-library-row-recent grid min-w-0 justify-items-start gap-1 tabular-nums">
        <strong className="text-xs font-semibold text-[var(--text-base)]">
          {plan && run.caseCount
            ? `${run.caseCount} Tests`
            : run.durationMs === undefined
              ? phaseDetail(run)
              : formatDuration(run.durationMs)}
        </strong>
        <small className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--text-weak)]">
          {relativeTime(run.finishedAt ?? run.startedAt ?? run.queuedAt)}
        </small>
      </span>
    </>
  );
  if (run.batchId) {
    return (
      <Link
        to="/batches/$batchId"
        params={{ batchId: run.batchId }}
        className={className}
        {...interaction}
      >
        {body}
      </Link>
    );
  }
  return (
    <Link to="/runs/$runId" params={{ runId: run.id }} className={className} {...interaction}>
      {body}
    </Link>
  );
}

function latestRuns(runs: readonly ProductRunSummary[]) {
  const seen = new Set<string>();
  return [...runs]
    .sort((left, right) => runTime(right) - runTime(left) || right.id.localeCompare(left.id))
    .filter((run) => {
      const identity = run.testId ? `${run.appMapId ?? "app"}:${run.testId}` : run.id;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
}

function runView(value: unknown): RunView {
  return value === "latest" || value === "failed" || value === "needs-review" || value === "active"
    ? value
    : "all";
}

function runViewDescription(view: RunView, historyComplete: boolean) {
  if (view === "latest") return "Most recent result for each Test";
  if (view === "failed") return "App failures and Runs that could not start";
  if (view === "needs-review") return "Waiting for review";
  if (view === "active") return "Queued and in progress";
  return historyComplete ? "Complete history" : "Loaded history";
}

function emptyRunTitle(view: RunView) {
  if (view === "failed") return "No problem Runs match";
  if (view === "needs-review") return "No Runs need review";
  if (view === "active") return "No Runs are active";
  return "No Runs match these filters";
}

function phaseOutcome(run: ProductRunSummary): ProductRunPhase | "uncertain" {
  if (run.review?.status === "pending") return "uncertain";
  return run.phase;
}

function phaseDetail(run: ProductRunSummary) {
  if (run.phase === "queued") return "Waiting to start";
  if (run.phase === "running") return "In progress";
  if (run.phase === "failed") return "Could not complete";
  if (run.phase === "cancelled") return "Cancelled";
  if (run.outcome === "uncertain") return "Needs review";
  return "Report available";
}

function platformName(value: string | undefined) {
  if (value === "ios") return "Apple device";
  if (value === "android") return "Android device";
  if (value === "browser") return "Browser";
  return undefined;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function relativeTime(value: number): string {
  const elapsed = Math.max(0, Date.now() - value);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value);
}

function runTime(run: ProductRunSummary): number {
  return run.finishedAt ?? run.startedAt ?? run.queuedAt;
}
