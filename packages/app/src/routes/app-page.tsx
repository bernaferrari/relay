/** @jsxImportSource react */
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { Button } from "@relay/ui-react/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import { Map as MapIcon, Plus } from "lucide-react";
import { MapScreenPreview } from "../components/map-screen-preview";
import { LibraryPage, PageHeader } from "../components/page-layout";
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
    queryKey: ["tests", "app-overview", appId],
    queryFn: () => catalogService.listTests({ appMapId: appId }),
    staleTime: 15_000,
  });
  const visibleTests = tests.data
    ? [...new Map(tests.data.map((test) => [test.id, test])).values()]
    : undefined;
  const loading = app.isPending;
  const error = app.error;
  const retry = () => {
    void app.refetch();
  };

  if (error && !app.data) {
    return (
      <LibraryPage className="flex min-h-full flex-col justify-center !py-8">
        <RecordingProblem
          layout="centered"
          error={error}
          onRetry={retry}
          retrying={app.isFetching}
        />
      </LibraryPage>
    );
  }

  return (
    <LibraryPage className="max-w-5xl">
      {loading ? <PageLoading label="Loading app overview…" /> : null}
      <RecordingProblem error={error} onRetry={retry} retrying={app.isFetching} />
      {app.data ? (
        <>
          <PageHeader
            context="App overview"
            title={app.data.appName}
            description={app.data.description}
            actions={
              <>
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link to="/apps/$appId/map" params={{ appId }} />}
                >
                  <MapIcon /> App map
                </Button>
                <Button
                  nativeButton={false}
                  render={<Link to="/tests/new" search={{ app: appId }} />}
                >
                  <Plus />
                  Record test
                </Button>
              </>
            }
          />

          <div className="grid gap-10">
            <p className="-mt-4 text-sm text-muted-foreground tabular-nums">
              {coverageSummary(app.data.coverage)}
            </p>

            <section aria-labelledby="tests-heading" className="grid gap-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 id="tests-heading" className="mt-1 text-lg font-semibold tracking-tight">
                    Tests
                  </h2>
                </div>
                <Link
                  className="text-sm font-medium text-foreground underline underline-offset-4"
                  to="/tests"
                  search={{ app: appId }}
                >
                  View all
                </Link>
              </div>
              {visibleTests?.length ? (
                <ul className="divide-y divide-border border-y border-border">
                  {visibleTests.slice(0, 5).map((test) => (
                    <li
                      key={test.id}
                      className="flex min-h-14 items-center justify-between gap-4 px-4 py-3"
                    >
                      <Link
                        className="min-w-0 truncate text-sm font-medium text-foreground underline-offset-4 hover:underline"
                        to="/tests/$testId"
                        params={{ testId: test.id }}
                      >
                        {test.name}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {test.stepCount} step{test.stepCount === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : tests.isError ? (
                <RecordingProblem
                  error={tests.error}
                  onRetry={() => {
                    void tests.refetch();
                  }}
                  retrying={tests.isFetching}
                />
              ) : tests.isPending ? (
                <p className="text-sm text-muted-foreground">Loading saved tests…</p>
              ) : (
                <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No tests saved for this app yet.
                </p>
              )}
            </section>

            <section aria-labelledby="screens-heading" className="grid gap-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="screens-heading" className="mt-1 text-lg font-semibold tracking-tight">
                    Screens
                  </h2>
                </div>
                {app.data.screens.length > 4 ? (
                  <Link
                    className="text-sm font-medium text-foreground underline underline-offset-4"
                    to="/apps/$appId/map"
                    params={{ appId }}
                    search={{ view: "screens" }}
                  >
                    View all {app.data.screens.length} screens
                  </Link>
                ) : null}
              </div>
              {app.data.screens.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {app.data.screens.slice(0, 4).map((screen) => (
                    <article key={screen.id} className="min-w-0">
                      <Dialog>
                        <DialogTrigger
                          className="block h-64 w-full cursor-zoom-in rounded-sm outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring sm:h-72"
                          aria-label={`Preview ${screen.title}`}
                        >
                          <MapScreenPreview
                            uri={screen.screenshotUri}
                            load={mapService.loadScreenshot}
                            title={screen.title}
                          />
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-2xl motion-reduce:animate-none">
                          <DialogTitle className="pr-8">{screen.title}</DialogTitle>
                          <DialogDescription>Saved Map appearance</DialogDescription>
                          <div className="h-[min(70dvh,760px)] min-h-0">
                            <MapScreenPreview
                              uri={screen.screenshotUri}
                              load={mapService.loadScreenshot}
                              title={screen.title}
                            />
                          </div>
                        </DialogContent>
                      </Dialog>
                      <div className="grid gap-1 pt-3 text-center">
                        <h3 className="truncate text-sm font-medium" title={screen.title}>
                          {screen.title}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {screen.coveringTests.length
                            ? `${screen.coveringTests.length} test${screen.coveringTests.length === 1 ? "" : "s"}`
                            : "No test yet"}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  Record a test to start building this app map.
                </p>
              )}
            </section>
          </div>
        </>
      ) : null}
    </LibraryPage>
  );
}

function coverageSummary(coverage: {
  screenCount: number;
  pathCount: number;
  testCount: number;
  coveredScreenCount: number;
}): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  if (!coverage.screenCount) return `${plural(coverage.testCount, "test")} · no screens mapped yet`;
  return [
    plural(coverage.testCount, "test"),
    plural(coverage.screenCount, "screen"),
    `${coverage.coveredScreenCount} of ${coverage.screenCount} screens covered by tests`,
  ].join(" · ");
}
