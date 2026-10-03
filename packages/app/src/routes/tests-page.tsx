/** @jsxImportSource react */
import { type CSSProperties, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import type { ProductTestSummary } from "@relay/product/catalog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@relay/ui-react/components/tabs";
import { TestLibraryList as TestList } from "./test-library-list";
import { isTestDraft, runTime, relativeTime } from "./test-library-presentation";
import { Button } from "@relay/ui-react/components/button";
import { ChevronRight, CircleDot, CircleX, Clock, Eye, Play, Plus, Search, X } from "lucide-react";
import { Input } from "@relay/ui-react/components/input";
import { EmptyState } from "../components/product-patterns";
import { LibraryPage } from "../components/page-layout";
import { runStateDot, runStateLabel, runStateOf, type RunState } from "../components/run-status";
import { libraryRowSurface } from "../components/library-row-styles";
import { catalogQueryKeys } from "../data/catalog-queries";
import { createReviewProductService, reviewQueryKeys } from "../data/review-product-service";
import { recordingQueryKeys } from "../data/recording-queries";
import { runQueryKeys } from "../data/run-queries";
import { readRunPointer } from "../data/run-pointer";
import { readWorkflowPointer } from "../data/workflow-pointer";
import type { ProductPlanSchedule, ProductSuite } from "../data/suite-profile-product-service";
import { PageLoading, RecordingProblem } from "./recording-shared";
import { NewPlanDialog } from "./new-plan-dialog";
import { useCollectionReturnFocus } from "../hooks/use-collection-return-focus";

const routeApi = getRouteApi("/tests");

type LibraryView = "tests" | "plans" | "drafts";

type ResultFilter = "all" | "passed" | "failed" | "running" | "never";

/**
 * Saved Tests are visible first, including Tests that belong to a plan.
 * Plans and unfinished drafts have their own URL-backed views.
 */
export function TestsPage() {
  const { catalogService, platform, productService, suiteProfileService } = useRouteContext({
    from: "__root__",
  });
  const search = routeApi.useSearch() as {
    app?: unknown;
    result?: unknown;
    q?: unknown;
    view?: unknown;
    plan?: unknown;
  };
  const navigate = useNavigate({ from: "/tests" });
  const [query, setQuery] = useState(() => (typeof search.q === "string" ? search.q : ""));
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const result = resultFilter(search.result);
  const view: LibraryView =
    search.view === "drafts"
      ? "drafts"
      : search.view === "plans" || search.plan
        ? "plans"
        : "tests";
  const app = typeof search.app === "string" ? search.app : "";
  useEffect(() => {
    setQuery(typeof search.q === "string" ? search.q : "");
  }, [search.q]);

  const tests = useQuery({
    queryKey: catalogQueryKeys.tests,
    queryFn: () => catalogService.listTests(),
    staleTime: 15_000,
  });
  const suites = useQuery({
    queryKey: ["suites", "all"],
    queryFn: () => suiteProfileService.listSuites(undefined),
    staleTime: 15_000,
  });
  const schedules = useQueries({
    queries: (suites.data ?? []).map((suite) => ({
      queryKey: ["suites", suite.appMapId, suite.id, "schedules"],
      queryFn: () => suiteProfileService.listPlanSchedules?.({ combineId: suite.id }) ?? [],
      staleTime: 60_000,
      enabled: typeof suiteProfileService.listPlanSchedules === "function",
    })),
  });
  const review = useMemo(() => createReviewProductService(platform), [platform]);
  const inbox = useQuery({
    queryKey: reviewQueryKeys.inbox(),
    queryFn: () => review.inbox(),
    staleTime: 30_000,
  });
  const inProgress = useInProgress(app);

  const all = tests.data ?? [];
  // A Test id can exist in two Apps; its App disambiguates links.
  const shared = useMemo(() => {
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const test of all) (seen.has(test.id) ? repeated : seen).add(test.id);
    return repeated;
  }, [all]);
  const byKey = useMemo(
    () => new Map(all.map((test) => [`${test.appMapId}:${test.id}`, test])),
    [all],
  );
  const inApp = (test: ProductTestSummary) => !app || test.appMapId === app;
  const toReview = inbox.data?.entries
    .filter((entry) => !app || entry.appMapId === app)
    .reduce((total, entry) => total + entry.items.length, 0);
  const failing = all.filter(
    (test) => inApp(test) && !isTestDraft(test) && runStateOf(test.recentRun) === "failed",
  );

  const plans = useMemo(
    () =>
      (suites.data ?? [])
        .filter((suite) => !app || suite.appMapId === app)
        .map((suite, index) => {
          const members = suite.tests.flatMap((member) => {
            const test = byKey.get(`${suite.appMapId}:${member.id}`);
            return test ? [test] : [];
          });
          const last = Math.max(0, ...members.map((test) => runTime(test.recentRun)));
          const schedule = schedules[(suites.data ?? []).indexOf(suite)]?.data?.find(
            (item) => item.enabled,
          );
          return { suite, members, last, schedule, index };
        })
        .sort((left, right) => right.last - left.last || left.index - right.index),
    [app, byKey, schedules, suites.data],
  );
  const matchingPlans = plans.filter(
    ({ suite, members }) =>
      !deferredQuery ||
      `${suite.name} ${suite.appName} ${members.map((test) => test.name).join(" ")}`
        .toLocaleLowerCase()
        .includes(deferredQuery),
  );
  const scoped = all.filter(inApp);
  const drafts = scoped.filter(isTestDraft);
  const saved = scoped.filter((test) => !isTestDraft(test));
  const testCount = all.filter(inApp).length;

  const flat = Boolean(deferredQuery) || result !== "all";
  const matches = all
    .filter(
      (test) =>
        inApp(test) &&
        (view === "drafts" ? isTestDraft(test) : !isTestDraft(test)) &&
        matchesResult(test, result) &&
        (!deferredQuery ||
          `${test.name} ${test.appName}`.toLocaleLowerCase().includes(deferredQuery)),
    )
    .sort((left, right) => runTime(right.recentRun) - runTime(left.recentRun));

  const returnFocus = useCollectionReturnFocus(
    "relay:focus:/tests",
    tests.data ? `${view}:${flat}:${matches.length}:${plans.length}` : undefined,
    "/tests/",
  );

  function updateSearch(next: { q?: string; result?: ResultFilter; view?: LibraryView }) {
    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        ...(next.view === undefined
          ? {}
          : {
              view: next.view === "tests" ? undefined : next.view,
              plan: undefined,
              planApp: undefined,
            }),
        ...(next.q === undefined ? {} : { q: next.q || undefined }),
        ...(next.result === undefined
          ? {}
          : { result: next.result === "all" ? undefined : next.result }),
      }),
    });
  }

  return (
    <LibraryPage className="max-w-5xl" onClickCapture={returnFocus.onClickCapture}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-3xl leading-9 font-semibold tracking-tight">Tests</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <NewPlanDialog {...(app ? { appId: app } : {})} />
          <Button
            nativeButton={false}
            render={<Link to="/tests/new" search={{ app: app || undefined }} />}
          >
            <Plus aria-hidden="true" /> New test
          </Button>
        </div>
      </header>

      <AttentionStrip
        toReview={toReview}
        failing={failing.length}
        inProgress={inProgress}
        onShowFailing={() => updateSearch({ result: "failed", view: "tests" })}
      />

      <Tabs
        value={view}
        onValueChange={(value) => updateSearch({ view: value as LibraryView, result: "all" })}
        className="mt-6"
      >
        <TabsList variant="line" aria-label="Test library" className="h-11 gap-3">
          {(
            [
              ["tests", "Tests", saved.length],
              ["plans", "Plans", plans.length],
              ["drafts", "Drafts", drafts.length],
            ] as const
          ).map(([value, label, count]) => (
            <TabsTrigger
              key={value}
              value={value}
              data-library-view={value}
              className="min-h-10 px-2 transition-colors"
            >
              {label}
              <span className="text-xs text-muted-foreground tabular-nums">
                {tests.data ? count : ""}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={view}>
          <div className="relative mt-4">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              aria-label={view === "plans" ? "Search plans" : "Search tests"}
              className="h-10 pl-9"
              placeholder={view === "plans" ? "Search plans" : "Search tests"}
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                updateSearch({ q: event.currentTarget.value });
              }}
            />
          </div>

          {tests.isPending ? <PageLoading label="Loading tests…" /> : null}
          <RecordingProblem
            error={tests.data === undefined ? tests.error : null}
            onRetry={() => void tests.refetch()}
            retrying={tests.isFetching}
            layout="centered"
          />

          {tests.data && !testCount && view !== "plans" ? (
            <EmptyState
              title={app ? "No tests for this App yet" : "No tests yet"}
              detail="Record a flow on your website or device, then save it as a test."
              action={
                <Button
                  nativeButton={false}
                  render={<Link to="/tests/new" search={{ app: app || undefined }} />}
                >
                  <Plus aria-hidden="true" /> New test
                </Button>
              }
            />
          ) : null}

          {tests.data && testCount > 0 && view !== "plans" && flat ? (
            <section className="mt-4" aria-label="Matching tests">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {matches.length} {matches.length === 1 ? "test" : "tests"}
                  {result === "failed" ? " failing" : ""}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    updateSearch({ q: "", result: "all" });
                  }}
                >
                  <X aria-hidden="true" /> Clear
                </Button>
              </div>
              {matches.length ? (
                <TestList tests={matches} shared={shared} showAppName={!app} />
              ) : (
                <EmptyState
                  title="No matching tests"
                  detail="Try another search or clear the filter."
                />
              )}
            </section>
          ) : null}

          {tests.data && testCount > 0 && !flat && view !== "plans" ? (
            <section aria-labelledby="loose-heading" className="mt-4">
              <h2 id="loose-heading" className="sr-only">
                {view === "drafts" ? "Draft tests" : "All tests"}
              </h2>
              {matches.length ? (
                <TestList tests={matches} shared={shared} showAppName={!app} />
              ) : (
                <EmptyState
                  title={view === "drafts" ? "No unfinished tests" : "No recorded tests yet"}
                  detail={
                    view === "drafts"
                      ? "Unrecorded tests appear here until their steps are ready."
                      : "Create a test, or finish recording one of your drafts."
                  }
                />
              )}
            </section>
          ) : null}
          {tests.data && view === "plans" ? (
            <section aria-labelledby="plans-heading" className="mt-4">
              <h2 id="plans-heading" className="sr-only">
                Test plans
              </h2>
              {matchingPlans.length ? (
                <ul className="m-0 grid list-none divide-y divide-border p-0">
                  {matchingPlans.map(({ suite, members, last, schedule }) => (
                    <PlanGroup
                      key={`${suite.appMapId}:${suite.id}`}
                      suite={suite}
                      members={members}
                      last={last}
                      shared={shared}
                      {...(schedule ? { schedule } : {})}
                    />
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title={deferredQuery ? "No matching plans" : "No plans yet"}
                  detail={
                    deferredQuery
                      ? "Try another search."
                      : "Group tests into a plan to run them together."
                  }
                  action={
                    deferredQuery ? undefined : <NewPlanDialog {...(app ? { appId: app } : {})} />
                  }
                />
              )}
            </section>
          ) : null}
        </TabsContent>
      </Tabs>
    </LibraryPage>
  );
}

type InProgress = { label: string; action: string; to: "recording" | "run"; id: string };

/**
 * Work this person started that is still going: a recording or a run. With an
 * App chosen, work that belongs to another App stays out; a recording whose App
 * is not known yet is kept so it cannot be lost.
 */
function useInProgress(app: string): InProgress[] {
  const { platform, productService, catalogService } = useRouteContext({ from: "__root__" });
  const recording = useQuery({
    queryKey: recordingQueryKeys.pointer,
    queryFn: async () => (await readWorkflowPointer(platform)) ?? null,
    staleTime: Infinity,
  });
  const recordingState = useQuery({
    queryKey: recordingQueryKeys.workflow(recording.data ?? "inactive"),
    queryFn: () => productService.inspect(recording.data!),
    enabled: Boolean(recording.data),
    staleTime: 15_000,
  });
  const runPointer = useQuery({
    queryKey: runQueryKeys.pointer,
    queryFn: async () => (await readRunPointer(platform)) ?? null,
    staleTime: Infinity,
  });
  const runs = useQuery({
    queryKey: catalogQueryKeys.runs,
    queryFn: () => catalogService.listRuns(),
    staleTime: 15_000,
    retry: false,
  });
  const items: InProgress[] = [];
  const stage = recordingState.data?.snapshot?.stage;
  const recordingApp = recordingState.data?.snapshot?.frozen?.appMapId;
  if (
    recording.data &&
    stage &&
    stage !== "committed" &&
    stage !== "cancelled" &&
    (!app || !recordingApp || recordingApp === app)
  ) {
    items.push({
      label: recordingState.data?.snapshot?.frozen?.title ?? "Recording",
      action: stage === "reviewing" ? "Review steps" : "Continue recording",
      to: "recording",
      id: recording.data,
    });
  }
  const run = runs.data?.find(
    (item) =>
      item.id === runPointer.data?.runId &&
      (item.phase === "running" || item.phase === "queued") &&
      (!app || item.appMapId === app),
  );
  if (run) items.push({ label: run.testName ?? run.title, action: "Watch", to: "run", id: run.id });
  return items;
}

function AttentionStrip({
  toReview,
  failing,
  inProgress,
  onShowFailing,
}: {
  toReview: number | undefined;
  failing: number;
  inProgress: readonly InProgress[];
  onShowFailing(): void;
}) {
  if (!toReview && !failing && !inProgress.length) return null;
  const chip =
    "flex min-h-11 items-center gap-2.5 rounded-xl border px-3.5 py-2 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="mt-5 flex flex-wrap gap-2" aria-label="Needs you">
      {inProgress.map((item) => (
        <Link
          key={item.id}
          className={`${chip} border-brand/30 bg-brand-soft text-foreground hover:border-brand/60`}
          {...(item.to === "recording"
            ? { to: "/recordings/$recordingId", params: { recordingId: item.id } }
            : { to: "/runs/$runId", params: { runId: item.id } })}
        >
          <CircleDot
            className="size-4 animate-pulse text-brand motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span className="max-w-64 truncate">{item.label}</span>
          <span className="text-brand">{item.action}</span>
        </Link>
      ))}
      {toReview ? (
        <Link
          to="/review"
          className={`${chip} border-border bg-card hover:border-warning/60 hover:bg-warning/5`}
        >
          <Eye className="size-4 text-warning-foreground" aria-hidden="true" />
          {toReview} {toReview === 1 ? "screenshot" : "screenshots"} to review
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </Link>
      ) : null}
      {failing ? (
        <button
          type="button"
          onClick={onShowFailing}
          className={`${chip} border-border bg-card hover:border-destructive/50 hover:bg-destructive/5`}
        >
          <CircleX className="size-4 text-destructive" aria-hidden="true" />
          {failing} {failing === 1 ? "test" : "tests"} failing
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function PlanGroup({
  suite,
  members,
  last,
  schedule,
  shared,
}: {
  suite: ProductSuite;
  members: readonly ProductTestSummary[];
  last: number;
  schedule?: ProductPlanSchedule;
  shared: ReadonlySet<string>;
}) {
  const search = routeApi.useSearch() as { plan?: unknown; planApp?: unknown };
  const navigate = useNavigate({ from: "/tests" });
  const open = search.plan === suite.id && search.planApp === suite.appMapId;
  const states: RunState[] = suite.tests.map((member) =>
    runStateOf(members.find((test) => test.id === member.id)?.recentRun),
  );
  const panelId = `plan-${suite.appMapId}-${suite.id}`;
  return (
    <li className="overflow-hidden">
      <div className={`flex items-center gap-3 rounded-lg py-4 pr-2 ${libraryRowSurface}`}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() =>
            void navigate({
              search: (previous) => ({
                ...previous,
                plan: open ? undefined : suite.id,
                planApp: open ? undefined : suite.appMapId,
              }),
              replace: true,
            })
          }
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={`size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <strong className="text-sm font-medium text-pretty">{suite.name}</strong>
            <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
              {suite.appName} · {suite.tests.length} {suite.tests.length === 1 ? "test" : "tests"}
              {schedule ? (
                <>
                  {" · "}
                  <Clock className="size-3 shrink-0" aria-hidden="true" />
                  {scheduleLabel(schedule)}
                </>
              ) : null}
              {last ? ` · ${relativeTime(last)}` : ""}
            </span>
          </span>
          <span className="hidden w-56 shrink-0 md:block">
            <PlanResultSummary states={states} />
          </span>
        </button>
        <Button
          nativeButton={false}
          variant="ghost"
          size="sm"
          render={
            <Link
              to="/apps/$appId/suites/$suiteId"
              params={{ appId: suite.appMapId, suiteId: suite.id }}
            />
          }
        >
          <Play aria-hidden="true" /> Run all
        </Button>
      </div>
      {open ? (
        <div id={panelId} className="pb-3 pl-5">
          <div className="px-4 pt-3 md:hidden">
            <PlanResultSummary states={states} />
          </div>
          <TestList tests={members} shared={shared} bare plan={suite} />
        </div>
      ) : null}
    </li>
  );
}

const SUMMARY_ORDER: readonly RunState[] = [
  "failed",
  "review",
  "running",
  "passed",
  "cancelled",
  "not-run",
];

/** One glance: a health bar, then only the counts that matter. */
function PlanResultSummary({ states }: { states: readonly RunState[] }) {
  const counts = new Map<RunState, number>();
  for (const state of states) counts.set(state, (counts.get(state) ?? 0) + 1);
  const ordered = SUMMARY_ORDER.filter((state) => counts.has(state));
  const description = ordered
    .map((state) => `${counts.get(state)} ${runStateLabel(state).toLowerCase()}`)
    .join(", ");
  if (!states.length) return null;
  return (
    <span className="grid gap-1.5" title={description} aria-label={description}>
      <span className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {ordered.map((state) => (
          <span
            key={state}
            className={`grow-(--share) ${runStateDot(state)}`}
            style={{ "--share": counts.get(state) } as CSSProperties}
          />
        ))}
      </span>
      <span className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        {ordered
          .filter((state) => state !== "not-run" && state !== "cancelled")
          .map((state) => (
            <span key={state} className="inline-flex items-center gap-1 tabular-nums">
              <span className={`size-1.5 rounded-full ${runStateDot(state)}`} />
              {counts.get(state)}{" "}
              {state === "review" ? "to review" : runStateLabel(state).toLowerCase()}
            </span>
          ))}
        {counts.has("not-run") ? (
          <span className="tabular-nums">{counts.get("not-run")} not run</span>
        ) : null}
      </span>
    </span>
  );
}

function scheduleLabel(schedule: ProductPlanSchedule): string {
  if (schedule.hour === undefined) return "Scheduled";
  const time = new Date(2000, 0, 1, schedule.hour).toLocaleTimeString(undefined, {
    hour: "numeric",
  });
  return `Daily ${time}`;
}

function resultFilter(value: unknown): ResultFilter {
  return value === "passed" || value === "failed" || value === "running" || value === "never"
    ? value
    : "all";
}

function matchesResult(test: ProductTestSummary, result: ResultFilter): boolean {
  if (result === "all") return true;
  const state = runStateOf(test.recentRun);
  if (result === "never") return !test.recentRun;
  if (result === "running") return state === "running";
  return state === result;
}
