/** @jsxImportSource react */
import type { ProductTestSummary } from "@relay/product/catalog";
import { Badge } from "@relay/ui-react/components/badge";
import { Item } from "@relay/ui-react/components/item";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Label } from "@relay/ui-react/components/label";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@relay/ui-react/components/dialog";
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { FilterSelect } from "../components/filter-select";
import { EmptyState, OutcomeMark } from "../components/product-patterns";
import { TestRunDialog } from "../components/test-run-dialog";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { catalogQueryKeys } from "../data/catalog-queries";
import { PageLoading, RecordingProblem } from "./recording-shared";
import type { ProductSuiteEditor } from "../data/suite-profile-product-service";
import { useCollectionReturnFocus } from "../hooks/use-collection-return-focus";

const routeApi = getRouteApi("/tests");
const allAppsValue = "all-apps";

type TestFilter = "all" | "ready" | "needs-review";
type ResultFilter = "all" | "passed" | "failed" | "running" | "never";

export function TestsPage() {
  const { catalogService, suiteProfileService, queryClient } = useRouteContext({
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [suiteDialogOpen, setSuiteDialogOpen] = useState(false);
  const [suiteName, setSuiteName] = useState("");
  const [suiteAppId, setSuiteAppId] = useState("");
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
  const suiteEditor = useQuery<ProductSuiteEditor>({
    queryKey: ["suites", "editor", suiteAppId],
    queryFn: () => suiteProfileService.getSuiteEditor(suiteAppId),
    enabled: suiteDialogOpen && Boolean(suiteAppId),
    staleTime: 15_000,
  });
  const selectedTests = (tests.data ?? []).filter((test) =>
    selectedIds.has(testSelectionKey(test)),
  );
  const selectedApps = [...new Map(selectedTests.map((test) => [test.appMapId, test.appName]))];
  const createSuite = useMutation({
    mutationFn: async () => {
      if (!suiteEditor.data || !suiteName.trim() || !suiteAppId) {
        throw new TypeError("Choose one App, name the Suite, and select a ready Test.");
      }
      const testIds = selectedTests
        .filter((test) => test.appMapId === suiteAppId && test.status === "ready")
        .map((test) => test.id);
      if (!testIds.length) throw new TypeError("Select at least one ready Test from this App.");
      return suiteProfileService.saveSuite({
        appMapId: suiteAppId,
        suiteId: suiteIdFor(suiteName),
        expectedRevision: suiteEditor.data.revision,
        name: suiteName.trim(),
        testIds,
        variableIds: [],
        strategy: "cartesian",
      });
    },
    onSuccess: async (suite) => {
      await queryClient.invalidateQueries({ queryKey: ["suites"] });
      setSuiteDialogOpen(false);
      await navigate({
        to: "/apps/$appId/suites/$suiteId",
        params: { appId: suite.appMapId, suiteId: suite.id },
      });
    },
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
  const readyVisibleIds = visibleReadyIdsFor(visibleTests);
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

  function toggleSelected(test: ProductTestSummary, checked: boolean) {
    const selectionKey = testSelectionKey(test);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(selectionKey);
      else next.delete(selectionKey);
      return next;
    });
  }

  function selectAllReady() {
    setSelectedIds((current) => new Set([...current, ...readyVisibleIds]));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function openSuiteDialog() {
    setSuiteName("");
    setSuiteAppId(selectedApps.length === 1 ? selectedApps[0]![0] : "");
    createSuite.reset();
    setSuiteDialogOpen(true);
  }

  return (
    <LibraryPage
      className="relay-library-page relay-tests-page"
      onClickCapture={returnFocus.onClickCapture}
    >
      <PageHeader
        context="Tests"
        title="Saved Tests"
        description="Reviewed journeys you can run again on a device or browser."
        actions={
          <Button nativeButton={false} variant="default" render={<Link to="/tests/new" />}>
            New Test
          </Button>
        }
      />

      <div
        className="relay-test-selection-toolbar mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px] text-[var(--text-weak)]"
        aria-label="Test selection actions"
      >
        <span>
          {selectedIds.size
            ? `${selectedIds.size} selected`
            : "Select ready Tests to build a Suite"}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={selectAllReady}
            disabled={!readyVisibleIds.length}
          >
            Select all ready
          </Button>
          {selectedIds.size ? (
            <>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Clear selection
              </Button>
              <Button variant="outline" size="sm" onClick={openSuiteDialog}>
                Create Suite
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <Dialog
        open={suiteDialogOpen}
        onOpenChange={(open) => {
          if (!open && createSuite.isPending) return;
          setSuiteDialogOpen(open);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-h-[min(760px,calc(100vh-32px))] w-[min(720px,calc(100vw-32px))] overflow-auto"
        >
          <DialogTitle>Create Suite from selected Tests</DialogTitle>
          <DialogDescription>
            A Suite belongs to one App and runs its selected Tests together. This only creates the
            Suite; it does not start a Run.
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              createSuite.mutate();
            }}
          >
            <Field>
              <FieldLabel htmlFor="selected-suite-app">App scope</FieldLabel>
              <select
                id="selected-suite-app"
                className="relay-native-select"
                value={suiteAppId}
                disabled={createSuite.isPending}
                onChange={(event) => setSuiteAppId(event.currentTarget.value)}
              >
                <option value="">Choose one App</option>
                {selectedApps.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              {selectedApps.length > 1 ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  Your selection spans Apps. Choose the App whose Tests should be included.
                </p>
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="selected-suite-name">Suite name</FieldLabel>
              <Input
                id="selected-suite-name"
                value={suiteName}
                disabled={createSuite.isPending}
                onChange={(event) => setSuiteName(event.currentTarget.value)}
                placeholder="For example, Release smoke"
                autoFocus
              />
            </Field>
            {suiteEditor.isPending && suiteAppId ? (
              <PageLoading label="Loading App Tests…" />
            ) : null}
            {suiteEditor.error ? (
              <FieldError>
                Relay could not load this App’s Suite editor.{" "}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void suiteEditor.refetch()}
                  disabled={suiteEditor.isFetching}
                >
                  {suiteEditor.isFetching ? "Retrying…" : "Try again"}
                </Button>
              </FieldError>
            ) : null}
            {createSuite.error ? (
              <FieldError>
                {createSuite.error instanceof Error
                  ? createSuite.error.message
                  : "Relay could not save this Suite."}
              </FieldError>
            ) : null}
            <div className="relay-dialog-actions">
              <DialogClose
                render={
                  <Button variant="ghost" disabled={createSuite.isPending}>
                    Cancel
                  </Button>
                }
              />
              <Button
                type="submit"
                disabled={
                  !suiteAppId || !suiteName.trim() || !suiteEditor.data || createSuite.isPending
                }
              >
                {createSuite.isPending ? "Saving…" : "Save Suite"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <div
        className="mt-6 grid gap-3 md:grid-cols-2 md:items-end min-[1100px]:grid-cols-[minmax(12rem,1fr)_9rem_9rem_10rem]"
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
              onChange={(event) => {
                const next = event.currentTarget.value;
                setQuery(next);
                void navigate({ search: (previous) => ({ ...previous, q: next || undefined }) });
              }}
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
              <TestRow
                key={`${test.appMapId}:${test.id}`}
                test={test}
                selected={selectedIds.has(testSelectionKey(test))}
                onSelectedChange={(checked) => toggleSelected(test, checked)}
              />
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
    </LibraryPage>
  );
}

function TestRow({
  test,
  selected,
  onSelectedChange,
}: {
  test: ProductTestSummary;
  selected: boolean;
  onSelectedChange(checked: boolean): void;
}) {
  const recent = test.recentRun;
  return (
    <li>
      <div className="relay-library-row-shell relative grid grid-cols-[44px_minmax(0,1fr)_auto] items-center pr-3">
        <label className="relay-library-row-select grid min-h-11 w-11 shrink-0 cursor-pointer place-items-center">
          <Checkbox
            checked={selected}
            disabled={test.status !== "ready"}
            aria-label={`Select ${test.name} for a Suite`}
            onCheckedChange={(checked) => onSelectedChange(checked === true)}
          />
        </label>
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
            className="relay-library-row-run inline-flex min-h-10 items-center rounded-[var(--radius-md)] px-2.5 text-xs font-semibold text-[var(--text-interactive-base)] hover:bg-[var(--surface-raised-base)]"
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

function visibleReadyIdsFor(tests: readonly ProductTestSummary[]): string[] {
  return tests.filter((test) => test.status === "ready").map(testSelectionKey);
}

function testSelectionKey(test: Pick<ProductTestSummary, "appMapId" | "id">): string {
  return `${test.appMapId}:${test.id}`;
}

function suiteIdFor(name: string): string {
  const stem = name
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 32);
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Date.now().toString(36);
  return `suite-${stem || "coverage"}-${suffix}`;
}

function relativeTime(value: number): string {
  const elapsed = Math.max(0, Date.now() - value);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value);
}
