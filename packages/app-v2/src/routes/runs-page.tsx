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
import { Camera, ChevronRight, Globe } from "lucide-react";
import {
  collapsePlanResultRows,
  screenshotReviewLabel,
  hasScreenshotReviewAttention,
} from "./runs-plan-results";
import { productLinkClassName } from "../lib/class-names";

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
    // Filters select Results, but never discard the sibling Runs needed to
    // describe a Plan accurately (including other devices and pending reviews).
    const matching =
      view === "latest"
        ? latestRuns(searched)
        : searched.filter((run) => {
            if (view === "failed") return run.phase === "failed";
            if (view === "needs-review")
              return (
                hasScreenshotReviewAttention(run) ||
                run.review?.status === "pending" ||
                run.outcome === "uncertain"
              );
            if (view === "active") return run.phase === "queued" || run.phase === "running";
            return true;
          });
    const selected = new Set(
      matching.map((run) => (run.batchId ? `plan:${run.batchId}` : `run:${run.id}`)),
    );
    const rows = new Map(
      collapsePlanResultRows(runs.data ?? []).map((run) => [
        run.batchId ? `plan:${run.batchId}` : `run:${run.id}`,
        run,
      ]),
    );
    return [...selected].flatMap((key) => {
      const row = rows.get(key);
      return row ? [row] : [];
    });
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
      className="mx-auto flex min-h-full w-full max-w-5xl flex-col"
      onClickCapture={returnFocus.onClickCapture}
    >
      <PageHeader
        title="Results"
        description="Review screenshots, investigate problems, and follow runs in progress."
      />

      <LibraryToolbar
        label="Filter Runs"
        tabs={
          <Tabs value={view} onValueChange={(next) => setView(next as RunView)}>
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
        <section id="run-history-results" className="mt-3" aria-labelledby="run-history-title">
          <div className="flex min-h-8 items-center justify-between gap-5 px-0.5 pb-2.5">
            <h2 id="run-history-title" className="text-sm font-semibold">
              {visibleRuns.length === 1 ? "1 Result" : `${visibleRuns.length} Results`}
            </h2>
            <span className="text-xs text-muted-foreground" aria-live="polite">
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
                <Link className={productLinkClassName} to="/tests">
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
  const screenshotReview = screenshotReviewLabel(run.captureSummary);
  const genericBrowser = device === "Browser";
  const chromeBrowser = run.platform === "browser" && /\bchrome\b/i.test(run.targetName ?? "");
  const className = `${libraryRowSurface} ${libraryRowContent} h-22 grid-cols-[minmax(0,1fr)_auto] gap-3 sm:gap-5`;
  const body = (
    <>
      <span className="grid min-w-0 gap-2">
        <strong className="truncate text-sm font-semibold text-foreground">{title}</strong>
        <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
          <OutcomeMark
            outcome={
              screenshotReview && run.phase === "completed" && run.outcome === "passed"
                ? "completed"
                : (run.outcome ?? phaseOutcome(run))
            }
          />
          {genericBrowser || chromeBrowser ? (
            <span className="inline-flex shrink-0 items-center" title={device}>
              {chromeBrowser ? (
                <svg
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 8h9.2M15.5 14l-4.6 7.9M8.5 14 3.9 6.1" />
                </svg>
              ) : (
                <Globe className="size-4" aria-hidden="true" />
              )}
              <span className="sr-only">{device}</span>
            </span>
          ) : (
            <span className="truncate">{device || (plan ? "Plan Result" : "Saved Run")}</span>
          )}
          <span aria-hidden="true">·</span>
          <span className="shrink-0 tabular-nums">
            {plan && run.caseCount
              ? `${run.caseCount} Tests`
              : run.durationMs === undefined
                ? phaseDetail(run)
                : formatDuration(run.durationMs)}
          </span>
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <span className="grid justify-items-end gap-2">
          <small className="text-xs text-muted-foreground tabular-nums">
            {relativeTime(run.finishedAt ?? run.startedAt ?? run.queuedAt)}
          </small>
          {screenshotReview ? (
            <span
              className="flex max-w-40 items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-xs font-medium text-foreground"
              aria-label={`Screenshots: ${screenshotReview}`}
            >
              <Camera className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{screenshotReview}</span>
            </span>
          ) : null}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
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
