import { libraryRowSurface } from "../components/library-row-styles";
/** @jsxImportSource react */
import type { ProductTestSummary } from "@relay/product/catalog";
import { Button } from "@relay/ui-react/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { FilterSelect } from "../components/filter-select";
import { LibrarySearch, LibraryToolbar } from "../components/library-toolbar";
import { EmptyState, OutcomeMark, ReadinessMark } from "../components/product-patterns";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { catalogQueryKeys } from "../data/catalog-queries";
import { homeAttentionRuns } from "../data/home-run-attention";
import { recordingQueryKeys } from "../data/recording-queries";
import { runQueryKeys } from "../data/run-queries";
import { readRunPointer } from "../data/run-pointer";
import { readWorkflowPointer } from "../data/workflow-pointer";
import { PageLoading, RecordingProblem } from "./recording-shared";
import { useCollectionReturnFocus } from "../hooks/use-collection-return-focus";

const routeApi = getRouteApi("/tests");

type TestFilter = "all" | "ready" | "needs-review";
type ResultFilter = "all" | "passed" | "failed" | "running" | "never";

export function TestsPage() {
  const { catalogService, platform, productService } = useRouteContext({
    from: "__root__",
  });
  const search = routeApi.useSearch() as {
    app?: unknown;
    status?: unknown;
    result?: unknown;
    q?: unknown;
  };
  const navigate = useNavigate({ from: "/tests" });
  const [query, setQuery] = useState(() => (typeof search.q === "string" ? search.q : ""));
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const status = testFilter(search.status);
  const result = resultFilter(search.result);
  const app = typeof search.app === "string" ? search.app : "";
  useEffect(() => {
    setQuery(typeof search.q === "string" ? search.q : "");
  }, [search.q]);
  const tests = useQuery({
    queryKey: catalogQueryKeys.tests,
    queryFn: () => catalogService.listTests(),
    staleTime: 15_000,
  });
  const runs = useQuery({
    queryKey: catalogQueryKeys.runs,
    queryFn: () => catalogService.listRuns(),
    staleTime: 15_000,
    retry: false,
  });
  const recording = useQuery({
    queryKey: recordingQueryKeys.pointer,
    queryFn: async () => (await readWorkflowPointer(platform)) ?? null,
    staleTime: Infinity,
  });
  const runPointer = useQuery({
    queryKey: runQueryKeys.pointer,
    queryFn: async () => (await readRunPointer(platform)) ?? null,
    staleTime: Infinity,
  });
  const recordingState = useQuery({
    queryKey: recordingQueryKeys.workflow(recording.data ?? "inactive"),
    queryFn: () => productService.inspect(recording.data!),
    enabled: Boolean(recording.data),
    staleTime: 15_000,
  });
  const scopedRuns = (runs.data ?? []).filter((item) => !app || item.appMapId === app);
  const recordingAppId = recordingState.data?.snapshot?.frozen?.appMapId;
  const recordingStage = recordingState.data?.snapshot?.stage;
  const recordingFinished = recordingStage === "committed" || recordingStage === "cancelled";
  const reviewing = recordingStage === "reviewing";
  const resumeLabel = reviewing ? "Review recording" : "Continue recording";
  const resumeRecordingId =
    !recording.data || recordingFinished
      ? undefined
      : !app || !recordingAppId || recordingAppId === app
        ? recording.data
        : undefined;
  const resumeRunId = scopedRuns.find(
    (item) =>
      item.id === runPointer.data?.runId && (item.phase === "running" || item.phase === "queued"),
  )?.id;
  const apps = useMemo(
    () =>
      [...new Map((tests.data ?? []).map((test) => [test.appMapId, test.appName])).entries()].sort(
        ([, left], [, right]) => left.localeCompare(right),
      ),
    [tests.data],
  );
  const visibleTests = useMemo(
    () =>
      (tests.data ?? [])
        .filter(
          (test) =>
            (status === "all" || test.status === status) &&
            matchesResult(test, result) &&
            (!app || test.appMapId === app) &&
            (!deferredQuery ||
              `${test.name} ${test.appName}`.toLocaleLowerCase().includes(deferredQuery)),
        )
        .sort(
          (left, right) =>
            right.updatedAt - left.updatedAt ||
            left.name.localeCompare(right.name) ||
            left.appName.localeCompare(right.appName),
        ),
    [app, deferredQuery, result, status, tests.data],
  );
  const visibleTestIds = new Set(visibleTests.map((test) => test.id));
  const attentionRuns = homeAttentionRuns(scopedRuns).filter(
    (item) => !item.testId || visibleTestIds.has(item.testId),
  );
  const returnFocus = useCollectionReturnFocus("relay:focus:/tests", visibleTests, "/tests/");
  const resultLabel = resultContext(status, app, apps);
  const statusOptions = [
    { value: "all", label: "All statuses" },
    { value: "ready", label: "Ready" },
    { value: "needs-review", label: "Needs setup" },
  ] as const;
  const resultOptions = [
    { value: "all", label: "All results" },
    { value: "passed", label: "Passed" },
    { value: "failed", label: "Failed" },
    { value: "running", label: "Running" },
    { value: "never", label: "Never run" },
  ] as const;
  function updateFilter(next: { app?: string; status?: TestFilter; result?: ResultFilter }) {
    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        ...(next.app === undefined ? {} : { app: next.app || undefined }),
        ...(next.status === undefined
          ? {}
          : { status: next.status === "all" ? undefined : next.status }),
        ...(next.result === undefined
          ? {}
          : { result: next.result === "all" ? undefined : next.result }),
      }),
    });
  }

  function clearFilters() {
    setQuery("");
    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        app: undefined,
        status: undefined,
        result: undefined,
        q: undefined,
      }),
    });
  }

  return (
    <LibraryPage
      className="relay-library-page relay-tests-page mx-auto flex min-h-full w-full max-w-[1040px] flex-col"
      onClickCapture={returnFocus.onClickCapture}
    >
      <PageHeader
        title="Tests"
        description="Reusable steps that check your app. Run a Test to get a result."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              nativeButton={false}
              variant="default"
              render={<Link to="/tests/new" search={app ? { app } : {}} />}
            >
              New Test
            </Button>
          </div>
        }
      />

      {resumeRecordingId || resumeRunId ? (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
          aria-label="Resume work"
        >
          <div className="min-w-0">
            <strong id="tests-resume-title" className="block text-sm font-semibold">
              {resumeRecordingId
                ? reviewing
                  ? "Your recording is ready to review"
                  : "Continue your test"
                : "A Run is in progress"}
            </strong>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {resumeRecordingId
                ? reviewing
                  ? "Review the captured steps, then save your test."
                  : "Your captured steps are saved."
                : "See how the current Run is going."}
            </p>
          </div>
          {resumeRecordingId ? (
            <Link
              className="text-sm font-semibold text-[var(--text-interactive-base)]"
              to="/recordings/$recordingId"
              params={{ recordingId: resumeRecordingId }}
            >
              {resumeLabel}
            </Link>
          ) : resumeRunId ? (
            <Link
              className="text-sm font-semibold text-[var(--text-interactive-base)]"
              to="/runs/$runId"
              params={{ runId: resumeRunId }}
            >
              Open Run
            </Link>
          ) : null}
        </div>
      ) : null}

      <LibraryToolbar
        label="Filter Tests"
        search={
          <LibrarySearch
            id="test-search"
            label="Search Tests"
            value={query}
            placeholder="Search by Test or app"
            onChange={(next) => {
              setQuery(next);
              void navigate({
                replace: true,
                search: (previous) => ({ ...previous, q: next || undefined }),
              });
            }}
          />
        }
        filters={
          <>
            <FilterSelect
              compact
              label="Readiness"
              value={status}
              options={statusOptions}
              onValueChange={(value) => updateFilter({ status: testFilter(value) })}
            />
            <FilterSelect
              compact
              label="Last result"
              value={result}
              options={resultOptions}
              onValueChange={(value) => updateFilter({ result: resultFilter(value) })}
            />
          </>
        }
      />

      {tests.isPending ? <PageLoading label="Loading saved Tests…" /> : null}
      <RecordingProblem
        error={tests.error}
        onRetry={() => void tests.refetch()}
        retrying={tests.isFetching}
        layout="centered"
      />

      {!tests.isPending && !tests.isError && visibleTests.length ? (
        <section className="relay-library-results mt-3" aria-labelledby="saved-tests-title">
          <div className="relay-library-results-heading flex min-h-8 items-center justify-between gap-5 px-0.5 pb-2.5">
            <h2 id="saved-tests-title" className="text-body font-semibold tabular-nums">
              {visibleTests.length === 1 ? "1 Test" : `${visibleTests.length} Tests`}
            </h2>
            {attentionRuns.length ? (
              <Link
                to="/runs"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                aria-label="Results that need attention"
              >
                {attentionRuns.length}{" "}
                {attentionRuns.length === 1 ? "result needs" : "results need"} attention →
              </Link>
            ) : resultLabel ? (
              <span className="text-xs text-[var(--text-weak)]" aria-live="polite">
                {resultLabel}
              </span>
            ) : null}
          </div>
          <ul className="relay-library-list m-0 list-none overflow-hidden rounded-xl border border-border/60 p-0 [&>li]:border-b [&>li]:border-border/60 [&>li:last-child]:border-b-0">
            {visibleTests.map((test) => (
              <TestRow key={`${test.appMapId}:${test.id}`} test={test} />
            ))}
          </ul>
        </section>
      ) : null}

      {!tests.isPending && !tests.isError && !visibleTests.length ? (
        tests.data?.length ? (
          <EmptyState
            title="No Tests match these filters"
            detail="Try another name, app, or status. Your saved Tests have not changed."
            action={
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              title="Create your first test"
              detail="Open your app and record the steps you want to repeat."
              action={
                <Link
                  className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
                  to="/tests/new"
                >
                  New test
                </Link>
              }
            />
          </div>
        )
      ) : null}
    </LibraryPage>
  );
}

