/** @jsxImportSource react */
import type { ProductRunSummary, ProductTestSummary } from "@relay/product/catalog";
import type { ProductChange } from "@relay/product/change-journey";
import { Button } from "@relay/ui-react/components/button";
import { Card, CardContent } from "@relay/ui-react/components/card";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  FlaskConical,
  GitCompareArrows,
  MonitorCheck,
  Play,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { EmptyState, OutcomeMark } from "../components/product-patterns";
import { catalogQueryKeys } from "../data/catalog-queries";
import { recordingQueryKeys } from "../data/recording-queries";
import { runQueryKeys } from "../data/run-queries";
import { readRunPointer } from "../data/run-pointer";
import { readWorkflowPointer } from "../data/workflow-pointer";
import { PageLoading, RecordingProblem } from "./recording-shared";

const homeQueryKeys = {
  apps: ["home", "apps"] as const,
  changes: ["home", "changes"] as const,
  targets: ["home", "targets"] as const,
};
const routeApi = getRouteApi("/home");

export function HomePage() {
  const { platform, productService, catalogService, changeService } = useRouteContext({
    from: "__root__",
  });
  const search = routeApi.useSearch() as { app?: unknown };
  const appScope = typeof search.app === "string" ? search.app : "";
  const recording = useQuery({
    queryKey: recordingQueryKeys.pointer,
    queryFn: async () => (await readWorkflowPointer(platform)) ?? null,
    staleTime: Infinity,
  });
  const run = useQuery({
    queryKey: runQueryKeys.pointer,
    queryFn: async () => (await readRunPointer(platform)) ?? null,
    staleTime: Infinity,
  });
  const apps = useQuery({ queryKey: homeQueryKeys.apps, queryFn: () => productService.listApps() });
  const tests = useQuery({
    queryKey: catalogQueryKeys.tests,
    queryFn: () => catalogService.listTests(),
    staleTime: 15_000,
  });
  const runs = useQuery({
    queryKey: catalogQueryKeys.runs,
    queryFn: () => catalogService.listRuns(),
    staleTime: 15_000,
  });
  const changes = useQuery({
    queryKey: homeQueryKeys.changes,
    queryFn: () => changeService.list(),
    staleTime: 15_000,
  });
  const targets = useQuery({
    queryKey: homeQueryKeys.targets,
    queryFn: async () => {
      const state = await productService.connect();
      return productService.presentTargets(state.targets);
    },
    staleTime: 15_000,
  });

  const queries = [recording, run, apps, tests, runs, changes] as const;
  const loading = queries.some((query) => query.isPending);
  const error = queries.find((query) => query.error)?.error;
  const scopedTests = (tests.data ?? []).filter((test) => !appScope || test.appMapId === appScope);
  const scopedRuns = (runs.data ?? []).filter((run) => !appScope || run.appMapId === appScope);
  const scopedChanges = (changes.data ?? []).filter(
    (change) => !appScope || change.appIds?.includes(appScope),
  );
  const selectedApp = apps.data?.find((app) => app.id === appScope);
  const latestTest = newest(scopedTests, (test) => test.updatedAt);
  const recentTests = [...scopedTests]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 5);
  // A later successful run resolves an earlier failure of the same test.
  const latestByTest = new Map<string, ProductRunSummary>();
  for (const item of [...scopedRuns].sort((left, right) => runTime(right) - runTime(left))) {
    const key = item.testId ?? item.id;
    if (!latestByTest.has(key)) latestByTest.set(key, item);
  }
  const attentionRuns = [...latestByTest.values()].filter((item) =>
    ["product-failure", "harness-failure", "uncertain", "needs-review"].includes(
      item.outcome ?? item.phase,
    ),
  );
  const visibleChanges = scopedChanges.filter((change) => change.status !== "superseded");
  const currentChange = newest(
    visibleChanges.filter((change) =>
      [
        "ready",
        "rejected",
        "needs-review",
        "insufficient-evidence",
        "running",
        "running-pilot",
      ].includes(change.status),
    ),
    (change) => change.updatedAt,
  );
  const hasApps = Boolean(apps.data?.length);
  const hasTests = Boolean(scopedTests.length);
  const hasWorkspaceData =
    hasApps || hasTests || Boolean(scopedRuns.length) || Boolean(scopedChanges.length);

  const retry = () => {
    for (const query of [...queries, targets]) void query.refetch();
  };

  return (
    <section className="relay-page flex w-full max-w-6xl flex-col gap-8">
      <header className="flex max-w-none flex-col gap-4 border-b border-border/60 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-muted-foreground">Overview</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
            {selectedApp
              ? selectedApp.name
              : hasWorkspaceData
                ? "Your workspace"
                : "Prove one journey that matters"}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            {hasWorkspaceData
              ? `${scopedTests.length} saved ${scopedTests.length === 1 ? "test" : "tests"} · ${attentionRuns.length ? `${attentionRuns.length} ${attentionRuns.length === 1 ? "result needs" : "results need"} attention` : "No results need attention"}`
              : "Record a real path through your app. Relay will replay it and keep the evidence with every result."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasWorkspaceData ? (
            <Button
              nativeButton={false}
              render={<Link to="/devices" />}
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground"
              data-status={
                targets.isPending ? "loading" : targets.data?.length ? "ready" : "missing"
              }
            >
              <MonitorCheck className="size-4" aria-hidden="true" />
              {targets.isPending
                ? "Checking targets…"
                : targets.data?.length
                  ? `${targets.data.length} ${targets.data.length === 1 ? "target" : "targets"} ready`
                  : "Check targets"}
            </Button>
          ) : null}
          {hasTests ? (
            <Button
              nativeButton={false}
              render={<Link to="/tests/new" search={{ app: appScope || undefined }} />}
              variant="default"
              size="sm"
            >
              <Plus className="size-4" aria-hidden="true" />
              Record a Test
            </Button>
          ) : null}
        </div>
      </header>

      {loading ? <PageLoading label="Loading your Relay workspace…" /> : null}
      <RecordingProblem
        error={error}
        onRetry={retry}
        retrying={[...queries, targets].some((query) => query.isFetching)}
        layout="centered"
      />

      {!loading && !error && !hasWorkspaceData ? (
        <EmptyState
          title="Add the app you want to verify"
          detail="Relay needs an app before it can keep Tests, Runs, and proof in one trustworthy place."
          icon={Plus}
          action={
            <Button nativeButton={false} render={<Link to="/apps" />} variant="default">
              Add an App
            </Button>
          }
        />
      ) : null}

      {!loading && !error && hasApps && !hasTests ? (
        <EmptyState
          title="Record your first Test"
          detail="Choose one path a person depends on. You can add broader coverage after the first clean replay."
          icon={FlaskConical}
          action={
            <Button
              nativeButton={false}
              render={<Link to="/tests/new" search={{ app: appScope || undefined }} />}
              variant="default"
            >
              Record a Test
            </Button>
          }
        />
      ) : null}

      {!loading && !error && hasTests ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
          <section className="min-w-0" aria-labelledby="home-next-title">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Continue
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                  Pick up where you left off
                </h2>
              </div>
            </div>
            <HomeNextAction
              recordingId={!appScope ? recording.data : undefined}
              runId={
                !appScope || scopedRuns.some((item) => item.id === run.data?.runId)
                  ? run.data?.runId
                  : undefined
              }
              change={currentChange}
              attentionRun={attentionRuns[0]}
              test={latestTest}
            />
            <div className="mt-7 flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold">Recent tests</h2>
              <Link
                className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                to="/tests"
                search={{ app: appScope || undefined }}
              >
                Browse tests
              </Link>
            </div>
            <ul className="mt-3 divide-y divide-border/60 border-y border-border/60">
              {recentTests.map((test) => (
                <li key={test.id} className="flex min-h-16 items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <Link
                      to="/tests/$testId"
                      params={{ testId: test.id }}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {test.name}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {test.appName} · {test.stepCount} steps
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {test.status === "ready" ? "Ready" : "Needs review"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="min-w-0" aria-labelledby="home-recent-title">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Recent
                </p>
                <h2
                  id="home-recent-title"
                  className="mt-1 text-lg font-semibold tracking-tight text-foreground"
                >
                  Latest results
                </h2>
              </div>
              <Button
                nativeButton={false}
                render={<Link to="/runs" search={{ app: appScope || undefined }} />}
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
              >
                View all <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
            {scopedRuns.length ? (
              <Card className="mt-4 gap-0 py-0">
                {[...scopedRuns]
                  .sort((left, right) => runTime(right) - runTime(left))
                  .slice(0, 3)
                  .map((item) => (
                    <RecentRun key={item.id} run={item} />
                  ))}
              </Card>
            ) : (
              <Card className="mt-4" size="sm">
                <CardContent className="flex items-start gap-3">
                  <CheckCircle2
                    className="mt-0.5 size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="space-y-1">
                    <strong className="text-sm font-medium text-foreground">No results yet</strong>
                    <p className="text-sm text-muted-foreground">
                      Open a saved Test and run it when you are ready.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function HomeNextAction({
  recordingId,
  runId,
  change,
  attentionRun,
  test,
}: {
  recordingId: string | null | undefined;
  runId: string | undefined;
  change: ProductChange | undefined;
  attentionRun: ProductRunSummary | undefined;
  test: ProductTestSummary | undefined;
}) {
  if (recordingId) {
    return (
      <NextCard
        icon={FlaskConical}
        eyebrow="Recording in progress"
        title="Finish the Test you started"
        detail="Your captured steps are still here. Continue recording, then review the path before saving it."
        action="Continue recording"
        to="recording"
        id={recordingId}
      />
    );
  }
  if (runId) {
    return (
      <NextCard
        icon={Play}
        eyebrow="Run in progress"
        title="See how the current Run is going"
        detail="Follow its progress now. The same page becomes the final Report when Relay finishes."
        action="Open Run"
        to="run"
        id={runId}
      />
    );
  }
  if (attentionRun) {
    return (
      <NextCard
        icon={CircleAlert}
        eyebrow="Result needs attention"
        title={attentionRun.testName ?? attentionRun.title}
        detail={`${attentionRun.targetName ?? "Saved run"} · Inspect the recorded result and evidence.`}
        action="Inspect result"
        to="run"
        id={attentionRun.id}
      />
    );
  }
  if (change) {
    const attention = ["rejected", "needs-review", "insufficient-evidence"].includes(change.status);
    const complete = change.status === "proved";
    return (
      <NextCard
        icon={attention ? CircleAlert : GitCompareArrows}
        eyebrow={
          attention ? "Change needs attention" : complete ? "Latest proof" : "Current Change"
        }
        title={change.title}
        detail={
          attention
            ? "Review what blocked proof and choose the next safe action."
            : complete
              ? "The latest Change is proved. Inspect its result and retained evidence."
              : "Review the selected Tests and targets, then continue verification."
        }
        action={attention ? "Review Change" : complete ? "View proof" : "Continue verification"}
        to="change"
        id={change.id}
      />
    );
  }
  return test ? (
    <NextCard
      icon={Play}
      eyebrow={test.status === "ready" ? "Ready to run" : "Test needs review"}
      title={test.name}
      detail={
        test.status === "ready"
          ? `${test.stepCount} saved steps. Choose where to run and inspect the result.`
          : "Review the unfinished steps before running this test."
      }
      action="Open Test"
      to="test"
      id={test.id}
    />
  ) : null;
}

function NextCard({
  icon: Icon,
  eyebrow,
  title,
  detail,
  action,
  to,
  id,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  detail: string;
  action: string;
  to: "recording" | "run" | "change" | "test";
  id: string;
}) {
  if (to === "recording") {
    return (
      <NextCardLink
        icon={Icon}
        eyebrow={eyebrow}
        title={title}
        detail={detail}
        action={action}
        link={<Link to="/recordings/$recordingId" params={{ recordingId: id }} />}
      />
    );
  }
  if (to === "run") {
    return (
      <NextCardLink
        icon={Icon}
        eyebrow={eyebrow}
        title={title}
        detail={detail}
        action={action}
        link={<Link to="/runs/$runId" params={{ runId: id }} />}
      />
    );
  }
  if (to === "change") {
    return (
      <NextCardLink
        icon={Icon}
        eyebrow={eyebrow}
        title={title}
        detail={detail}
        action={action}
        link={<Link to="/changes/$changeId" params={{ changeId: id }} />}
      />
    );
  }
  return (
    <NextCardLink
      icon={Icon}
      eyebrow={eyebrow}
      title={title}
      detail={detail}
      action={action}
      link={<Link to="/tests/$testId" params={{ testId: id }} />}
    />
  );
}

function NextCardLink({
  icon: Icon,
  eyebrow,
  title,
  detail,
  action,
  link,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  detail: string;
  action: string;
  link: React.ReactElement;
}) {
  return (
    <Button
      nativeButton={false}
      render={link}
      className="mt-4 grid h-auto min-h-32 w-full grid-cols-[2rem_minmax(0,1fr)] items-start gap-4 rounded-xl border border-border/70 bg-card p-4 text-left whitespace-normal text-card-foreground shadow-none hover:border-border hover:bg-muted/40 md:grid-cols-[2rem_minmax(0,1fr)_auto] md:p-5"
      variant="ghost"
    >
      <span className="grid size-8 place-items-center rounded-lg bg-muted text-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="grid min-w-0 gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {eyebrow}
        </span>
        <strong
          id="home-next-title"
          className="text-base font-semibold tracking-tight text-foreground"
        >
          {title}
        </strong>
        <span className="max-w-prose text-sm leading-5 text-muted-foreground">{detail}</span>
      </span>
      <span className="col-span-2 inline-flex items-center gap-1 text-sm font-medium text-foreground md:col-span-1 md:mt-1">
        {action} <ArrowRight className="size-4" aria-hidden="true" />
      </span>
    </Button>
  );
}

function RecentRun({ run }: { run: ProductRunSummary }) {
  return (
    <Link
      className="group grid min-h-16 grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      to="/runs/$runId"
      params={{ runId: run.id }}
    >
      <span className="grid min-w-0 gap-1">
        <strong className="truncate text-sm font-medium text-foreground">
          {run.testName ?? run.title}
        </strong>
        <small className="truncate text-xs text-muted-foreground">
          {run.targetName ?? run.appName ?? "Saved Test"} · {relativeTime(runTime(run))}
        </small>
      </span>
      <OutcomeMark outcome={run.outcome ?? run.phase} />
      <ArrowRight
        className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}

function newest<T>(values: readonly T[], timestamp: (value: T) => number): T | undefined {
  return [...values].sort((left, right) => timestamp(right) - timestamp(left))[0];
}

function runTime(run: ProductRunSummary): number {
  return run.finishedAt ?? run.startedAt ?? run.queuedAt;
}

function relativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}
