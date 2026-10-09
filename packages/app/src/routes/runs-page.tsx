import { libraryRowSurface, libraryRowContent } from "../components/library-row-styles";
/** @jsxImportSource react */
import { RunThumb } from "../components/run-thumb";
import { StatusPill, runStateOf } from "../components/run-status";
import type { ProductRunPhase, ProductRunSummary } from "@relay/product/catalog";
import { Tabs, TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import { Button } from "@relay/ui-react/components/button";

import { useQuery } from "@tanstack/react-query";
import {
  Link,
  getRouteApi,
  useNavigate,
  useRouteContext,
  useLocation,
} from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { LibrarySearch, LibraryToolbar } from "../components/library-toolbar";
import { EmptyState, OutcomeMark } from "../components/product-patterns";
import { RunHistoryList, type RunHistoryRowInteraction } from "../components/run-history-list";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { catalogQueryKeys } from "../data/catalog-queries";
import { PageLoading, RecordingProblem, RefreshProblem } from "./recording-shared";
import { useCollectionReturnFocus } from "../hooks/use-collection-return-focus";
import { Camera, ChevronRight, Globe, ScanEye } from "lucide-react";
import { formatReviewCount, useReviewCount } from "../layout/review-count";
import {
  collapsePlanResultRows,
  screenshotReviewLabel,
  hasScreenshotReviewAttention,
} from "./runs-plan-results";
import { productLinkClassName } from "../lib/class-names";

const routeApi = getRouteApi("/runs");

type RunView = "all" | "failed" | "needs-review";

// Running work is always pinned on top, and each Test's latest result lives
// on the Tests page, so three views are enough here.
const runViews: readonly { id: RunView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "failed", label: "Failed" },
  { id: "needs-review", label: "Needs review" },
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
  const reviewCount = useReviewCount(app || undefined);
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
    const matching = searched.filter((run) => {
      if (view === "failed") return run.phase === "failed";
      if (view === "needs-review")
        return (
          hasScreenshotReviewAttention(run) ||
          run.review?.status === "pending" ||
          run.outcome === "uncertain"
        );
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
        title="Runs"
        description="Everything that ran, newest first."
        actions={
          reviewCount ? (
            <Button
              nativeButton={false}
              size="sm"
              variant="outline"
              render={<Link to="/review" search={app ? { app } : {}} />}
            >
              <ScanEye aria-hidden="true" />
              Review screenshots
              <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                {formatReviewCount(reviewCount)}
              </span>
            </Button>
          ) : null
        }
      />

      <LibraryToolbar
        label="Filter Runs"
        tabs={
          <Tabs
            className="min-w-0 max-w-full overflow-x-auto"
            value={view}
            onValueChange={(next) => setView(next as RunView)}
          >
            <TabsList variant="line" className="h-9 justify-start" aria-label="Run view">
              {runViews.map((item) => (
                <TabsTrigger key={item.id} value={item.id}>
                  {item.label}
                  {item.id === "needs-review" && reviewCount ? (
                    <span
                      className="rounded-full bg-brand px-1.5 text-xs font-semibold text-brand-foreground tabular-nums"
                      aria-label={`${reviewCount} screenshots to review`}
                    >
                      {formatReviewCount(reviewCount)}
                    </span>
                  ) : null}
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
        <RefreshProblem
          subject="runs"
          onRetry={() => void runs.refetch()}
          retrying={runs.isFetching}
        />
      ) : null}

      {runs.data !== undefined && visibleRuns.length ? (
        <div className="mt-3 grid gap-6" aria-live="polite">
          {runsByDay(visibleRuns).map(({ label, runs: dayRuns, live }) => (
            <section key={label} aria-label={label} className="grid gap-2">
              <h2
                className={`flex items-center gap-2 px-0.5 text-sm font-semibold ${live ? "text-brand" : ""}`}
              >
                {live ? (
                  <span
                    className="size-2 animate-pulse rounded-full bg-brand motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : null}
                {label}
                <span className="font-normal text-muted-foreground">{dayRuns.length}</span>
              </h2>
              <RunHistoryList runs={dayRuns}>
                {(run, _index, interaction) => <RunRow run={run} interaction={interaction} />}
              </RunHistoryList>
            </section>
          ))}
          <p className="px-0.5 text-xs text-muted-foreground">
            {runs.isError ? "Last loaded runs" : runViewDescription(view, historyComplete)}
          </p>
        </div>
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
              title="No runs yet"
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
  const location = useLocation();
  const plan = Boolean(run.batchId);
  const title = plan ? run.title : (run.testName ?? run.title);
  const device = run.targetName ?? platformName(run.platform);
  const screenshotReview = screenshotReviewLabel(run.captureSummary);
  const genericBrowser = device === "Browser";
  const chromeBrowser = run.platform === "browser" && /\bchrome\b/i.test(run.targetName ?? "");
  const className = `${libraryRowSurface} ${libraryRowContent} h-20 grid-cols-[auto_minmax(0,1fr)_auto] gap-3.5 sm:gap-5`;
  const state = runStateOf(run);
  const body = (
    <>
      <RunThumb runId={run.id} label={title} available={run.frameCount !== 0} />
      <span className="grid min-w-0 gap-1.5">
        <strong className="truncate text-sm font-semibold text-foreground">{title}</strong>
        <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
          <StatusPill
            state={state}
            {...(run.outcome === "harness-failure" ? { label: "Could not complete" } : {})}
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
              className="flex max-w-44 items-center gap-1.5 text-xs text-muted-foreground"
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
        search={{ returnTo: location.href }}
        className={className}
        {...interaction}
      >
        {body}
      </Link>
    );
  }
  return (
    <Link
      to="/runs/$runId"
      params={{ runId: run.id }}
      search={{ returnTo: location.href }}
      className={className}
      {...interaction}
    >
      {body}
    </Link>
  );
}

/** Running work first, then one group per day, newest first. */
function runsByDay(runs: readonly ProductRunSummary[]) {
  const live = runs.filter((run) => run.phase === "queued" || run.phase === "running");
  const done = runs
    .filter((run) => !live.includes(run))
    .sort((left, right) => runTime(right) - runTime(left));
  const groups: { label: string; runs: ProductRunSummary[]; live?: boolean }[] = [];
  if (live.length) groups.push({ label: "Running now", runs: live, live: true });
  for (const run of done) {
    const label = dayLabel(runTime(run));
    const group = groups.at(-1);
    if (group && !group.live && group.label === label) group.runs.push(run);
    else groups.push({ label, runs: [run] });
  }
  return groups;
}

function dayLabel(value: number): string {
  const day = new Date(value);
  const today = new Date();
  const start = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((start(today) - start(day)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return day.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(day.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

function runView(value: unknown): RunView {
  return value === "failed" || value === "needs-review" ? value : "all";
}

function runViewDescription(view: RunView, historyComplete: boolean) {
  if (view === "failed") return "Failures and runs that could not start";
  if (view === "needs-review") return "Runs with screenshots waiting for you";
  return historyComplete ? "That is everything Relay has kept." : "Showing recent history.";
}

function emptyRunTitle(view: RunView) {
  if (view === "failed") return "Nothing failed";
  if (view === "needs-review") return "Nothing to review";
  return "No runs match";
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
  // Rows sit under a day heading, so older rows only need the time of day.
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(value);
}

function runTime(run: ProductRunSummary): number {
  return run.finishedAt ?? run.startedAt ?? run.queuedAt;
}