function TestRow({ test }: { test: ProductTestSummary }) {
  const recent = test.recentRun;
  return (
    <li>
      <div
        className={`group/test-row relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pr-3 ${libraryRowSurface}`}
      >
        <Link
          to="/tests/$testId"
          params={{ testId: test.id }}
          className="grid min-w-0 gap-2 px-4 py-3.5 focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-6"
        >
          <span className="relay-library-row-main grid min-w-0 gap-1">
            <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-[var(--text-strong)]">
              {test.name}
            </strong>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--text-weak)]">
              {test.appName} · {test.stepCount === 1 ? "1 step" : `${test.stepCount} steps`}
            </span>
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {test.status !== "ready" ? (
              <ReadinessMark status={test.status} name={test.name} />
            ) : null}
            {recent ? (
              <span className="inline-flex items-center gap-2">
                <OutcomeMark outcome={recent.outcome ?? recent.phase} />
                <span className="tabular-nums">{relativeTime(runTime(recent))}</span>
              </span>
            ) : (
              <span className="relay-library-never-run">Not run yet</span>
            )}
          </span>
        </Link>
        <Button
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="relay-library-row-run min-h-10 justify-self-end rounded-md border border-transparent px-3 text-xs font-medium text-muted-foreground transition-[color,background-color,border-color] duration-150 group-hover/test-row:border-border group-hover/test-row:text-foreground hover:bg-background focus-visible:border-border motion-reduce:transition-none"
          render={
            test.status === "needs-review" ? (
              <Link to="/tests/$testId/edit" params={{ testId: test.id }} />
            ) : (
              <Link to="/tests/$testId" params={{ testId: test.id }} search={{ setup: "run" }} />
            )
          }
        >
          {test.status === "needs-review" ? "Review steps" : "Run options"}
        </Button>
      </div>
    </li>
  );
}

function testFilter(value: unknown): TestFilter {
  return value === "ready" || value === "needs-review" ? value : "all";
}

function resultFilter(value: unknown): ResultFilter {
  return value === "passed" || value === "failed" || value === "running" || value === "never"
    ? value
    : "all";
}

function matchesResult(test: ProductTestSummary, result: ResultFilter): boolean {
  if (result === "all") return true;
  if (!test.recentRun) return result === "never";
  if (result === "running")
    return test.recentRun.phase === "queued" || test.recentRun.phase === "running";
  if (result === "passed") return test.recentRun.outcome === "passed";
  if (result === "failed")
    return test.recentRun.phase === "failed" || test.recentRun.outcome === "product-failure";
  return false;
}

function resultContext(status: TestFilter, app: string, apps: readonly [string, string][]) {
  if (app) return apps.find(([id]) => id === app)?.[1] ?? "Selected app";
  if (status === "ready") return "Ready to run";
  if (status === "needs-review") return "Needs setup";
  return undefined;
}

function runTime(run: NonNullable<ProductTestSummary["recentRun"]>): number {
  return run.finishedAt ?? run.startedAt ?? run.queuedAt;
}

function relativeTime(value: number): string {
  const elapsed = Math.max(0, Date.now() - value);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value);
}
