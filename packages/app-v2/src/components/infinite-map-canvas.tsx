import { snapMapPreview, type AlignmentGuide } from "./map-alignment";
import { MapAccessibilityOverlay, accessibilityControls } from "./map-accessibility-overlay";
import { MapEdges, isRoutineReturn } from "./map-edges";
import {
  containedImageRect,
  MAP_NODE_TITLE_HEIGHT,
  MAP_NODE_GAP,
  MAP_NODE_IMAGE_HEIGHT,
  INITIAL_TRANSFORM,
  MAP_NODE_WIDTH,
  MAP_NODE_HEIGHT,
  fitMapToBounds,
  zoomMapAtPoint,
  layoutMapScreens,
  mapContentBounds,
  type MapPoint,
  type MapTransform,
  type ImageDimensions,
} from "./map-canvas-geometry";
export * from "./map-canvas-geometry";
import { ScreenInspector } from "./map-screen-inspector";
/** @jsxImportSource react */
import { MapScreenPreview } from "./map-screen-preview";
import { Tooltip, TooltipTrigger, TooltipContent } from "@relay/ui-react/components/tooltip";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { Button } from "@relay/ui-react/components/button";
import { Link } from "@tanstack/react-router";
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
  Scan,
  X,
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
  loadAccessibilityTree,
  onUpdateScreen,
  onRefreshScreen,
  saving = false,
  initialPathId,
}: {
  initialPathId?: string;
  saving?: boolean;
  onRefreshScreen?: (screen: ProductMapScreen) => void;
  onUpdateScreen?: (
    screenId: string,
    patch: { title?: string; position?: MapPoint },
  ) => Promise<void>;
  loadScreenshot?: (uri: string) => Promise<Blob>;
  loadAccessibilityTree?: (uri: string) => Promise<unknown>;
  appId: string;
  screens: readonly ProductMapScreen[];
  paths: readonly ProductMapPath[];
}) {
  const visibleScreens = useMemo(() => screens.slice(0, 500), [screens]);
  const visiblePaths = useMemo(() => paths.slice(0, 500), [paths]);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [dragged, setDragged] = useState<{ id: string; position: MapPoint }>();
  const suppressNodeClick = useRef(false);
  const nodeDrag = useRef<
    | {
        id: string;
        start: MapPoint;
        position: MapPoint;
        moved: boolean;
        members: Map<string, MapPoint>;
      }
    | undefined
  >(undefined);
  const [autoArrange, setAutoArrange] = useState(false);
  const [arrangedEdits, setArrangedEdits] = useState<Map<string, MapPoint>>(() => new Map());
  const positions = useMemo(() => {
    const result = new Map(
      layoutMapScreens(
        autoArrange
          ? visibleScreens.map((screen) => ({ ...screen, position: undefined }))
          : visibleScreens,
        visiblePaths,
      ),
    );
    for (const [id, point] of arrangedEdits) result.set(id, point);
    if (dragged) {
      const drag = nodeDrag.current;
      if (drag)
        for (const [id, origin] of drag.members)
          result.set(id, {
            x: origin.x + dragged.position.x - drag.position.x,
            y: origin.y + dragged.position.y - drag.position.y,
          });
      else result.set(dragged.id, dragged.position);
    }
    return result;
  }, [visibleScreens, visiblePaths, dragged, autoArrange, arrangedEdits]);
  const bounds = useMemo(
    () => mapContentBounds(visibleScreens, positions),
    [positions, visibleScreens],
  );
  const [screenSearch, setScreenSearch] = useState("");
  const [showScreens, setShowScreens] = useState(true);
  const [handTool, setHandTool] = useState(false);
  const [showInteractionTargets, setShowInteractionTargets] = useState(false);
  const [showControlOrigins, setShowControlOrigins] = useState(false);
  const [originTree, setOriginTree] = useState<{ uri: string; value: unknown }>();
  const [imageDimensions, setImageDimensions] = useState<Map<string, ImageDimensions>>(
    () => new Map(),
  );
  const [spacePan, setSpacePan] = useState(false);
  const panningTool = handTool || spacePan;
  const [selectedPathId, setSelectedPathId] = useState(initialPathId);
  const selectedPath = visiblePaths.find((path) => path.id === selectedPathId);
  const [focusScreenId, setFocusScreenId] = useState<string | undefined>(
    selectedPath?.fromScreenId,
  );
  const [selectedScreenId, setSingleScreenId] = useState<string | undefined>(
    selectedPath?.fromScreenId,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number }>();
  function setSelectedScreenId(id: string | undefined) {
    setSingleScreenId(id);
    setSelectedIds(new Set(id ? [id] : []));
  }
  const selected = visibleScreens.find((screen) => screen.id === selectedScreenId);
  useEffect(() => {
    if (!showControlOrigins || !selected?.accessibilityTreeUri || !loadAccessibilityTree) return;
    let cancelled = false;
    const uri = selected.accessibilityTreeUri;
    void loadAccessibilityTree(uri)
      .then((value) => {
        if (!cancelled) setOriginTree({ uri, value });
      })
      .catch(() => {
        if (!cancelled) setOriginTree(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [showControlOrigins, selected?.accessibilityTreeUri, loadAccessibilityTree]);
  const originPaths = visiblePaths.map((path) => {
    if (
      !showControlOrigins ||
      path.sourceAnchor ||
      path.fromScreenId !== selected?.id ||
      originTree?.uri !== selected?.accessibilityTreeUri
    )
      return path;
    const dimensions = imageDimensions.get(path.fromScreenId);
    const target = path.sourceTarget;
    if (!dimensions || !target) return path;
    const controls = accessibilityControls(originTree?.value, dimensions);
    const matches = controls.filter((control) =>
      target.identifier
        ? control.identifier === target.identifier
        : control.label === (target.label ?? target.text),
    );
    const unique = [
      ...new Map(
        matches.map((control) => [
          `${control.x},${control.y},${control.width},${control.height}`,
          control,
        ]),
      ).values(),
    ];
    if (unique.length !== 1) return path;
    const rect = unique[0]!;
    return {
      ...path,
      sourceAnchor: { point: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, rect },
    };
  });
  const viewportRef = useRef<HTMLElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const transformRef = useRef<MapTransform>(INITIAL_TRANSFORM);
  const dragRef = useRef<
    | {
        pointerId: number;
        mode: "pan" | "select";
        base: Set<string>;
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

  function focusScreen(screenId: string) {
    setSelectedScreenId(screenId);
    setFocusScreenId(screenId);
  }

  useEffect(() => {
    if (!focusScreenId) return;
    let focusFrame = 0;
    // Let the inspector resize the viewport before centering the selected screen.
    const frame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => {
        const position = positions.get(focusScreenId);
        if (position)
          applyTransform(
            fitMapToBounds(
              {
                minX: position.x,
                minY: position.y,
                maxX: position.x + MAP_NODE_WIDTH,
                maxY: position.y + MAP_NODE_HEIGHT,
              },
              viewportSize(),
            ),
          );
        setFocusScreenId(undefined);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusFrame);
    };
  }, [focusScreenId]);

  useEffect(() => {
    const release = () => setSpacePan(false);
    const keyup = (event: globalThis.KeyboardEvent) => {
      if (event.code === "Space") release();
    };
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", release);
    };
  }, []);

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

  // Inspector/sidebar changes resize the viewport, not the world. Keep the
  // existing transform until the user explicitly pans, zooms, or focuses.

  function alignedDragPosition(
    drag: NonNullable<typeof nodeDrag.current>,
    event: PointerEvent<HTMLElement>,
  ) {
    const scale = transformRef.current.scale;
    const raw = {
      x: drag.position.x + (event.clientX - drag.start.x) / scale,
      y: drag.position.y + (event.clientY - drag.start.y) / scale,
    };
    if (event.altKey) return { position: raw, guides: [] };
    const boxFor = (id: string, point: MapPoint) =>
      containedImageRect(
        {
          x: point.x,
          y: point.y + MAP_NODE_TITLE_HEIGHT + MAP_NODE_GAP,
          width: MAP_NODE_WIDTH,
          height: MAP_NODE_IMAGE_HEIGHT,
        },
        imageDimensions.get(id) ?? { width: MAP_NODE_WIDTH, height: MAP_NODE_IMAGE_HEIGHT },
        "top",
      )!;
    const neighbors = [...positions]
      .filter(([id]) => !drag.members.has(id))
      .map(([id, point]) => boxFor(id, point));
    const snap = snapMapPreview(boxFor(drag.id, raw), neighbors, scale);
    return { position: { x: raw.x + snap.dx, y: raw.y + snap.dy }, guides: snap.guides };
  }

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (
      (event.button !== 0 && event.button !== 1) ||
      (!panningTool && (event.target as HTMLElement).closest("button, a, input"))
    )
      return;
    dragRef.current = {
      pointerId: event.pointerId,
      mode: panningTool || event.button === 1 ? "pan" : "select",
      base: event.shiftKey ? new Set(selectedIds) : new Set(),
      origin: { x: event.clientX, y: event.clientY },
      transform: transformRef.current,
    };
    if (dragRef.current.mode === "pan") event.currentTarget.dataset.panning = "true";
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.mode === "select") {
      const viewport = event.currentTarget.getBoundingClientRect();
      const box = {
        x: Math.min(drag.origin.x, event.clientX) - viewport.left,
        y: Math.min(drag.origin.y, event.clientY) - viewport.top,
        width: Math.abs(event.clientX - drag.origin.x),
        height: Math.abs(event.clientY - drag.origin.y),
      };
      setMarquee(box);
      const ids = new Set(drag.base);
      for (const [id, point] of positions) {
        const left = point.x * drag.transform.scale + drag.transform.x;
        const top = point.y * drag.transform.scale + drag.transform.y;
        if (
          left < box.x + box.width &&
          left + MAP_NODE_WIDTH * drag.transform.scale > box.x &&
          top < box.y + box.height &&
          top + MAP_NODE_HEIGHT * drag.transform.scale > box.y
        )
          ids.add(id);
      }
      setSelectedIds(ids);
      return;
    }
    applyTransform({
      x: drag.transform.x + event.clientX - drag.origin.x,
      y: drag.transform.y + event.clientY - drag.origin.y,
      scale: drag.transform.scale,
    });
  }

  function endPointerDrag(event: PointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const origin = dragRef.current.origin;
    if (dragRef.current.mode === "select") {
      setSingleScreenId(undefined);
      setSelectedPathId(undefined);
    }
    setMarquee(undefined);
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
    if (
      event.code === "Space" &&
      (event.target === viewportRef.current ||
        (event.target as HTMLElement).closest(".relay-map-screen"))
    ) {
      event.preventDefault();
      setSpacePan(true);
      return;
    }
    if (event.key === "Escape") {
      setSelectedScreenId(undefined);
      setMarquee(undefined);
      dragRef.current = undefined;
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
      if (event.shiftKey && selectedScreenId) focusScreen(selectedScreenId);
      else fitContent();
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
            {screens.filter((screen) => screen.coveringTests.length > 0).length} screens in tests
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
            size="sm"
            variant={showInteractionTargets ? "secondary" : "ghost"}
            aria-pressed={showInteractionTargets}
            title="Inspect control bounds from the selected screen’s saved accessibility tree."
            onClick={() => setShowInteractionTargets((value) => !value)}
          >
            <Scan className="size-4" /> Accessibility
          </Button>
          <Button
            size="sm"
            variant={showControlOrigins ? "secondary" : "ghost"}
            aria-pressed={showControlOrigins}
            onClick={() => setShowControlOrigins((value) => !value)}
            title="Start arrows at uniquely matched saved controls on the selected screen."
          >
            Control origins
          </Button>
          <Button
            size="sm"
            variant={autoArrange ? "secondary" : "ghost"}
            aria-pressed={autoArrange}
            onClick={() => setAutoArrange((value) => !value)}
          >
            Auto arrange
          </Button>
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
          <MapControl label="Fit map (F)" icon={Focus} onClick={fitContent} />
          {selectedScreenId ? (
            <MapControl
              label="Focus screen (Shift F)"
              icon={Scan}
              onClick={() => focusScreen(selectedScreenId)}
            />
          ) : null}
          <MapControl label="Reset view" icon={RotateCcw} onClick={resetView} />
        </div>
        {selectedPath ? (
          <div
            className="absolute left-3 right-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded-lg bg-card p-2 shadow-md"
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
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Close path inspection"
              onClick={() => setSelectedPathId(undefined)}
            >
              <X />
            </Button>
          </div>
        ) : (
          <p
            className="pointer-events-none absolute left-4 top-4 z-10 text-[11px] text-muted-foreground"
            id="map-interaction-help"
          >
            {showControlOrigins &&
            !originPaths.some(
              (path) =>
                path.sourceAnchor && (!selectedScreenId || path.fromScreenId === selectedScreenId),
            )
              ? "Select a screen with a saved matching control · Other arrows use screen edges"
              : "Drag to select · Alt to bypass snapping · Space to pan · Pinch to zoom"}
          </p>
        )}
        <section
          data-tool={panningTool ? "hand" : "select"}
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
          {marquee ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute z-30 border border-blue-400 bg-blue-400/10"
              style={{
                left: marquee.x,
                top: marquee.y,
                width: marquee.width,
                height: marquee.height,
              }}
            />
          ) : null}
          {selectedIds.size > 1 ? (
            <span
              role="status"
              className="pointer-events-none absolute right-4 top-4 z-20 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground"
            >
              {selectedIds.size} screens selected
            </span>
          ) : null}
          <span className="relay-visually-hidden sr-only" id="map-keyboard-help">
            Use arrow keys to move, plus and minus to zoom, F to fit the map, Shift F to focus a
            selected screen, Space to pan, or 0 to reset the view. Tab to visit each screen.
          </span>
          <div
            className="relay-map-world absolute inset-0 origin-top-left"
            ref={worldRef}
            style={{ transform: "translate3d(48px, 64px, 0) scale(1)" }}
          >
            {alignmentGuides.map((guide, index) => (
              <div
                key={index}
                aria-hidden="true"
                className="pointer-events-none absolute z-30 bg-blue-400"
                style={
                  guide.axis === "x"
                    ? {
                        left: guide.value,
                        top: guide.from,
                        width: 1 / transformRef.current.scale,
                        height: guide.to - guide.from,
                      }
                    : {
                        left: guide.from,
                        top: guide.value,
                        width: guide.to - guide.from,
                        height: 1 / transformRef.current.scale,
                      }
                }
              />
            ))}
            <MapEdges
              selectedPathId={selectedPathId}
              paths={originPaths.filter(
                (path) => path.id === selectedPathId || !isRoutineReturn(path),
              )}
              positions={positions}
              markerId={markerId}
              selectedScreenId={selectedScreenId}
              showInteractionTargets={showControlOrigins}
              screens={visibleScreens}
              imageDimensions={imageDimensions}
            />
            {visibleScreens.map((screen) => {
              const position = positions.get(screen.id) ?? { x: 0, y: 0 };
              const selectedNode = selectedScreenId === screen.id || selectedIds.has(screen.id);
              return (
                <button
                  type="button"
                  className={`relay-map-screen absolute flex flex-col gap-2 text-left focus-visible:outline-2 focus-visible:outline-ring`}
                  key={screen.id}
                  aria-pressed={selectedNode}
                  onClick={(event) => {
                    if (suppressNodeClick.current) {
                      suppressNodeClick.current = false;
                      return;
                    }
                    if (panningTool) return;
                    if (event.shiftKey) {
                      setSingleScreenId(undefined);
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (next.has(screen.id)) next.delete(screen.id);
                        else next.add(screen.id);
                        return next;
                      });
                    } else setSelectedScreenId(screen.id);
                  }}
                  onDoubleClick={() => {
                    if (!panningTool) focusScreen(screen.id);
                  }}
                  onPointerDown={(event) => {
                    if (panningTool || !onUpdateScreen || saving || event.button !== 0) return;
                    suppressNodeClick.current = false;
                    event.stopPropagation();
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    nodeDrag.current = {
                      id: screen.id,
                      start: { x: event.clientX, y: event.clientY },
                      position,
                      moved: false,
                      members: new Map(
                        [...positions].filter(([id]) =>
                          selectedIds.has(screen.id) ? selectedIds.has(id) : id === screen.id,
                        ),
                      ),
                    };
                  }}
                  onPointerMove={(event) => {
                    const drag = nodeDrag.current;
                    if (!drag || drag.id !== screen.id) return;
                    const dx = (event.clientX - drag.start.x) / transformRef.current.scale;
                    const dy = (event.clientY - drag.start.y) / transformRef.current.scale;
                    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
                    drag.moved = true;
                    const aligned = alignedDragPosition(drag, event);
                    setAlignmentGuides(aligned.guides);
                    setDragged({ id: screen.id, position: aligned.position });
                  }}
                  onPointerUp={(event) => {
                    const drag = nodeDrag.current;
                    nodeDrag.current = undefined;
                    setAlignmentGuides([]);
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    if (drag?.moved && onUpdateScreen) {
                      suppressNodeClick.current = true;
                      const position = alignedDragPosition(drag, event).position;
                      const updates = [...drag.members].map(
                        ([id, origin]) =>
                          [
                            id,
                            {
                              x: origin.x + position.x - drag.position.x,
                              y: origin.y + position.y - drag.position.y,
                            },
                          ] as const,
                      );
                      setArrangedEdits((current) => new Map([...current, ...updates]));
                      void (async () => {
                        for (const [id, position] of updates) {
                          await onUpdateScreen(id, { position });
                          drag.members.delete(id);
                        }
                      })()
                        .catch(() =>
                          setArrangedEdits((current) => {
                            const next = new Map(current);
                            for (const [id, origin] of drag.members) next.set(id, origin);
                            return next;
                          }),
                        )
                        .finally(() => setDragged(undefined));
                    }
                  }}
                  onPointerCancel={() => {
                    nodeDrag.current = undefined;
                    setDragged(undefined);
                    setAlignmentGuides([]);
                  }}
                  onFocus={() => revealScreen(screen.id)}
                  style={{
                    left: position.x,
                    top: position.y,
                    width: MAP_NODE_WIDTH,
                    height: MAP_NODE_HEIGHT,
                  }}
                >
                  <span
                    className={`flex h-10 w-full shrink-0 items-end justify-center text-center text-[13px] font-medium leading-tight ${selectedNode ? "text-blue-400" : "text-muted-foreground"}`}
                  >
                    <span className="line-clamp-2" title={screen.title}>
                      {screen.title}
                    </span>
                  </span>
                  <div className="relative h-[300px] w-full shrink-0">
                    <MapScreenPreview
                      selected={selectedNode}
                      align="top"
                      uri={screen.screenshotUri}
                      load={loadScreenshot}
                      title={screen.title}
                      onImageDimensions={(dimensions) => {
                        setImageDimensions((current) => {
                          if (
                            current.get(screen.id)?.width === dimensions.width &&
                            current.get(screen.id)?.height === dimensions.height
                          )
                            return current;
                          const next = new Map(current);
                          next.set(screen.id, dimensions);
                          return next;
                        });
                      }}
                    />
                    {showInteractionTargets && selectedNode ? (
                      <MapAccessibilityOverlay
                        uri={screen.accessibilityTreeUri}
                        load={loadAccessibilityTree}
                        image={imageDimensions.get(screen.id)}
                      />
                    ) : null}
                  </div>
                </button>
              );
            })}
            {visibleScreens.map((screen) => {
              const returns = visiblePaths.filter(
                (path) => path.fromScreenId === screen.id && isRoutineReturn(path),
              );
              const position = positions.get(screen.id);
              if (!position || !returns.length) return null;
              const image = containedImageRect(
                {
                  x: position.x,
                  y: position.y + MAP_NODE_TITLE_HEIGHT + MAP_NODE_GAP,
                  width: MAP_NODE_WIDTH,
                  height: MAP_NODE_IMAGE_HEIGHT,
                },
                imageDimensions.get(screen.id) ?? {
                  width: MAP_NODE_WIDTH,
                  height: MAP_NODE_IMAGE_HEIGHT,
                },
                "top",
              );
              if (!image) return null;
              return (
                <div
                  key={`returns-${screen.id}`}
                  className="absolute z-20 flex flex-col items-center gap-1"
                  style={{
                    left: position.x,
                    top: image.y + image.height + 12,
                    width: MAP_NODE_WIDTH,
                  }}
                >
                  {returns.map((path) => (
                    <button
                      key={path.id}
                      type="button"
                      aria-label={`Inspect ${path.label} to ${path.toTitle ?? "previous screen"}`}
                      aria-pressed={selectedPathId === path.id}
                      className="flex max-w-full items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-accent"
                      onClick={() => {
                        setSelectedPathId((current) => (current === path.id ? undefined : path.id));
                        setSelectedScreenId(screen.id);
                      }}
                    >
                      <RotateCcw className="size-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {/^disable\b/i.test(path.label)
                          ? path.label
                          : path.toTitle
                            ? `Back to ${path.toTitle}`
                            : path.label}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      </div>
      <ScreenInspector
        onFocusScreen={() => selectedScreenId && focusScreen(selectedScreenId)}
        loadScreenshot={loadScreenshot}
        screen={selected}
        paths={visiblePaths}
        onSelectScreen={focusScreen}
        onRefresh={onRefreshScreen && selected ? () => onRefreshScreen(selected) : undefined}
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
