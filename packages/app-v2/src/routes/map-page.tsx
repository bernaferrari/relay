/** @jsxImportSource react */
import { Button, Disclosure } from "@relay/ui-react";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import { InfiniteMapCanvas } from "../components/infinite-map-canvas";
import { Breadcrumbs, EmptyState } from "../components/product-patterns";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/apps/$appId/map");

export function MapPage() {
  const { mapService } = useRouteContext({ from: "__root__" });
  const { appId } = routeApi.useParams();
  const map = useQuery({
    queryKey: ["map", appId],
    queryFn: () => mapService.get(appId),
    staleTime: 15_000,
  });
  const visibleScreens = map.data?.screens.slice(0, 500) ?? [];
  const visiblePaths = map.data?.paths.slice(0, 500) ?? [];

  return (
    <section className="relay-page relay-map-page">
      <Breadcrumbs
        items={[
          { label: "Home", to: "/home" },
          { label: map.data?.appName ?? "App", to: "/apps/$appId", params: { appId } },
          { label: "Explore" },
        ]}
      />
      <header className="relay-page-header">
        <p className="relay-eyebrow">Explore</p>
        <h1>{map.data?.appName ?? "App"}</h1>
        <p className="relay-page-description">Known screens and verified paths for this app.</p>
      </header>
      {map.isPending ? <PageLoading label="Loading known screens…" /> : null}
      <RecordingProblem
        error={map.error}
        onRetry={() => void map.refetch()}
        retrying={map.isFetching}
      />
      {map.data ? (
        <>
          <section className="relay-map-summary" aria-labelledby="map-summary-title">
            <div>
              <p className="relay-section-label">Coverage</p>
              <h2 id="map-summary-title">
                {map.data.coverage.coveredScreenCount} of {map.data.coverage.screenCount} screens
                covered
              </h2>
              <p>
                {map.data.coverage.coveredPathCount} of {map.data.coverage.pathCount} paths are
                covered by saved Tests.
              </p>
            </div>
            <dl>
              <div>
                <dt>Saved Tests</dt>
                <dd>{map.data.coverage.testCount}</dd>
              </div>
              <div>
                <dt>Known paths</dt>
                <dd>{map.data.paths.length}</dd>
              </div>
            </dl>
          </section>
          {map.data.screens.length ? (
            <InfiniteMapCanvas appId={appId} screens={visibleScreens} paths={visiblePaths} />
          ) : (
            <EmptyState
              title="No known screens yet"
              detail="Record a Test to give Relay a starting point for exploration."
              action={
                <Link className="relay-inline-link" to="/tests/new">
                  Record a Test
                </Link>
              }
            />
          )}
          <section className="relay-map-paths" aria-labelledby="paths-title">
            <div className="relay-section-heading">
              <div>
                <p className="relay-section-label">Journeys</p>
                <h2 id="paths-title">Verified paths</h2>
              </div>
              <Link
                className="relay-inline-link"
                to="/tests/new"
                search={{ app: appId, view: "path" }}
              >
                Create a Test from a path
              </Link>
            </div>
            <ul>
              {map.data.paths.slice(0, 24).map((path) => (
                <li key={path.id}>
                  <Link
                    className="relay-inline-link"
                    to="/tests/new"
                    search={{
                      app: appId,
                      view: "path",
                      path: path.id,
                    }}
                  >
                    {path.fromTitle} → {path.toTitle ?? "Finish"}
                  </Link>
                  <span>
                    {path.coveringTests.length
                      ? `${path.coveringTests.length} covering Test${path.coveringTests.length === 1 ? "" : "s"}`
                      : "No covering Test yet"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <Disclosure.Root className="relay-map-developer">
            <Disclosure.Trigger>Edit Map · Developer Mode</Disclosure.Trigger>
            <Disclosure.Panel className="relay-map-developer-panel">
              <p>
                Editing known screens and paths changes the saved verification source. Open this
                mode only when you intend to review a proposal.
              </p>
              <p>
                {map.data.pendingProposalCount
                  ? `${map.data.pendingProposalCount} proposal${map.data.pendingProposalCount === 1 ? "" : "s"} await review.`
                  : "There are no pending proposals."}
              </p>
              <Button size="small" variant="secondary" disabled>
                Edit Map is not enabled in Explore
              </Button>
            </Disclosure.Panel>
          </Disclosure.Root>
        </>
      ) : null}
      {map.data &&
      (map.data.screens.length > visibleScreens.length ||
        map.data.paths.length > visiblePaths.length) ? (
        <p className="relay-action-hint">
          Showing the first {visibleScreens.length} screens and {visiblePaths.length} paths. Use the
          list below to review the full set of verified paths.
        </p>
      ) : null}
    </section>
  );
}
