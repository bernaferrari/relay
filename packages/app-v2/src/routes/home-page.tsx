/** @jsxImportSource react */
import type { ProductRunSummary, ProductTestSummary } from "@relay/product/catalog";
import type { ProductChange } from "@relay/product/change-journey";
import { Button, Card, CardContent } from "@relay/ui-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
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
import { recordingQueryKeys } from "../data/recording-queries";
import { runQueryKeys } from "../data/run-queries";
import { readRunPointer } from "../data/run-pointer";
import { readWorkflowPointer } from "../data/workflow-pointer";
import { PageLoading, RecordingProblem } from "./recording-shared";

const homeQueryKeys = {
  apps: ["home", "apps"] as const,
  tests: ["home", "tests"] as const,
  runs: ["home", "runs"] as const,
  changes: ["home", "changes"] as const,
  targets: ["home", "targets"] as const,
};

export function HomePage() {
  const { platform, productService, catalogService, changeService } = useRouteContext({
    from: "__root__",
  });
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
    queryKey: homeQueryKeys.tests,
    queryFn: () => catalogService.listTests(),
    staleTime: 15_000,
  });
  const runs = useQuery({
    queryKey: homeQueryKeys.runs,
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
  const latestTest = newest(tests.data ?? [], (test) => test.updatedAt);
  const currentChange = newest(
    (changes.data ?? []).filter((change) => change.status !== "superseded"),
    (change) => change.updatedAt,
  );
  const hasApps = Boolean(apps.data?.length);
  const hasTests = Boolean(tests.data?.length);
  const hasWorkspaceData =
    hasApps || hasTests || Boolean(runs.data?.length) || Boolean(changes.data?.length);

  const retry = () => {
    for (const query of [...queries, targets]) void query.refetch();
  };

  return (
    <section className="relay-page relay-home-page">
      <header className="relay-page-header relay-home-header">
        <div>
          <p className="relay-eyebrow">Overview</p>
          <h1>{hasWorkspaceData ? "Ready when you are" : "Prove one journey that matters"}</h1>
          <p className="relay-page-description">
            {hasWorkspaceData
              ? "Pick up the most useful work, then inspect recent results without hunting through the app."
              : "Record a real path through your app. Relay will replay it and keep the evidence with every result."}
          </p>
        </div>
        <div className="relay-home-header-actions">
          {hasWorkspaceData ? (
            <Link
              className="relay-home-readiness"
              data-status={
                targets.isPending ? "loading" : targets.data?.length ? "ready" : "missing"
              }
              to="/devices"
            >
              <MonitorCheck aria-hidden="true" />
              {targets.isPending
                ? "Checking targets…"
                : targets.data?.length
                  ? `${targets.data.length} ${targets.data.length === 1 ? "target" : "targets"} ready`
                  : "Check targets"}
            </Link>
          ) : null}
          {hasTests ? (
            <Button render={<Link to="/tests/new" />} variant="primary">
              <Plus aria-hidden="true" />
              New Test
            </Button>
          ) : null}
        </div>
      </header>

      {loading ? <PageLoading label="Loading your Relay workspace…" /> : null}
      <RecordingProblem
        error={error}
        onRetry={retry}
        retrying={[...queries, targets].some((query) => query.isFetching)}
      />

      {!loading && !error && !hasWorkspaceData ? (
        <EmptyState
          title="Add the app you want to verify"
          detail="Relay needs an app before it can keep Tests, Runs, and proof in one trustworthy place."
          icon={Plus}
          action={
            <Button render={<Link to="/apps" />} variant="primary">
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
            <Button render={<Link to="/tests/new" />} variant="primary">
              Record a Test
            </Button>
          }
        />
      ) : null}

      {!loading && !error && hasTests ? (
        <div className="relay-home-content">
          <section className="relay-home-next" aria-labelledby="home-next-title">
            <p className="relay-section-label">Up next</p>
            <HomeNextAction
              recordingId={recording.data}
              runId={run.data?.runId}
              change={currentChange}
              test={latestTest}
            />
          </section>

          <section className="relay-home-recent" aria-labelledby="home-recent-title">
            <div className="relay-section-heading">
              <div>
                <p className="relay-section-label">Recent</p>
                <h2 id="home-recent-title">Latest results</h2>
              </div>
              <Link className="relay-inline-action" to="/runs">
                View all Runs <ArrowRight aria-hidden="true" />
              </Link>
            </div>
            {runs.data?.length ? (
              <div className="relay-home-recent-list">
                {[...(runs.data ?? [])]
                  .sort((left, right) => runTime(right) - runTime(left))
                  .slice(0, 3)
                  .map((item) => (
                    <RecentRun key={item.id} run={item} />
                  ))}
              </div>
            ) : (
              <Card className="relay-home-no-runs">
                <CardContent>
                  <CheckCircle2 aria-hidden="true" />
                  <div>
                    <strong>No results yet</strong>
                    <p>Open a saved Test and run it when you are ready.</p>
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
  test,
}: {
  recordingId: string | null | undefined;
  runId: string | undefined;
  change: ProductChange | undefined;
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
      eyebrow="Ready to run"
      title={test.name}
      detail={`Open this Test to run its ${test.stepCount} ${test.stepCount === 1 ? "step" : "steps"} or choose more devices and values.`}
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
        link={<Link to="/tests/$testId/record" params={{ testId: id }} />}
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
    <Button render={link} className="relay-home-next-card" variant="ghost">
      <span className="relay-home-next-icon">
        <Icon aria-hidden="true" />
      </span>
      <span className="relay-home-next-copy">
        <span className="relay-home-next-eyebrow">{eyebrow}</span>
        <strong id="home-next-title">{title}</strong>
        <span>{detail}</span>
      </span>
      <span className="relay-home-next-action">
        {action} <ArrowRight aria-hidden="true" />
      </span>
    </Button>
  );
}

function RecentRun({ run }: { run: ProductRunSummary }) {
  return (
    <Link className="relay-home-run" to="/runs/$runId" params={{ runId: run.id }}>
      <span className="relay-home-run-copy">
        <strong>{run.testName ?? run.title}</strong>
        <small>
          {run.targetName ?? run.appName ?? "Saved Test"} · {relativeTime(runTime(run))}
        </small>
      </span>
      <OutcomeMark outcome={run.outcome ?? run.phase} />
      <ArrowRight aria-hidden="true" />
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
