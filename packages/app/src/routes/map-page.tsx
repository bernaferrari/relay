import { MapScreenMergeDialog } from "../components/map-screen-merge-dialog";
import { MapScreensPanel } from "../components/map-screens-panel";
/** @jsxImportSource react */
import type { ProductMapOverview } from "@relay/product/map-exploration";
import { useState } from "react";
import { MapPathsPanel } from "../components/map-paths-panel";
import { Button } from "@relay/ui-react/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import { InfiniteMapCanvas } from "../components/infinite-map-canvas";
import { ChevronLeft, MoreHorizontal, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@relay/ui-react/components/dropdown-menu";
import { EmptyState } from "../components/product-patterns";
import { PageLoading, RecordingProblem } from "./recording-shared";
import type { ProductMapScreen } from "@relay/product/map-exploration";
import { MapScreenRefreshDialog } from "../components/map-screen-refresh-dialog";
import { productLinkClassName } from "../lib/class-names";

const routeApi = getRouteApi("/apps/$appId/map");

export function MapPage() {
  const { mapService, productService, queryClient, platform } = useRouteContext({
    from: "__root__",
  });
  const [mergeScreen, setMergeScreen] = useState<{ screen: ProductMapScreen; revision: number }>();
  const [refresh, setRefresh] = useState<{ screen: ProductMapScreen; revision: number }>();
  const { appId } = routeApi.useParams();
  const search = routeApi.useSearch();
  const view = search.view ?? "map";
  const navigate = routeApi.useNavigate();
  const setView = (view: "map" | "paths" | "screens") =>
    void navigate({ search: (previous) => ({ ...previous, view }), replace: true });
  const inspectedScreenId = search.screen;
  const inspectedPathId = search.path;
  const openScreen = (screen: string) =>
    void navigate({ search: { view: "map", screen }, replace: true });
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
  const updateScreen = useMutation({
    mutationFn: async ({
      screenId,
      patch,
    }: {
      screenId: string;
      patch: { title?: string; position?: { x: number; y: number } };
    }) => {
      if (!map.data || !mapService.updateScreen) throw new Error("Screen editing is unavailable.");
      return mapService.updateScreen({
        appMapId: appId,
        screenId,
        expectedRevision:
          queryClient.getQueryData<ProductMapOverview>(["map", appId])?.revision ??
          map.data.revision,
        input: { patch },
      });
    },
    onSuccess: (next) => queryClient.setQueryData(["map", appId], next),
    onError: () => {
      void map.refetch();
    },
  });
  const inspectedPath = map.data?.paths.find((path) => path.id === inspectedPathId);
  const priorityScreens = new Set([
    inspectedScreenId,
    inspectedPath?.fromScreenId,
    inspectedPath?.toScreenId,
  ]);
  const visibleScreens = [...(map.data?.screens ?? [])]
    .sort((a, b) => Number(priorityScreens.has(b.id)) - Number(priorityScreens.has(a.id)))
    .slice(0, 500)
    .sort((a, b) => a.id.localeCompare(b.id));
  const visiblePaths = [...(map.data?.paths ?? [])]
    .sort((a, b) => Number(b.id === inspectedPathId) - Number(a.id === inspectedPathId))
    .slice(0, 500)
    .sort((a, b) => a.id.localeCompare(b.id));

  return (
    <section className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <header
        className={`[-webkit-app-region:drag] grid shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] border-b border-border px-4 py-3 ${platform.platform === "desktop" ? "sm:pl-20" : ""}`}
      >
        <div className="[-webkit-app-region:no-drag] flex min-w-0 flex-1 items-center gap-2">
          <Button
            size="icon-sm"
            variant="ghost"
            nativeButton={false}
            render={<Link to="/apps/$appId" params={{ appId }} />}
            aria-label="Back to app"
          >
            <ChevronLeft />
          </Button>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold">App map</h1>
            <p className="truncate text-xs text-muted-foreground">{map.data?.appName ?? "App"}</p>
          </div>
        </div>
        <div
          className="[-webkit-app-region:no-drag] flex items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5"
          role="group"
          aria-label="Map view"
        >
          {(
            [
              ["map", "Map"],
              ["screens", "Screens"],
              ["paths", "Paths"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              size="sm"
              variant={view === id ? "secondary" : "ghost"}
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="[-webkit-app-region:no-drag] flex shrink-0 items-center justify-end gap-1">
          <Button
            size="sm"
            nativeButton={false}
            render={<Link to="/tests/new" search={{ app: appId }} />}
          >
            <Plus />
            Record test
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="icon-sm" variant="ghost" aria-label="More map actions" />}
            >
              <MoreHorizontal aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem render={<Link to="/sessions" />}>Activity</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {mergeScreen && map.data ? (
        <MapScreenMergeDialog
          screen={mergeScreen.screen}
          screens={map.data.screens}
          loadScreenshot={mapService.loadScreenshot}
          onClose={() => setMergeScreen(undefined)}
          merge={async (sourceScreenId, dryRun) => {
            if (!mapService.consolidateScreens) throw new Error("Screen merging is unavailable.");
            const result = await mapService.consolidateScreens({
              appMapId: appId,
              targetScreenId: mergeScreen.screen.id,
              sourceScreenIds: [sourceScreenId],
              expectedRevision: mergeScreen.revision,
              mode: "same-screen",
              dryRun,
            });
            if (result.applied) {
              queryClient.setQueryData(["map", appId], result.overview);
              await queryClient.invalidateQueries({ queryKey: ["tests"] });
              openScreen(mergeScreen.screen.id);
            }
            return result.preview;
          }}
        />
      ) : null}
      {map.isPending ? <PageLoading label="Loading known screens…" /> : null}
      <RecordingProblem
        layout={map.data ? "compact" : "centered"}
        className={
          map.data
            ? "!absolute right-4 top-16 z-30 !mt-0 !max-w-sm rounded-lg border bg-card p-4 shadow-md"
            : "!mt-0 !max-w-none flex-1"
        }
        error={map.error ?? proposals.error ?? decideProposal.error ?? updateScreen.error}
        onRetry={() => {
          void map.refetch();
          void proposals.refetch();
        }}
        retrying={map.isFetching || proposals.isFetching}
      />
      {map.data ? (
        <>
          {view === "map" && map.data.screens.length > visibleScreens.length ? (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              Showing {visibleScreens.length} of {map.data.screens.length} screens. Use Screens to
              find and open any captured screen.
            </p>
          ) : null}
          {view === "map" ? (
            <>
              {map.data.screens.length ? (
                <InfiniteMapCanvas
                  initialPathId={inspectedPathId}
                  initialScreenId={inspectedScreenId}
                  onScreenChange={(screen) =>
                    void navigate({
                      search: (previous) => ({ ...previous, screen }),
                      replace: true,
                    })
                  }
                  onPathChange={(path) =>
                    void navigate({ search: (previous) => ({ ...previous, path }), replace: true })
                  }
                  loadScreenshot={mapService.loadScreenshot}
                  loadAccessibilityTree={mapService.loadAccessibilityTree}
                  saving={updateScreen.isPending}
                  onUpdateScreen={
                    mapService.updateScreen
                      ? (screenId, patch) =>
                          updateScreen.mutateAsync({ screenId, patch }).then(() => undefined)
                      : undefined
                  }
                  appId={appId}
                  screens={visibleScreens}
                  paths={visiblePaths}
                  onMergeScreen={
                    mapService.consolidateScreens
                      ? (screen) => setMergeScreen({ screen, revision: map.data.revision })
                      : undefined
                  }
                  onRefreshScreen={
                    mapService.prepareRefresh && mapService.applyRefresh
                      ? (screen) => setRefresh({ screen, revision: map.data.revision })
                      : undefined
                  }
                />
              ) : (
                <EmptyState
                  title="No known screens yet"
                  detail="Record a Test to give Relay a starting point for exploration."
                  action={
                    <Link className={productLinkClassName} to="/tests/new" search={{ app: appId }}>
                      Record a Test
                    </Link>
                  }
                />
              )}
            </>
          ) : null}
          {view === "screens" ? (
            <MapScreensPanel
              onOpenScreen={openScreen}
              screens={map.data.screens}
              loadScreenshot={mapService.loadScreenshot}
            />
          ) : null}
          {view === "paths" ? (
            <MapPathsPanel
              onOpenScreen={openScreen}
              appId={appId}
              paths={map.data.paths}
              screens={map.data.screens}
              loadScreenshot={mapService.loadScreenshot}
              onInspect={(id) => {
                void navigate({ search: { view: "map", path: id }, replace: true });
              }}
            />
          ) : null}
          {map.data.pendingProposalCount > 0 ? (
            <Collapsible className="absolute right-4 bottom-4 z-20 max-h-[60vh] w-80 overflow-auto rounded-xl border bg-card px-3 py-1 shadow-lg">
              <CollapsibleTrigger className="flex w-full items-center gap-2 py-2 text-left text-sm font-medium transition-colors hover:text-brand">
                <span className="size-2 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                {map.data.pendingProposalCount} map{" "}
                {map.data.pendingProposalCount === 1 ? "change" : "changes"} to review
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
                                decideProposal.mutate({
                                  proposalId: proposal.id,
                                  decision: "reject",
                                })
                              }
                            >
                              Reject
                            </Button>
                          </div>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
                    No proposal needs a decision.
                  </p>
                )}
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </>
      ) : null}
      {view === "map" &&
      map.data &&
      (map.data.screens.length > visibleScreens.length ||
        map.data.paths.length > visiblePaths.length) ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Canvas shows the first {visibleScreens.length} screens and {visiblePaths.length} paths.
          Use the searchable path list to review all known paths.
        </p>
      ) : null}
      {refresh ? (
        <MapScreenRefreshDialog
          screen={refresh.screen}
          loadScreenshot={mapService.loadScreenshot}
          listTargets={async () => {
            const connection = await productService.connect();
            return productService.presentTargets(connection.targets);
          }}
          prepare={async (target) => {
            const { name: _name, detail: _detail, ...captureTarget } = target;
            const latest = await mapService.get(appId);
            const screen = latest.screens.find((item) => item.id === refresh.screen.id);
            if (!screen)
              throw new Error(
                "This screen was removed. Close this update and choose another screen.",
              );
            queryClient.setQueryData(["map", appId], latest);
            setRefresh({ screen, revision: latest.revision });
            return mapService.prepareRefresh!({
              appMapId: appId,
              screenId: refresh.screen.id,
              expectedRevision: latest.revision,
              target: captureTarget,
            });
          }}
          apply={async (preview) => {
            const next = await mapService.applyRefresh!({
              appMapId: appId,
              screenId: refresh.screen.id,
              expectedRevision: refresh.revision,
              token: preview.token,
            });
            queryClient.setQueryData(["map", appId], next);
          }}
          onClose={() => setRefresh(undefined)}
        />
      ) : null}
    </section>
  );
}
