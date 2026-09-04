/** @jsxImportSource react */
import { Button } from "@relay/ui-react";
import type { ProductMapScreen } from "@relay/product/map-exploration";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
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
  const [selectedScreenId, setSelectedScreenId] = useState<string>();
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLElement>(null);
  const selected = map.data?.screens.find((screen) => screen.id === selectedScreenId);
  const visibleScreens = map.data?.screens.slice(0, 500) ?? [];
  const visiblePaths = map.data?.paths.slice(0, 500) ?? [];
  const screenStyle = useMemo(
    () => ({
      transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
      transformOrigin: "top left",
    }),
    [pan.x, pan.y, scale],
  );

  function nudgePan(x: number, y: number) {
    setPan((value) => ({ x: value.x + x, y: value.y + y }));
    canvasRef.current?.focus();
  }

  return (
    <section className="relay-page relay-map-page">
      <Breadcrumbs
        items={[{ label: "Apps" }, { label: map.data?.appName ?? "App" }, { label: "Explore" }]}
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
          <div className="relay-map-toolbar" aria-label="Map controls">
            <Button
              size="small"
              variant="secondary"
              onClick={() => setScale((value) => Math.min(1.5, value + 0.1))}
            >
              Zoom in
            </Button>
            <Button
              size="small"
              variant="secondary"
              onClick={() => setScale((value) => Math.max(0.7, value - 0.1))}
            >
              Zoom out
            </Button>
            <Button
              size="small"
              variant="secondary"
              onClick={() => {
                setScale(1);
                setPan({ x: 0, y: 0 });
                setSelectedScreenId(undefined);
              }}
            >
              Reset view
            </Button>
            <Button size="small" variant="secondary" onClick={() => nudgePan(0, -80)}>
              <span aria-hidden="true">↑</span> Pan up
            </Button>
            <Button size="small" variant="secondary" onClick={() => nudgePan(0, 80)}>
              <span aria-hidden="true">↓</span> Pan down
            </Button>
            <Button size="small" variant="secondary" onClick={() => nudgePan(-80, 0)}>
              <span aria-hidden="true">←</span> Pan left
            </Button>
            <Button size="small" variant="secondary" onClick={() => nudgePan(80, 0)}>
              <span aria-hidden="true">→</span> Pan right
            </Button>
            <span aria-live="polite">{Math.round(scale * 100)}%</span>
          </div>
          {map.data.screens.length ? (
            <section
              className="relay-map-canvas"
              aria-label="Known screens and paths"
              tabIndex={0}
              ref={canvasRef}
            >
              <div className="relay-map-canvas-inner" style={screenStyle}>
                {visiblePaths.map((path) => (
                  <div
                    className="relay-map-path"
                    key={path.id}
                    aria-label={`${path.fromTitle} to ${path.toTitle ?? "finish"}`}
                  >
                    {path.label}
                  </div>
                ))}
                {visibleScreens.map((screen) => (
                  <button
                    type="button"
                    className={`relay-map-screen${selectedScreenId === screen.id ? " relay-map-screen--selected" : ""}`}
                    key={screen.id}
                    aria-pressed={selectedScreenId === screen.id}
                    onClick={() => setSelectedScreenId(screen.id)}
                    style={
                      screen.position
                        ? { left: screen.position.x, top: screen.position.y }
                        : undefined
                    }
                  >
                    <strong>{screen.title}</strong>
                    <small>
                      {screen.coveringTests.length
                        ? `${screen.coveringTests.length} covering ${screen.coveringTests.length === 1 ? "Test" : "Tests"}`
                        : "Not covered yet"}
                    </small>
                  </button>
                ))}
              </div>
            </section>
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
          {selected ? (
            <ScreenDetails screen={selected} />
          ) : (
            <p className="relay-action-hint">
              Select a screen to see its covering Tests and recent failures.
            </p>
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
          <details className="relay-map-developer">
            <summary>Edit Map · Developer Mode</summary>
            <p>
              Editing known screens and paths changes the saved verification source. Open this mode
              only when you intend to review a proposal.
            </p>
            <p>
              {map.data.pendingProposalCount
                ? `${map.data.pendingProposalCount} proposal${map.data.pendingProposalCount === 1 ? "" : "s"} await review.`
                : "There are no pending proposals."}
            </p>
            <Button size="small" variant="secondary" disabled>
              Edit Map is not enabled in Explore
            </Button>
          </details>
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

function ScreenDetails({ screen }: { screen: ProductMapScreen }) {
  return (
    <aside className="relay-map-screen-details" aria-labelledby="screen-details-title">
      <p className="relay-section-label">Known screen</p>
      <h2 id="screen-details-title">{screen.title}</h2>
      {screen.description ? <p>{screen.description}</p> : null}
      <p>
        {screen.variantCount} saved surface {screen.variantCount === 1 ? "variant" : "variants"}.
      </p>
      <h3>Covering Tests</h3>
      {screen.coveringTests.length ? (
        <ul>
          {screen.coveringTests.map((test) => (
            <li key={test.id}>
              <Link to="/tests/$testId" params={{ testId: test.id }}>
                {test.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>No Test covers this screen yet.</p>
      )}
      {screen.recentFailures.length ? (
        <>
          <h3>Recent failures</h3>
          <ul>
            {screen.recentFailures.map((failure) => (
              <li key={failure.id}>
                <Link to="/runs/$runId" params={{ runId: failure.runId }}>
                  {failure.outcome.replaceAll("-", " ")}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </aside>
  );
}
