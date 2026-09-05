/** @jsxImportSource react */
import { useState } from "react";
import { Input } from "@relay/ui-react/components/input";
import { Button } from "@relay/ui-react/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import { InfiniteMapCanvas } from "../components/infinite-map-canvas";
import { PageHeader } from "../components/page-layout";
import { EmptyState } from "../components/product-patterns";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/apps/$appId/map");

export function MapPage() {
  const { mapService, queryClient } = useRouteContext({ from: "__root__" });
  const { appId } = routeApi.useParams();
  const [pathSearch, setPathSearch] = useState("");
  const map = useQuery({
    queryKey: ["map", appId],
    queryFn: () => mapService.get(appId),
    staleTime: 15_000,
  });
  const proposals = useQuery({
    queryKey: ["map", appId, "proposals"],
    queryFn: () => mapService.listProposals?.(appId) ?? Promise.resolve([]),
    enabled: Boolean(map.data && mapService.listProposals),
    staleTime: 5_000,
  });
  const decideProposal = useMutation({
    mutationFn: async ({
      proposalId,
      decision,
    }: {
      proposalId: string;
      decision: "approve" | "reject";
    }) => {
      const current = map.data;
      if (!current) throw new TypeError("Reload this Map before reviewing a proposal.");
      const operation =
        decision === "approve" ? mapService.approveProposal : mapService.rejectProposal;
      if (!operation) throw new TypeError("Map proposal review is unavailable.");
      return operation({
        appMapId: appId,
        proposalId,
        expectedRevision: current.revision,
        reason: decision === "approve" ? "Reviewed in Relay" : "Rejected in Relay",
      });
    },
    onSuccess: async (next) => {
      queryClient.setQueryData(["map", appId], next);
      await queryClient.invalidateQueries({ queryKey: ["map", appId, "proposals"] });
    },
  });
  const matchingPaths = (map.data?.paths ?? []).filter((path) =>
    [path.label, path.fromTitle, path.toTitle, ...path.coveringTests.map((test) => test.name)]
      .join(" ")
      .toLocaleLowerCase()
      .includes(pathSearch.trim().toLocaleLowerCase()),
  );
  const visibleScreens = map.data?.screens.slice(0, 500) ?? [];
  const visiblePaths = map.data?.paths.slice(0, 500) ?? [];

  return (
    <section className="relay-page mx-auto w-full px-[clamp(20px,3vw,40px)] pt-7 pb-10 h-full min-h-0">
      <PageHeader
        crumbs={[
          { label: "Home", to: "/home" },
          { label: map.data?.appName ?? "App", to: "/apps/$appId", params: { appId } },
        ]}
        title="Explore"
        description="Known screens and verified paths."
      />
      {map.isPending ? <PageLoading label="Loading known screens…" /> : null}
      <RecordingProblem
        error={map.error ?? proposals.error ?? decideProposal.error}
        onRetry={() => {
          void map.refetch();
          void proposals.refetch();
        }}
        retrying={map.isFetching || proposals.isFetching}
      />
      {map.data ? (
        <>
          <section
            className="flex items-center justify-between gap-4"
            aria-labelledby="map-summary-title"
          >
            <div>
              <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                Coverage
              </p>
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
                <Link
                  className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
                  to="/tests/new"
                  search={{ app: appId }}
                >
                  Record a Test
                </Link>
              }
            />
          )}
          <section className="" aria-labelledby="paths-title">
            <div className="flex items-end justify-between gap-5 max-[620px]:items-start max-[620px]:gap-3">
              <div>
                <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                  Journeys
                </p>
                <h2 id="paths-title">Verified paths</h2>
              </div>
              <Link
                className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
                to="/tests/new"
                search={{ app: appId, view: "path" }}
              >
                Create a Test from a path
              </Link>
            </div>
            <label className="mb-2 block text-sm font-medium" htmlFor="map-path-search">
              Search known paths
            </label>
            <Input
              type="search"
              className="max-w-lg"
              id="map-path-search"
              value={pathSearch}
              onChange={(event) => setPathSearch(event.target.value)}
              placeholder="Screen, path, or test name"
            />
            <p className="my-3 text-xs text-muted-foreground" role="status">
              {matchingPaths.length} of {map.data.paths.length} known paths
            </p>
            {matchingPaths.length === 0 ? (
              <EmptyState
                title={pathSearch ? "No matching paths" : "No known paths yet"}
                detail={
                  pathSearch
                    ? "Try another screen or test name."
                    : "Record a test to add a known path."
                }
                action={
                  pathSearch ? (
                    <Button variant="outline" onClick={() => setPathSearch("")}>
                      Clear search
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
            <ul>
              {matchingPaths.map((path) => (
                <li key={path.id}>
                  <Link
                    className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
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
          <Collapsible className="mt-4">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              Edit Map · Developer Mode
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 border-t pt-3 text-sm">
              <p>
                Editing known screens and paths changes the saved verification source. Open this
                mode only when you intend to review a proposal.
              </p>
              <p>
                {map.data.pendingProposalCount
                  ? `${map.data.pendingProposalCount} proposal${map.data.pendingProposalCount === 1 ? "" : "s"} await review.`
                  : "There are no pending proposals."}
              </p>
              {proposals.data?.some((proposal) => proposal.status === "pending") ? (
                <ul className="list-none space-y-2 p-0">
                  {proposals.data
                    .filter((proposal) => proposal.status === "pending")
                    .map((proposal) => (
                      <li key={proposal.id}>
                        <div>
                          <strong>{proposal.title}</strong>
                          <p>
                            {proposal.description ??
                              "Review this proposed change to the saved Map."}
                          </p>
                          <small>Based on revision {proposal.baseRevision}</small>
                        </div>
                        <div>
                          <Button
                            size="sm"
                            variant="default"
                            disabled={decideProposal.isPending}
                            onClick={() =>
                              decideProposal.mutate({
                                proposalId: proposal.id,
                                decision: "approve",
                              })
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={decideProposal.isPending}
                            onClick={() =>
                              decideProposal.mutate({ proposalId: proposal.id, decision: "reject" })
                            }
                          >
                            Reject
                          </Button>
                        </div>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="relay-context-empty rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
                  No proposal needs a decision.
                </p>
              )}
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : null}
      {map.data &&
      (map.data.screens.length > visibleScreens.length ||
        map.data.paths.length > visiblePaths.length) ? (
        <p className="relay-action-hint mt-2 text-xs leading-5 text-muted-foreground">
          Canvas shows the first {visibleScreens.length} screens and {visiblePaths.length} paths.
          Use the searchable path list to review all known paths.
        </p>
      ) : null}
    </section>
  );
}
