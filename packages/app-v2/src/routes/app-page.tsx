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
  const loading = app.isPending || tests.isPending || runs.isPending;
  const error = app.error ?? tests.error ?? runs.error;
  const retry = () => {
    void app.refetch();
    void tests.refetch();
    void runs.refetch();
  };
  const recentRuns = [...(runs.data ?? [])]
    .sort((left, right) => runTime(right) - runTime(left))
    .slice(0, 3);

  return (
    <section className="relay-page relay-app-page">
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
          <header className="relay-page-header relay-app-header">
            <div>
              <p className="relay-eyebrow">App</p>
              <h1>{app.data.appName}</h1>
              <p className="relay-page-description">
                {app.data.description ??
                  "Saved Tests, recent Reports, and known behavior in one place."}
              </p>
            </div>
            <div className="relay-app-actions">
              <Button
                nativeButton={false}
                render={<Link to="/tests/new" search={{ app: appId }} />}
                variant="default"
              >
                Record a Test
              </Button>
            </div>
          </header>

          <dl className="relay-app-facts" aria-label={`${app.data.appName} overview`}>
            <div>
              <dt>Saved Tests</dt>
              <dd>{tests.data?.length ?? app.data.coverage.testCount}</dd>
            </div>
            <div>
              <dt>Reports</dt>
              <dd>{runs.data?.length ?? 0}</dd>
            </div>
            <div>
              <dt>Screen coverage</dt>
              <dd>
                {app.data.coverage.coveredScreenCount} of {app.data.coverage.screenCount}
              </dd>
            </div>
          </dl>

          <div className="relay-app-workspace">
            <section className="relay-app-section" aria-labelledby="app-tests-title">
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
              </header>
              {tests.data?.length ? (
                <ul className="relay-app-list">
                  {tests.data.slice(0, 4).map((test) => (
                    <li key={test.id}>
                      <Link to="/tests/$testId" params={{ testId: test.id }}>
                        <span>
                          <strong>{test.name}</strong>
                          <small>
                            {test.stepCount} {test.stepCount === 1 ? "step" : "steps"}
                          </small>
                        </span>
                        <span className="relay-app-list-action">
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

            <section className="relay-app-section" aria-labelledby="app-runs-title">
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
              {recentRuns.length ? (
                <ul className="relay-app-list">
                  {recentRuns.map((run) => (
                    <li key={run.id}>
                      <Link to="/runs/$runId" params={{ runId: run.id }}>
                        <span>
                          <strong>{run.testName ?? run.title}</strong>
                          <small>{run.targetName ?? "Device or browser recorded in Report"}</small>
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
          <section className="relay-app-resources" aria-labelledby="app-resources-title">
            <header className="relay-section-heading">
              <div>
                <p className="relay-section-label">Configuration</p>
                <h2 id="app-resources-title">App resources</h2>
              </div>
            </header>
            <div className="relay-app-resource-links">
              <Link to="/suites" search={{ app: appId }}>
                <span>
                  <strong>Suites</strong>
                  <small>Reusable groups of Tests and Data sets</small>
                </span>
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link to="/apps/$appId/versions" params={{ appId }}>
                <span>
                  <strong>Versions</strong>
                  <small>Registered builds and web deployments</small>
                </span>
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link to="/apps/$appId/accounts" params={{ appId }}>
                <span>
                  <strong>Accounts</strong>
                  <small>Reviewed browser sign-ins</small>
                </span>
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </section>
          <Collapsible className="relay-app-advanced">
            <CollapsibleTrigger>Advanced</CollapsibleTrigger>
            <CollapsibleContent>
              <div>
                <p>Inspect Relay’s known screens, verified paths, and coverage for this app.</p>
                <Link className="relay-inline-link" to="/apps/$appId/map" params={{ appId }}>
                  Open App Map
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
