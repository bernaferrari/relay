/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Breadcrumbs, EmptyState, OutcomeMark } from "../components/product-patterns";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/apps/$appId");

export function AppPage() {
  const { mapService, catalogService } = useRouteContext({ from: "__root__" });
  const { appId } = routeApi.useParams();
  const app = useQuery({
    queryKey: ["app", appId],
    queryFn: () => mapService.get(appId),
    staleTime: 15_000,
  });
  const tests = useQuery({
    queryKey: ["catalog", "tests", { appMapId: appId }],
    queryFn: () => catalogService.listTests({ appMapId: appId }),
    staleTime: 15_000,
  });
  const runs = useQuery({
    queryKey: ["catalog", "runs", { appMapId: appId }],
    queryFn: () => catalogService.listRuns({ appMapId: appId }),
    staleTime: 10_000,
  });
  // The app identity is the shell for this page. Secondary panels should be
  // independently recoverable so a transient Runs or Tests failure does not
  // erase the rest of the working context.
  const loading = app.isPending;
  const error = app.error;
  const retry = () => {
    void app.refetch();
    void tests.refetch();
    void runs.refetch();
  };
  const recentRuns = [...(runs.data ?? [])]
    .sort((left, right) => runTime(right) - runTime(left))
    .slice(0, 3);

  return (
    <section className="relay-page max-w-[1040px]">
      <Breadcrumbs
        items={[{ label: "Home", to: "/home" }, { label: app.data?.appName ?? "App" }]}
      />
      {loading ? <PageLoading label="Loading app overview…" /> : null}
      <RecordingProblem
        error={error}
        onRetry={retry}
        retrying={app.isFetching || tests.isFetching || runs.isFetching}
      />
      {app.data && !error ? (
        <>
          <header className="relay-page-header flex items-start justify-between gap-7 max-[780px]:flex-col">
            <div>
              <p className="relay-eyebrow">App</p>
              <h1>{app.data.appName}</h1>
              <p className="relay-page-description">
                {app.data.description ??
                  "Saved Tests, recent Reports, and known behavior in one place."}
              </p>
            </div>
            <div className="flex flex-none flex-wrap gap-2">
              <Button
                nativeButton={false}
                render={<Link to="/tests/new" search={{ app: appId }} />}
                variant="default"
              >
                Record a Test
              </Button>
            </div>
          </header>

          <dl className="my-7.5 grid grid-cols-3 border-y border-border py-[18px] max-[560px]:grid-cols-1 max-[560px]:gap-3.5" aria-label={`${app.data.appName} overview`}>
            <div>
              <dt>Saved Tests</dt>
              <dd>
                {tests.isError
                  ? "Unavailable"
                  : (tests.data?.length ?? app.data.coverage.testCount)}
              </dd>
            </div>
            <div>
              <dt>Reports</dt>
              <dd>{runs.isError ? "Unavailable" : (runs.data?.length ?? 0)}</dd>
            </div>
            <div>
              <dt>Known screen coverage</dt>
              <dd>
                {app.data.coverage.coveredScreenCount} of {app.data.coverage.screenCount}
              </dd>
            </div>
          </dl>

          <div className="mt-[38px] grid grid-cols-2 gap-9 max-[780px]:grid-cols-1">
            <section className="min-w-0" aria-labelledby="app-tests-title">
              <header className="relay-section-heading">
                <div>
                  <p className="relay-section-label">Tests</p>
                  <h2 id="app-tests-title">Saved journeys</h2>
                </div>
                {tests.data?.length ? (
                  <Link className="relay-inline-action" to="/tests" search={{ app: appId }}>
                    View all <ArrowRight aria-hidden="true" />
                  </Link>
                ) : null}
                <Link className="relay-inline-action" to="/suites" search={{ app: appId }}>
                  Suites <ArrowRight aria-hidden="true" />
                </Link>
              </header>
              {tests.isPending ? (
                <p className="text-sm text-muted-foreground">Loading Tests…</p>
              ) : tests.isError ? (
                <EmptyState
                  title="Tests are temporarily unavailable"
                  detail="The app overview is still available. Open the Tests library when the service responds."
                  action={
                    <Link className="relay-inline-link" to="/tests" search={{ app: appId }}>
                      Open Tests
                    </Link>
                  }
                />
              ) : tests.data?.length ? (
                <ul className="mt-3 list-none overflow-hidden rounded-lg border border-border bg-card p-0">
                  {tests.data.slice(0, 4).map((test) => (
                    <li key={test.id}>
                      <Link to="/tests/$testId" params={{ testId: test.id }}>
                        <span>
                          <strong>{test.name}</strong>
                          <small>
                            {test.stepCount} {test.stepCount === 1 ? "step" : "steps"}
                          </small>
                        </span>
                        <span className="mt-3 list-none overflow-hidden rounded-lg border border-border bg-card p-0-action">
                          Open <span aria-hidden="true">→</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="No saved Tests yet"
                  detail="Record one focused journey through this app."
                  action={
                    <Link className="relay-inline-link" to="/tests/new" search={{ app: appId }}>
                      Record a Test
                    </Link>
                  }
                />
              )}
            </section>

            <section className="min-w-0" aria-labelledby="app-runs-title">
              <header className="relay-section-heading">
                <div>
                  <p className="relay-section-label">Reports</p>
                  <h2 id="app-runs-title">Recent results</h2>
                </div>
                {recentRuns.length ? (
                  <Link className="relay-inline-action" to="/runs" search={{ app: appId }}>
                    View all <ArrowRight aria-hidden="true" />
                  </Link>
                ) : null}
              </header>
              {runs.isPending ? (
                <p className="text-sm text-muted-foreground">Loading recent results…</p>
              ) : runs.isError ? (
                <EmptyState
                  title="Recent results are temporarily unavailable"
                  detail="You can keep working in this app while Run history reconnects."
                  action={
                    <Link className="relay-inline-link" to="/runs" search={{ app: appId }}>
                      Open Runs
                    </Link>
                  }
                />
              ) : recentRuns.length ? (
                <ul className="mt-3 list-none overflow-hidden rounded-lg border border-border bg-card p-0">
                  {recentRuns.map((run) => (
                    <li key={run.id}>
                      <Link to="/runs/$runId" params={{ runId: run.id }}>
                        <span>
                          <strong>{run.testName ?? run.title}</strong>
                          <small>
                            {run.targetName ?? "Device or browser recorded in Report"} ·{" "}
                            {relativeTime(runTime(run))}
                          </small>
                        </span>
                        <OutcomeMark outcome={run.outcome ?? run.phase} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="No Reports yet"
                  detail="Run a saved Test to keep its result and evidence here."
                />
              )}
            </section>
          </div>
          <section className="mt-[34px]" aria-labelledby="app-resources-title">
            <header className="relay-section-heading">
              <div>
                <p className="relay-section-label">Configuration</p>
                <h2 id="app-resources-title">Workspace resources</h2>
              </div>
            </header>
            <div className="mt-3 grid grid-cols-2 gap-2.5 max-[780px]:grid-cols-1">
              <Link to="/versions">
                <span>
                  <strong>Versions</strong>
                  <small>Registered builds and web deployments</small>
                </span>
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link to="/accounts">
                <span>
                  <strong>Accounts</strong>
                  <small>Reviewed browser sign-ins</small>
                </span>
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </section>
          <Collapsible className="mt-[34px] max-w-[620px] border-t border-border">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              Advanced
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 border-t pt-3 text-sm">
              <div>
                <p>Inspect Relay’s known screens, verified paths, and coverage for this app.</p>
                <Link className="relay-inline-link" to="/apps/$appId/map" params={{ appId }}>
                  Open Map
                </Link>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : null}
    </section>
  );
}

function runTime(run: { finishedAt?: number; startedAt?: number; queuedAt: number }): number {
  return run.finishedAt ?? run.startedAt ?? run.queuedAt;
}

function relativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}
