/** @jsxImportSource react */
import type { ProductTestSummary } from "@relay/product/catalog";
import { Badge } from "@relay/ui-react/components/badge";
import { Item } from "@relay/ui-react/components/item";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Label } from "@relay/ui-react/components/label";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useDeferredValue, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { FilterSelect } from "../components/filter-select";
import { EmptyState, OutcomeMark } from "../components/product-patterns";
import { TestRunDialog } from "../components/test-run-dialog";
import { catalogQueryKeys } from "../data/catalog-queries";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/tests");
const allAppsValue = "all-apps";

type TestFilter = "all" | "ready" | "needs-review";
type ResultFilter = "all" | "passed" | "failed" | "running" | "never";

export function TestsPage() {
  const { catalogService } = useRouteContext({ from: "__root__" });
  const search = routeApi.useSearch() as { app?: unknown; status?: unknown; result?: unknown };
  const navigate = useNavigate({ from: "/tests" });
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const status = testFilter(search.status);
  const result = resultFilter(search.result);
  const app = typeof search.app === "string" ? search.app : "";
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
      search: (previous) => ({ ...previous, app: undefined, status: undefined, result: undefined }),
    });
  }

  return (
    <section className="relay-page relay-library-page relay-tests-page">
      <header className="relay-library-header">
        <div>
          <p className="relay-eyebrow">Tests</p>
          <h1>Saved Tests</h1>
          <p className="relay-page-description">
            Reviewed journeys you can run again on a device or browser.
          </p>
        </div>
        <Button nativeButton={false} variant="default" render={<Link to="/tests/new" />}>
          New Test
        </Button>
      </header>

      <div
        className="mt-8 grid gap-3 md:grid-cols-[minmax(16rem,1fr)_10rem_10rem_11rem] md:items-end"
        aria-label="Filter Tests"
      >
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="test-search" className="text-xs font-medium text-foreground">
            Search Tests
          </Label>
          <div data-slot="library-search-control" className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="pl-8"
              id="test-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search by Test or app"
              autoComplete="off"
              spellCheck="false"
            />
          </div>
        </div>
        <FilterSelect
          label="Readiness"
          value={status}
          options={statusOptions}
          onValueChange={(value) => updateFilter({ status: testFilter(value) })}
        />
        <FilterSelect
          label="Last result"
          value={result}
          options={resultOptions}
          onValueChange={(value) => updateFilter({ result: resultFilter(value) })}
        />
        <FilterSelect
          label="App"
          value={app || allAppsValue}
          options={appOptions}
          onValueChange={(value) => updateFilter({ app: value === allAppsValue ? "" : value })}
        />
      </div>

      {tests.isPending ? <PageLoading label="Loading saved Tests…" /> : null}
      <RecordingProblem
        error={tests.error}
        onRetry={() => void tests.refetch()}
        retrying={tests.isFetching}
        layout="centered"
      />

      {!tests.isPending && !tests.isError && visibleTests.length ? (
        <section className="relay-library-results" aria-labelledby="saved-tests-title">
          <div className="relay-library-results-heading">
            <h2 id="saved-tests-title">
              {visibleTests.length === 1 ? "1 Test" : `${visibleTests.length} Tests`}
            </h2>
            {resultLabel ? <span aria-live="polite">{resultLabel}</span> : null}
          </div>
          <ul className="relay-library-list">
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
          <EmptyState
            title="No saved Tests yet"
            detail="Record one focused journey, review it, and Relay will keep it here for future Runs."
            action={
              <Link className="relay-inline-link" to="/tests/new">
                Record your first Test
              </Link>
            }
          />
        )
      ) : null}
    </section>
  );
}

function TestRow({ test }: { test: ProductTestSummary }) {
  const recent = test.recentRun;
  return (
    <li>
      <div className="relay-library-row-shell">
        <Item
          className="relay-library-row"
          render={<Link to="/tests/$testId" params={{ testId: test.id }} />}
        >
          <span className="relay-library-row-main">
            <strong>{test.name}</strong>
            <span>
              {test.appName} · {test.stepCount === 1 ? "1 step" : `${test.stepCount} steps`}
            </span>
          </span>
          <span className="relay-library-row-status">
            {test.status === "needs-review" ? (
              <Badge
                variant="secondary"
                className="bg-amber-500/15 text-amber-700 dark:text-amber-300"
              >
                Needs review
              </Badge>
            ) : (
              <Badge
                variant="secondary"
                className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              >
                Ready
              </Badge>
            )}
          </span>
          <span className="relay-library-row-recent">
            {recent ? (
              <>
                <OutcomeMark outcome={recent.outcome ?? recent.phase} />
                <small>{relativeTime(runTime(recent))}</small>
              </>
            ) : (
              <>
                <span className="relay-library-never-run">Not run yet</span>
                <small>
                  {test.status === "needs-review"
                    ? "Review steps before the first Run"
                    : "Ready for its first Run"}
                </small>
              </>
            )}
          </span>
          <ChevronRight className="relay-library-row-arrow" aria-hidden="true" />
        </Item>
        {test.status === "needs-review" ? (
          <Link
            className="relay-library-row-run"
            to="/tests/$testId/edit"
            params={{ testId: test.id }}
          >
            Review steps
          </Link>
        ) : (
          <TestRunDialog test={test} />
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
