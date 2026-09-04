/** @jsxImportSource react */
import type { ProductRunSummary } from "@relay/product/catalog";
import { Item } from "@relay/ui-react/components/item";
import { Tabs, TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Label } from "@relay/ui-react/components/label";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { FilterSelect } from "../components/filter-select";
import { EmptyState, OutcomeMark } from "../components/product-patterns";
import { RunHistoryList, type RunHistoryRowInteraction } from "../components/run-history-list";
import { catalogQueryKeys } from "../data/catalog-queries";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/runs");
const allAppsValue = "all-apps";

type RunView = "latest" | "all" | "failed" | "needs-review" | "active";

const runViews: readonly { id: RunView; label: string }[] = [
  { id: "latest", label: "Latest per Test" },
  { id: "all", label: "All Runs" },
  { id: "failed", label: "Failed" },
  { id: "needs-review", label: "Needs review" },
  { id: "active", label: "Active" },
];

export function RunsPage() {
  const { catalogService } = useRouteContext({ from: "__root__" });
  const search = routeApi.useSearch() as { app?: unknown; test?: unknown; view?: unknown };
  const navigate = useNavigate({ from: "/runs" });
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const view = runView(search.view);
  const app = typeof search.app === "string" ? search.app : "";
  const testId = typeof search.test === "string" ? search.test : "";
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
  const apps = useMemo(
    () =>
      [
        ...new Map(
          (runs.data ?? []).flatMap((run) =>
            run.appMapId && run.appName ? [[run.appMapId, run.appName] as const] : [],
          ),
        ).entries(),
      ].sort(([, left], [, right]) => left.localeCompare(right)),
    [runs.data],
  );
  const appOptions = [
    { value: allAppsValue, label: "All apps" },
    ...apps.map(([id, label]) => ({ value: id, label })),
  ];
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
    if (view === "latest") return latestRuns(searched);
    if (view === "failed") return searched.filter((run) => run.phase === "failed");
    if (view === "needs-review") {
      return searched.filter(
        (run) => run.review?.status === "pending" || run.outcome === "uncertain",
      );
    }
    if (view === "active") {
      return searched.filter((run) => run.phase === "queued" || run.phase === "running");
    }
    return searched;
  }, [app, deferredQuery, runs.data, view]);
  function setView(next: RunView) {
    void navigate({
      search: (previous) => ({ ...previous, view: next === "latest" ? undefined : next }),
    });
  }

  function clearFilters() {
    setQuery("");
    void navigate({
      search: (previous) => ({ ...previous, app: undefined, test: undefined, view: undefined }),
    });
  }

  return (
    <section className="relay-page relay-library-page relay-runs-page">
      <header className="relay-library-header">
        <div>
          <p className="relay-eyebrow">Runs</p>
          <h1>Run history</h1>
          <p className="relay-page-description">
            Current work and durable Reports from every saved Test.
          </p>
        </div>
      </header>

      <Tabs value={view} onValueChange={(next) => setView(next as RunView)}>
        <TabsList variant="line" aria-label="Run view">
          {runViews.map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div
        className="mt-3 grid gap-3 md:grid-cols-[minmax(16rem,1fr)_10rem] md:items-end"
        aria-label="Filter Runs"
      >
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="run-search" className="text-xs font-medium text-foreground">
            Search Runs
          </Label>
          <Input
            id="run-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search by Test, app, or device"
            autoComplete="off"
            spellCheck="false"
          />
        </div>
        <FilterSelect
          label="App"
          value={app || allAppsValue}
          options={appOptions}
          onValueChange={(nextApp) => {
            void navigate({
              search: (previous) => ({
                ...previous,
                app: nextApp === allAppsValue ? undefined : nextApp,
              }),
            });
          }}
        />
      </div>

      {runs.isPending ? <PageLoading label="Loading Runs…" /> : null}
      <RecordingProblem
        error={runs.error}
        onRetry={() => void runs.refetch()}
        retrying={runs.isFetching}
        layout="centered"
      />

      {!runs.isPending && !runs.isError && visibleRuns.length ? (
        <section
          id="run-history-results"
          className="relay-library-results"
          aria-labelledby="run-history-title"
        >
          <div className="relay-library-results-heading">
            <h2 id="run-history-title">
              {visibleRuns.length === 1 ? "1 Run" : `${visibleRuns.length} Runs`}
            </h2>
            <span aria-live="polite">{runViewDescription(view, historyComplete)}</span>
          </div>
          <RunHistoryList runs={visibleRuns}>
            {(run, _index, interaction) => <RunRow run={run} interaction={interaction} />}
          </RunHistoryList>
        </section>
      ) : null}

      {!runs.isPending && !runs.isError && !visibleRuns.length ? (
        runs.data?.length ? (
          <EmptyState
            title={emptyRunTitle(view)}
            detail="Choose another view, app, or search. Existing Reports remain unchanged."
            action={
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Show latest Runs
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No Runs yet"
            detail="Open a saved Test and run it on a device or browser. Its Report will appear here."
            action={
              <Link className="relay-inline-link" to="/tests">
                Browse saved Tests
              </Link>
            }
          />
        )
      ) : null}
    </section>
  );
}

function RunRow({
  run,
  interaction,
}: {
  run: ProductRunSummary;
  interaction?: RunHistoryRowInteraction;
}) {
  const title = run.testName ?? run.title;
  const context = [run.appName, run.targetName ?? platformName(run.platform)].filter(Boolean);
  return (
    <Item
      className="relay-library-row relay-run-row"
      render={<Link to="/runs/$runId" params={{ runId: run.id }} />}
      {...interaction}
    >
      <span className="relay-library-row-main">
        <strong>{title}</strong>
        <span className="relay-run-row-context">
          <OutcomeMark outcome={run.outcome ?? phaseOutcome(run)} />
          <span>{context.length ? context.join(" · ") : "Saved Run"}</span>
        </span>
      </span>
      <span className="relay-library-row-recent">
        <strong>
          {run.durationMs === undefined ? phaseDetail(run) : formatDuration(run.durationMs)}
        </strong>
        <small>{relativeTime(run.finishedAt ?? run.startedAt ?? run.queuedAt)}</small>
      </span>
      <ChevronRight className="relay-library-row-arrow" aria-hidden="true" />
    </Item>
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
  return value === "all" || value === "failed" || value === "needs-review" || value === "active"
    ? value
    : "latest";
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

function phaseOutcome(run: ProductRunSummary): string {
  if (run.review?.status === "pending") return "needs-review";
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
