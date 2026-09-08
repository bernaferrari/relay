import { MapEdges } from "./map-edges";
import {
  INITIAL_TRANSFORM,
  MAP_NODE_WIDTH,
  MAP_NODE_HEIGHT,
  fitMapToBounds,
  zoomMapAtPoint,
  layoutMapScreens,
  mapContentBounds,
  type MapPoint,
  type MapTransform,
} from "./map-canvas-geometry";
export * from "./map-canvas-geometry";
import { ScreenInspector } from "./map-screen-inspector";
/** @jsxImportSource react */
import { MapScreenPreview } from "./map-screen-preview";
import { Tooltip, TooltipTrigger, TooltipContent } from "@relay/ui-react/components/tooltip";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { Button } from "@relay/ui-react/components/button";
import {
  Focus,
  Hand,
  Minus,
  Plus,
  RotateCcw,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  MousePointer2,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

export function InfiniteMapCanvas({
  appId,
  screens,
  paths,
  loadScreenshot,
  onUpdateScreen,
  saving = false,
}: {
  saving?: boolean;
  onUpdateScreen?: (
    screenId: string,
    patch: { title?: string; position?: MapPoint },
  ) => Promise<void>;
  loadScreenshot?: (uri: string) => Promise<Blob>;
  appId: string;
  screens: readonly ProductMapScreen[];
  paths: readonly ProductMapPath[];
}) {
  const visibleScreens = useMemo(() => screens.slice(0, 500), [screens]);
  const visiblePaths = useMemo(() => paths.slice(0, 500), [paths]);
  const [dragged, setDragged] = useState<{ id: string; position: MapPoint }>();
  const nodeDrag = useRef<
    { id: string; start: MapPoint; position: MapPoint; moved: boolean } | undefined
  >(undefined);
  const positions = useMemo(() => {
    const result = new Map(layoutMapScreens(visibleScreens, visiblePaths));
    if (dragged) result.set(dragged.id, dragged.position);
    return result;
  }, [visibleScreens, visiblePaths, dragged]);
  const bounds = useMemo(
    () => mapContentBounds(visibleScreens, positions),
    [positions, visibleScreens],
  );
  const [screenSearch, setScreenSearch] = useState("");
  const [showScreens, setShowScreens] = useState(true);
  const [handTool, setHandTool] = useState(false);
  const [selectedScreenId, setSelectedScreenId] = useState<string>();
  const selected = visibleScreens.find((screen) => screen.id === selectedScreenId);
  const viewportRef = useRef<HTMLElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const transformRef = useRef<MapTransform>(INITIAL_TRANSFORM);
  const dragRef = useRef<
    | {
        pointerId: number;
        origin: MapPoint;
        transform: MapTransform;
      }
    | undefined
  >(undefined);
  const markerId = `${useId().replaceAll(":", "")}`;

  function applyTransform(next: MapTransform) {
    transformRef.current = next;
    if (worldRef.current) {
      worldRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
    }
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(next.scale * 100)}%`;
  }

  function viewportSize() {
    const viewport = viewportRef.current;
    return {
      width: viewport?.clientWidth || 900,
      height: viewport?.clientHeight || 560,
    };
  }

  function fitContent() {
    applyTransform(fitMapToBounds(bounds, viewportSize()));
    viewportRef.current?.focus({ preventScroll: true });
  }

  function resetView() {
    applyTransform(INITIAL_TRANSFORM);
    viewportRef.current?.focus({ preventScroll: true });
  }

  function zoomBy(multiplier: number) {
    const viewport = viewportSize();
    applyTransform(
      zoomMapAtPoint(transformRef.current, transformRef.current.scale * multiplier, {
        x: viewport.width / 2,
        y: viewport.height / 2,
      }),
    );
    viewportRef.current?.focus({ preventScroll: true });
  }

  function revealScreen(screenId: string) {
    const position = positions.get(screenId);
    if (!position) return;
    const viewport = viewportSize();
    const current = transformRef.current;
    const screen = {
      left: current.x + position.x * current.scale,
      top: current.y + position.y * current.scale,
      right: current.x + (position.x + MAP_NODE_WIDTH) * current.scale,
      bottom: current.y + (position.y + MAP_NODE_HEIGHT) * current.scale,
    };
    const horizontalInset = 28;
    const topInset = 76;
    const bottomInset = 42;
    let x = current.x;
    let y = current.y;
    if (screen.left < horizontalInset) x += horizontalInset - screen.left;
    else if (screen.right > viewport.width - horizontalInset) {
      x -= screen.right - (viewport.width - horizontalInset);
    }
    if (screen.top < topInset) y += topInset - screen.top;
    else if (screen.bottom > viewport.height - bottomInset) {
      y -= screen.bottom - (viewport.height - bottomInset);
    }
    if (x !== current.x || y !== current.y) applyTransform({ ...current, x, y });
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const next = fitMapToBounds(bounds, {
        width: viewport?.clientWidth || 900,
        height: viewport?.clientHeight || 560,
      });
      transformRef.current = next;
      if (worldRef.current) {
        worldRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
      }
      if (zoomLabelRef.current) {
        zoomLabelRef.current.textContent = `${Math.round(next.scale * 100)}%`;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [appId, visibleScreens.length]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (selectedScreenId) revealScreen(selectedScreenId);
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedScreenId, showScreens]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let previous = { width: viewport.clientWidth, height: viewport.clientHeight };
    const observer = new ResizeObserver(() => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      const current = transformRef.current;
      applyTransform({
        ...current,
        x: current.x + (width - previous.width) / 2,
        y: current.y + (height - previous.height) / 2,
      });
      previous = { width, height };
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (
      (event.button !== 0 && event.button !== 1) ||
      (!handTool && (event.target as HTMLElement).closest("button, a, input"))
    )
      return;
    dragRef.current = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      transform: transformRef.current,
    };
    event.currentTarget.dataset.panning = "true";
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    applyTransform({
      x: drag.transform.x + event.clientX - drag.origin.x,
      y: drag.transform.y + event.clientY - drag.origin.y,
      scale: drag.transform.scale,
    });
  }

  function endPointerDrag(event: PointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const origin = dragRef.current.origin;
    if (
      Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 3 &&
      !(event.target as HTMLElement).closest("button")
    )
      setSelectedScreenId(undefined);
    dragRef.current = undefined;
    delete event.currentTarget.dataset.panning;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleWheel(event: WheelEvent<HTMLElement>) {
    event.preventDefault();
    if (!event.ctrlKey && !event.metaKey) {
      const current = transformRef.current;
      applyTransform({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY });
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const intensity = event.deltaMode === 1 ? 0.025 : event.deltaMode === 2 ? 0.18 : 0.0015;
    const nextScale = transformRef.current.scale * Math.exp(-event.deltaY * intensity);
    applyTransform(zoomMapAtPoint(transformRef.current, nextScale, point));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest("input, textarea, select")) return;
    event.stopPropagation();
    if (event.key === "Escape") {
      setSelectedScreenId(undefined);
      return;
    }
    if (event.key.toLowerCase() === "h") {
      setHandTool(true);
      return;
    }
    if (event.key.toLowerCase() === "v") {
      setHandTool(false);
      return;
    }
    const distance = event.shiftKey ? 160 : 72;
    const current = transformRef.current;
    const moves: Partial<Record<string, MapTransform>> = {
      ArrowLeft: { ...current, x: current.x + distance },
      ArrowRight: { ...current, x: current.x - distance },
      ArrowUp: { ...current, y: current.y + distance },
      ArrowDown: { ...current, y: current.y - distance },
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      applyTransform(move);
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(1.18);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomBy(1 / 1.18);
    } else if (event.key === "0") {
      event.preventDefault();
      resetView();
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      fitContent();
    }
  }

  return (
    <section
      className="relative flex min-h-0 flex-1 overflow-hidden bg-muted/40"
      aria-label="App Map explorer"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {showScreens ? (
        <aside
          className="z-10 flex w-56 shrink-0 flex-col border-r border-border bg-card max-[800px]:absolute max-[800px]:inset-y-0 max-[800px]:left-0 max-[800px]:shadow-lg"
          aria-label="Screens"
        >
          <div className="flex h-12 items-center justify-between px-3">
            <h2 className="text-xs font-medium">
              Screens <span className="ml-1 text-muted-foreground">{screens.length}</span>
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
              className="h-9 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
            {!visibleScreens.some((screen) =>
              screen.title.toLocaleLowerCase().includes(screenSearch.toLocaleLowerCase()),
            ) ? (
              <p className="p-3 text-xs text-muted-foreground">No matching screens</p>
            ) : null}
            {visibleScreens
              .filter((screen) =>
                screen.title.toLocaleLowerCase().includes(screenSearch.toLocaleLowerCase()),
              )
              .map((screen) => (
                <button
                  key={screen.id}
                  type="button"
                  aria-pressed={screen.id === selectedScreenId}
                  className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${screen.id === selectedScreenId ? "bg-accent text-accent-foreground" : ""}`}
                  onClick={() => {
                    setSelectedScreenId(screen.id);
                    revealScreen(screen.id);
                  }}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded border border-border bg-muted text-[10px] tabular-nums">
                    {visibleScreens.indexOf(screen) + 1}
                  </span>
                  <span className="truncate">{screen.title}</span>
                </button>
              ))}
          </div>
          <div className="border-t border-border p-3 text-xs text-muted-foreground">
            {paths.length} paths ·{" "}
            {screens.filter((screen) => screen.coveringTests.length > 0).length} screens tested
          </div>
        </aside>
      ) : null}
      <div className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm"
          aria-label="Map controls"
        >
          <MapControl
            label={showScreens ? "Toggle screens" : "Show screens"}
            icon={PanelLeftOpen}
            onClick={() => setShowScreens(!showScreens)}
          />
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
            className="relay-map-zoom w-12 text-center font-mono text-xs tabular-nums"
            ref={zoomLabelRef}
            aria-live="polite"
          >
            100%
          </span>
          <MapControl label="Zoom in" icon={Plus} onClick={() => zoomBy(1.18)} />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <MapControl label="Fit map" icon={Focus} onClick={fitContent} />
          <MapControl label="Reset view" icon={RotateCcw} onClick={resetView} />
        </div>
        <p
          className="pointer-events-none absolute left-4 top-4 z-10 text-[11px] text-muted-foreground"
          id="map-interaction-help"
        >
          Scroll to pan · Pinch to zoom
        </p>
        <section
          data-tool={handTool ? "hand" : "select"}
          className="relay-map-canvas data-[tool=hand]:cursor-grab relative h-full min-h-0 w-full flex-1 overflow-hidden bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:20px_20px]"
          aria-label="Screens and verified paths"
          aria-describedby="map-interaction-help map-keyboard-help"
          tabIndex={0}
          ref={viewportRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointerDrag}
          onPointerCancel={endPointerDrag}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
        >
          <span className="relay-visually-hidden sr-only" id="map-keyboard-help">
            Use arrow keys to move, plus and minus to zoom, F to fit the map, or 0 to reset the
            view. Tab to visit each screen.
          </span>
          <div
            className="relay-map-world absolute inset-0 origin-top-left"
            ref={worldRef}
            style={{ transform: "translate3d(48px, 64px, 0) scale(1)" }}
          >
            <MapEdges
              paths={visiblePaths}
              positions={positions}
              markerId={markerId}
              selectedScreenId={selectedScreenId}
            />
            {visibleScreens.map((screen) => {
              const position = positions.get(screen.id) ?? { x: 0, y: 0 };
              const selectedNode = selectedScreenId === screen.id;
              return (
                <button
                  type="button"
                  className={`relay-map-screen absolute flex flex-col justify-center gap-2 rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-[border-color,box-shadow] hover:border-ring focus-visible:outline-2 focus-visible:outline-ring${selectedNode ? " ring-2 ring-primary" : ""}`}
                  key={screen.id}
                  aria-pressed={selectedNode}
                  onClick={() => {
                    if (!handTool) setSelectedScreenId(screen.id);
                  }}
                  onPointerDown={(event) => {
                    if (handTool || !onUpdateScreen || saving || event.button !== 0) return;
                    event.stopPropagation();
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    nodeDrag.current = {
                      id: screen.id,
                      start: { x: event.clientX, y: event.clientY },
                      position,
                      moved: false,
                    };
                  }}
                  onPointerMove={(event) => {
                    const drag = nodeDrag.current;
                    if (!drag || drag.id !== screen.id) return;
                    const dx = (event.clientX - drag.start.x) / transformRef.current.scale;
                    const dy = (event.clientY - drag.start.y) / transformRef.current.scale;
                    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
                    drag.moved = true;
                    setDragged({
                      id: screen.id,
                      position: { x: drag.position.x + dx, y: drag.position.y + dy },
                    });
                  }}
                  onPointerUp={(event) => {
                    const drag = nodeDrag.current;
                    nodeDrag.current = undefined;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    if (drag?.moved && dragged && onUpdateScreen) {
                      void onUpdateScreen(screen.id, { position: dragged.position })
                        .catch(() => undefined)
                        .finally(() => setDragged(undefined));
                    }
                  }}
                  onPointerCancel={() => {
                    nodeDrag.current = undefined;
                    setDragged(undefined);
                  }}
                  onFocus={() => revealScreen(screen.id)}
                  style={{
                    left: position.x,
                    top: position.y,
                    width: MAP_NODE_WIDTH,
                    height: MAP_NODE_HEIGHT,
                  }}
                >
                  <div className="h-[300px] w-full shrink-0">
                    <MapScreenPreview
                      uri={screen.screenshotUri}
                      load={loadScreenshot}
                      title={screen.title}
                    />
                  </div>
                  <span className="line-clamp-2 text-sm font-medium leading-tight">
                    {screen.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {screen.coveringTests.length
                      ? `${screen.coveringTests.length} ${screen.coveringTests.length === 1 ? "test" : "tests"}`
                      : "Not covered yet"}
                  </span>
                  <span
                    className={`text-xs text-muted-foreground${screen.coveringTests.length ? " text-emerald-600" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        </section>
      </div>
      <ScreenInspector
        appId={appId}
        loadScreenshot={loadScreenshot}
        screen={selected}
        paths={visiblePaths}
        onSelectScreen={setSelectedScreenId}
        onRename={onUpdateScreen ? (title) => onUpdateScreen(selected!.id, { title }) : undefined}
        saving={saving}
        onClose={() => {
          setSelectedScreenId(undefined);
          viewportRef.current?.focus({ preventScroll: true });
        }}
      />
    </section>
  );
}

function MapControl({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof Plus;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button size="icon-sm" variant="ghost" aria-label={label} onClick={onClick} />}
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
