/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/apps/$appId");

export function AppPage() {
  const { mapService } = useRouteContext({ from: "__root__" });
  const { appId } = routeApi.useParams();
  const app = useQuery({
    queryKey: ["app", appId],
    queryFn: () => mapService.get(appId),
    staleTime: 15_000,
  });
  const loading = app.isPending;
  const error = app.error;
  const retry = () => {
    void app.refetch();
  };

  return (
    <LibraryPage className="max-w-[1040px]">
      {loading ? <PageLoading label="Loading app overview…" /> : null}
      <RecordingProblem error={error} onRetry={retry} retrying={app.isFetching} />
      {app.data && !error ? (
        <>
          <PageHeader
            crumbs={[{ label: "Tests", to: "/tests" }, { label: app.data.appName }]}
            title={app.data.appName}
            description={app.data.description ?? "App settings and coverage."}
            actions={
              <Button nativeButton={false} render={<Link to="/tests" search={{ app: appId }} />}>
                Open tests
              </Button>
            }
          />

          <div className="mt-6 flex flex-wrap gap-4 text-sm">
            <Link
              className="underline-offset-4 hover:underline"
              to="/tests"
              search={{ app: appId }}
            >
              Tests for this app
            </Link>
            <Link
              className="underline-offset-4 hover:underline"
              to="/apps/$appId/map"
              params={{ appId }}
            >
              Coverage map
            </Link>
          </div>
        </>
      ) : null}
    </LibraryPage>
  );
}
