/** @jsxImportSource react */
import type { ProductTestSummary } from "@relay/product/catalog";
import { Input } from "@relay/ui-react";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { FilterSelect } from "../components/filter-select";
import { EmptyState, OutcomeMark } from "../components/product-patterns";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/tests");
const testsQueryKey = ["catalog", "tests"] as const;
const allAppsValue = "all-apps";

type TestFilter = "all" | "ready" | "needs-review";

export function TestsPage() {
  const { catalogService } = useRouteContext({ from: "__root__" });
  const search = routeApi.useSearch() as { app?: unknown; status?: unknown };
  const navigate = useNavigate({ from: "/tests" });
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const status = testFilter(search.status);
  const app = typeof search.app === "string" ? search.app : "";
  const tests = useQuery({
    queryKey: testsQueryKey,
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
    [app, deferredQuery, status, tests.data],
  );
  const resultLabel = resultContext(status, app, apps);
  const statusOptions = [
    { value: "all", label: "All statuses" },
    { value: "ready", label: "Ready" },
    { value: "needs-review", label: "Needs review" },
  ] as const;
  const appOptions = [
    { value: allAppsValue, label: "All apps" },
    ...apps.map(([id, label]) => ({ value: id, label })),
  ];
  function updateFilter(next: { app?: string; status?: TestFilter }) {
    void navigate({
      search: (previous) => ({
        ...previous,
        ...(next.app === undefined ? {} : { app: next.app || undefined }),
        ...(next.status === undefined
          ? {}
          : { status: next.status === "all" ? undefined : next.status }),
      }),
    });
  }

  function clearFilters() {
    setQuery("");
    void navigate({ search: (previous) => ({ ...previous, app: undefined, status: undefined }) });
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
        <Link className="relay-button relay-button--primary relay-button--medium" to="/tests/new">
          New Test
        </Link>
      </header>

      <div className="relay-library-toolbar" aria-label="Filter Tests">
        <div className="relay-library-search">
          <label htmlFor="test-search">Search Tests</label>
          <div className="relay-library-search-control">
            <Search aria-hidden="true" />
            <Input
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
          label="Status"
          value={status}
          options={statusOptions}
          onValueChange={(value) => updateFilter({ status: testFilter(value) })}
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
              <button className="relay-inline-button" type="button" onClick={clearFilters}>
                Clear filters
              </button>
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
      <Link className="relay-library-row" to="/tests/$testId" params={{ testId: test.id }}>
        <span className="relay-library-row-main">
          <strong>{test.name}</strong>
          <span>
            {test.appName} · {test.stepCount === 1 ? "1 step" : `${test.stepCount} steps`}
          </span>
        </span>
        <span className="relay-library-row-status">
          {test.status === "needs-review" ? (
            <span className="relay-status-pill relay-status-pill--attention">Needs review</span>
          ) : null}
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
              <small>Ready for its first Run</small>
            </>
          )}
        </span>
        <span className="relay-library-row-arrow" aria-hidden="true">
          →
        </span>
      </Link>
    </li>
  );
}

function testFilter(value: unknown): TestFilter {
  return value === "ready" || value === "needs-review" ? value : "all";
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
