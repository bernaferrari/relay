/** @jsxImportSource react */
import type { ProductTestSummary } from "@relay/product/catalog";
import { Item } from "@relay/ui-react/components/item";
import { Button } from "@relay/ui-react/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { FilterSelect } from "../components/filter-select";
import { LibrarySearch, LibraryToolbar } from "../components/library-toolbar";
import { EmptyState, OutcomeMark, ReadinessMark } from "../components/product-patterns";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { catalogQueryKeys } from "../data/catalog-queries";
import { PageLoading, RecordingProblem } from "./recording-shared";
import { useCollectionReturnFocus } from "../hooks/use-collection-return-focus";

const routeApi = getRouteApi("/tests");
const allAppsValue = "all-apps";

type TestFilter = "all" | "ready" | "needs-review";
type ResultFilter = "all" | "passed" | "failed" | "running" | "never";

export function TestsPage() {
  const { catalogService } = useRouteContext({
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
  const returnFocus = useCollectionReturnFocus("relay:focus:/tests", visibleTests, "/tests/");
  const resultLabel = resultContext(status, app, apps);
  const statusOptions = [
    { value: "all", label: "All statuses" },
    { value: "ready", label: "Ready" },
    { value: "needs-review", label: "Needs review" },
  ] as const;
  const resultOptions = [
    { value: "all", label: "All results" },
    { value: "passed", label: "Passed" },
    { value: "failed", label: "Failed" },
    { value: "running", label: "Running" },
    { value: "never", label: "Never run" },
  ] as const;
  const appOptions = [
    { value: allAppsValue, label: "All apps" },
    ...apps.map(([id, label]) => ({ value: id, label })),
  ];
  function updateFilter(next: { app?: string; status?: TestFilter; result?: ResultFilter }) {
    void navigate({
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
        context="Tests"
        title="Tests"
        description="Run a saved Test, or record a new one."
        actions={
          <Button
            nativeButton={false}
            variant="default"
            render={<Link to="/tests/new" search={app ? { app } : {}} />}
          >
            New Test
          </Button>
        }
      />

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
              void navigate({ search: (previous) => ({ ...previous, q: next || undefined }) });
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
            <FilterSelect
              compact
              label="App"
              value={app || allAppsValue}
              options={appOptions}
              onValueChange={(value) => updateFilter({ app: value === allAppsValue ? "" : value })}
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
            <h2 id="saved-tests-title" className="text-[13px] font-semibold">
              {visibleTests.length === 1 ? "1 Test" : `${visibleTests.length} Tests`}
            </h2>
            {resultLabel ? (
              <span className="text-xs text-[var(--text-weak)]" aria-live="polite">
                {resultLabel}
              </span>
            ) : null}
          </div>
          <ul className="relay-library-list m-0 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-weak-base)] bg-[var(--surface-raised-strong)] p-0 [&>li]:border-b [&>li]:border-[var(--border-weak-base)] [&>li:last-child]:border-b-0">
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
              title="No saved Tests yet"
              detail="Record a Test to run it again later."
              action={
                <Link
                  className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
                  to="/tests/new"
                >
                  Record your first Test
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
      <div className="relay-library-row-shell relative grid grid-cols-[minmax(0,1fr)_auto] items-center pr-3">
        <Item
          className="relay-library-row grid min-h-[78px] min-w-0 grid-cols-[minmax(180px,1fr)_minmax(94px,auto)_minmax(150px,.48fr)_18px] items-center gap-[18px] px-3.5 py-2 text-[var(--text-base)] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 max-[720px]:grid-cols-[minmax(0,1fr)_auto]"
          render={<Link to="/tests/$testId" params={{ testId: test.id }} />}
        >
          <span className="relay-library-row-main grid min-w-0 gap-1">
            <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-[var(--text-strong)]">
              {test.name}
            </strong>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--text-weak)]">
              {test.appName} · {test.stepCount === 1 ? "1 step" : `${test.stepCount} steps`}
            </span>
          </span>
          <span className="relay-library-row-status flex justify-start">
            <ReadinessMark status={test.status} />
          </span>
          <span className="relay-library-row-recent grid min-w-0 justify-items-start gap-1">
            {recent ? (
              <>
                <OutcomeMark outcome={recent.outcome ?? recent.phase} />
                <small>{relativeTime(runTime(recent))}</small>
              </>
            ) : (
              <>
                <span className="relay-library-never-run text-xs font-semibold text-[var(--text-base)]">
                  Not run yet
                </span>
                <small className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--text-weak)]">
                  {test.status === "needs-review"
                    ? "Review steps before the first Run"
                    : "Ready for its first Run"}
                </small>
              </>
            )}
          </span>
          <ChevronRight
            className="relay-library-row-arrow text-sm text-[var(--text-weaker)]"
            aria-hidden="true"
          />
        </Item>
        {test.status === "needs-review" ? (
          <Link
            className="relay-library-row-run inline-flex min-h-10 items-center rounded-[var(--radius-md)] px-2.5 text-xs font-semibold text-[var(--text-interactive-base)] hover:bg-[var(--surface-raised-base)]"
            to="/tests/$testId/edit"
            params={{ testId: test.id }}
          >
            Review steps
          </Link>
        ) : (
          <Link
            className="relay-library-row-run inline-flex min-h-10 items-center rounded-[var(--radius-md)] px-2.5 text-xs font-semibold text-[var(--text-interactive-base)] hover:bg-[var(--surface-raised-base)]"
            to="/tests/$testId"
            params={{ testId: test.id }}
            hash="test-run-setup"
          >
            Run
          </Link>
        )}
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
  if (status === "needs-review") return "Needs review";
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
