import type { PresentedMapPath } from "./map-presentation";
/** @jsxImportSource react */
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Link } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@relay/ui-react/components/dropdown-menu";
import { Button } from "@relay/ui-react/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@relay/ui-react/components/tooltip";
import {
  Focus,
  Hand,
  Minus,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { MapScreenPreview } from "./map-screen-preview";
import {
  fitMapToBounds,
  layoutMapScreens,
  mapContentBounds,
  type MapPoint,
  type MapTransform,
} from "./map-canvas-geometry";

type LayoutMode = "saved" | "aligned" | "staggered" | "horizontal";

export function MapCanvasPanels({
  appId,
  screens,
  paths,
  visibleScreens,
  showIntermediateScreens,
  setShowIntermediateScreens,
  showScreens,
  setShowScreens,
  screenSearch,
  setScreenSearch,
  selectedScreenId,
  selectScreen,
  focusScreen,
  revealScreen,
  loadScreenshot,
  handTool,
  setHandTool,
  zoomLabelRef,
  zoomBy,
  fitContent,
  showInteractionTargets,
  setShowInteractionTargets,
  showControlOrigins,
  setShowControlOrigins,
  layoutMode,
  setLayoutMode,
  originPaths,
  setLayoutAnchors,
  setArrangedEdits,
  animateTransform,
  viewportSize,
  resetView,
  selectedPath,
  setSelectedPathId,
  children,
}: {
  appId: string;
  screens: readonly ProductMapScreen[];
  paths: readonly ProductMapPath[];
  visibleScreens: readonly ProductMapScreen[];
  showIntermediateScreens: boolean;
  setShowIntermediateScreens: (value: boolean) => void;
  showScreens: boolean;
  setShowScreens: (value: boolean) => void;
  screenSearch: string;
  setScreenSearch: Dispatch<SetStateAction<string>>;
  selectedScreenId: string | undefined;
  selectScreen: (id: string | undefined) => void;
  focusScreen: (id: string) => void;
  revealScreen: (id: string) => void;
  loadScreenshot?: (uri: string) => Promise<Blob>;
  handTool: boolean;
  setHandTool: (value: boolean) => void;
  zoomLabelRef: { current: HTMLSpanElement | null };
  zoomBy: (multiplier: number) => void;
  fitContent: () => void;
  showInteractionTargets: boolean;
  setShowInteractionTargets: (value: boolean) => void;
  showControlOrigins: boolean;
  setShowControlOrigins: (value: boolean) => void;
  layoutMode: LayoutMode;
  setLayoutMode: (value: LayoutMode) => void;
  originPaths: readonly ProductMapPath[];
  setLayoutAnchors: (value: Map<string, ProductMapPath["sourceAnchor"]>) => void;
  setArrangedEdits: (value: Map<string, MapPoint>) => void;
  animateTransform: (next: MapTransform) => void;
  viewportSize: () => { width: number; height: number };
  resetView: () => void;
  selectedPath: PresentedMapPath | undefined;
  setSelectedPathId: (value: string | undefined) => void;
  children: ReactNode;
}) {
  return (
    <>
      {showScreens ? (
        <aside
          className="z-10 flex w-56 shrink-0 flex-col border-r border-border bg-card max-[800px]:absolute max-[800px]:inset-y-0 max-[800px]:left-0 max-[800px]:shadow-lg"
          aria-label="Screens"
        >
          <div className="flex h-12 items-center justify-between px-3">
            <h2 className="text-xs font-medium">
              Screens <span className="ml-1 text-muted-foreground">{visibleScreens.length}</span>
            </h2>
            <MapControl
              label="Hide screens"
              icon={PanelLeftClose}
              onClick={() => setShowScreens(false)}
            />
          </div>
          <div className="relative mx-3 mb-3">
            <Search className="absolute left-2 top-2.5 size-3.5 text-muted-foreground" />
            <input
              aria-label="Find screen"
              placeholder="Find screen…"
              value={screenSearch}
              onChange={(event) => setScreenSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setScreenSearch("");
                if (event.key === "Enter") {
                  const match = visibleScreens.find((screen) =>
                    screen.title
                      .toLocaleLowerCase()
                      .includes(screenSearch.trim().toLocaleLowerCase()),
                  );
                  if (match) focusScreen(match.id);
                }
              }}
              className="h-9 w-full rounded-md border border-input bg-background pl-7 pr-8 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {screenSearch ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Clear screen search"
                className="absolute right-0.5 top-0.5"
                onClick={() => setScreenSearch("")}
              >
                <X />
              </Button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
            {!visibleScreens.some((screen) =>
              screen.title.toLocaleLowerCase().includes(screenSearch.trim().toLocaleLowerCase()),
            ) ? (
              <p className="p-3 text-xs text-muted-foreground">No matching screens</p>
            ) : null}
            {visibleScreens
              .filter((screen) =>
                screen.title.toLocaleLowerCase().includes(screenSearch.trim().toLocaleLowerCase()),
              )
              .map((screen) => (
                <button
                  key={screen.id}
                  type="button"
                  aria-pressed={screen.id === selectedScreenId}
                  className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${screen.id === selectedScreenId ? "bg-accent text-accent-foreground" : ""}`}
                  onClick={() => {
                    selectScreen(screen.id);
                    revealScreen(screen.id);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-12 w-10 shrink-0 items-center justify-center rounded bg-muted/40 p-1"
                  >
                    <MapScreenPreview
                      uri={screen.screenshotUri}
                      load={loadScreenshot}
                      title={screen.title}
                      thumbnail
                    />
                  </span>
                  <span className="min-w-0 line-clamp-2 leading-4">{screen.title}</span>
                </button>
              ))}
          </div>
          <div className="border-t border-border p-3 text-xs text-muted-foreground">
            {!showIntermediateScreens && Math.min(screens.length, 500) > visibleScreens.length ? (
              <button
                type="button"
                className="mb-2 block text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => setShowIntermediateScreens(true)}
              >
                Show {Math.min(screens.length, 500) - visibleScreens.length} intermediate screens
              </button>
            ) : null}
            {paths.length} paths ·{" "}
            {screens.filter((screen) => screen.coveringTests.length > 0).length} screens in tests
          </div>
        </aside>
      ) : null}
      <div className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        {!showScreens ? (
          <div className="absolute left-3 top-3 z-20 rounded-md border border-border bg-card p-1 shadow-sm">
            <MapControl
              label="Show screens"
              icon={PanelLeftOpen}
              onClick={() => setShowScreens(true)}
            />
          </div>
        ) : null}
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm"
          aria-label="Map controls"
        >
          <Button
            size="icon-sm"
            variant={handTool ? "ghost" : "secondary"}
            aria-label="Select tool"
            aria-pressed={!handTool}
            onClick={() => setHandTool(false)}
          >
            <MousePointer2 />
          </Button>
          <Button
            size="icon-sm"
            variant={handTool ? "secondary" : "ghost"}
            aria-label="Hand tool"
            aria-pressed={handTool}
            onClick={() => setHandTool(true)}
          >
            <Hand />
          </Button>
          <span className="mx-1 h-5 w-px bg-border" />
          <MapControl label="Zoom out" icon={Minus} onClick={() => zoomBy(1 / 1.18)} />
          <span
            data-slot="map-zoom"
            className="w-12 text-center font-mono text-xs tabular-nums"
            ref={zoomLabelRef}
            aria-live="polite"
          >
            100%
          </span>
          <MapControl label="Zoom in" icon={Plus} onClick={() => zoomBy(1.18)} />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <MapControl label="Fit map (F)" icon={Focus} onClick={fitContent} />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="icon-sm" variant="ghost" />}
              aria-label="Map view options"
              title="Map view options"
            >
              <SlidersHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-56">
              <DropdownMenuCheckboxItem checked={showScreens} onCheckedChange={setShowScreens}>
                Screen list
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={showIntermediateScreens}
                onCheckedChange={setShowIntermediateScreens}
              >
                Intermediate screens
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={showInteractionTargets}
                onCheckedChange={setShowInteractionTargets}
              >
                Accessibility bounds
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={showControlOrigins}
                onCheckedChange={setShowControlOrigins}
              >
                Arrows from controls
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={layoutMode}
                onValueChange={(value) => {
                  const mode = value as LayoutMode;
                  setLayoutMode(mode);
                  setLayoutAnchors(
                    new Map(originPaths.map((path) => [path.id, path.sourceAnchor])),
                  );
                  setArrangedEdits(new Map());
                  const next = layoutMapScreens(
                    mode === "saved"
                      ? visibleScreens
                      : visibleScreens.map((screen) => ({ ...screen, position: undefined })),
                    originPaths,
                    mode === "saved" ? "aligned" : mode,
                  );
                  animateTransform(
                    fitMapToBounds(mapContentBounds(visibleScreens, next), viewportSize()),
                  );
                }}
              >
                <DropdownMenuRadioItem value="aligned">Aligned layout</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="staggered">
                  Staggered · Vertical
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="horizontal">
                  Aligned · Horizontal
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="saved">Saved positions</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {selectedScreenId ? (
                <DropdownMenuItem onClick={() => focusScreen(selectedScreenId)}>
                  Focus selected screen
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={resetView}>Reset view</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {selectedPath ? (
          <div
            className={`absolute right-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded-lg bg-card p-2 shadow-md ${showScreens ? "left-3" : "left-16"}`}
            aria-label="Selected path"
          >
            <Button
              size="sm"
              variant="ghost"
              onClick={() => focusScreen(selectedPath.fromScreenId)}
            >
              {selectedPath.fromTitle}
            </Button>
            <span className="text-xs text-muted-foreground">→ {selectedPath.label} →</span>
            {selectedPath.toScreenId ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => focusScreen(selectedPath.toScreenId!)}
              >
                {selectedPath.toTitle}
              </Button>
            ) : (
              <span className="text-xs">Finish</span>
            )}
            {paths.filter(
              (path) =>
                path.fromScreenId === selectedPath.fromScreenId &&
                path.toScreenId === selectedPath.toScreenId,
            ).length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
                  Choose path
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {paths
                    .filter(
                      (path) =>
                        path.fromScreenId === selectedPath.fromScreenId &&
                        path.toScreenId === selectedPath.toScreenId,
                    )
                    .map((path) => (
                      <DropdownMenuItem key={path.id} onClick={() => setSelectedPathId(path.id)}>
                        {path.label}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {selectedPath.intermediateScreens?.length ? (
              <Button size="sm" variant="outline" onClick={() => setShowIntermediateScreens(true)}>
                Show intermediate screens
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    to="/tests/new"
                    search={{ app: appId, view: "path", path: selectedPath.id }}
                  />
                }
              >
                Create test
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Close path inspection"
              onClick={() => setSelectedPathId(undefined)}
            >
              <X />
            </Button>
          </div>
        ) : null}
        {children}
      </div>
    </>
  );
}

function MapControl({
  label,
  icon: Icon,
  onClick,
  pressed,
}: {
  label: string;
  icon: typeof Plus;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant={pressed ? "secondary" : "ghost"}
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
          />
        }
      >
        <Icon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent
        sideOffset={7}
        className="rounded-md border border-border bg-card px-2 py-1 text-xs shadow-md"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
