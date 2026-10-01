import { compactMap, type PresentedMapPath } from "./map-presentation";
import { useIsMobile } from "@relay/ui-react/hooks/use-mobile";
import { useMapSelection } from "../hooks/use-map-selection";
import { separateMapScreens } from "./map-layout";
import { snapMapPreview, type AlignmentGuide } from "./map-alignment";
import {
  containedImageRect,
  INITIAL_TRANSFORM,
  fitMapToBounds,
  zoomMapAtPoint,
  layoutMapScreens,
  PORTRAIT_NODE,
  mapContentBounds,
  type MapPoint,
  type MapTransform,
  type ImageDimensions,
} from "./map-canvas-geometry";
export * from "./map-canvas-geometry";
import { ScreenInspector } from "./map-screen-inspector";
import { useMapNodeSize } from "./use-map-node-size";
import { useMapOriginPaths } from "./map-origin-paths";
/** @jsxImportSource react */
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { MapCanvasPanels } from "./infinite-map-canvas-panels";
import { MapCanvasViewport } from "./infinite-map-canvas-viewport";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

/** Screens open no smaller than this; Fit still shows the whole map. */
const MAP_OPEN_SCALE = 0.4;

export function InfiniteMapCanvas({
  appId,
  screens,
  paths,
  loadScreenshot,
  loadAccessibilityTree,
  onUpdateScreen,
  onRefreshScreen,
  onMergeScreen,
  saving = false,
  initialPathId,
  initialScreenId,
  onScreenChange,
  onPathChange,
}: {
  initialPathId?: string;
  initialScreenId?: string;
  onScreenChange?(id: string | undefined): void;
  onPathChange?(id: string | undefined): void;
  saving?: boolean;
  onRefreshScreen?: (screen: ProductMapScreen) => void;
  onMergeScreen?: (screen: ProductMapScreen) => void;
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
  const [showIntermediateScreens, setShowIntermediateScreens] = useState(false);
  const presentation = useMemo(() => {
    const boundedScreens = screens.slice(0, 500);
    const boundedPaths: PresentedMapPath[] = paths.slice(0, 500);
    return showIntermediateScreens
      ? { screens: boundedScreens, paths: boundedPaths }
      : compactMap(boundedScreens, boundedPaths, initialScreenId, initialPathId);
  }, [screens, paths, showIntermediateScreens, initialScreenId, initialPathId]);
  const visibleScreens = useMemo(() => {
    const arranged = layoutMapScreens(presentation.screens, presentation.paths);
    return [...presentation.screens].sort((a, b) => {
      const left = arranged.get(a.id)!;
      const right = arranged.get(b.id)!;
      return left.x - right.x || left.y - right.y || a.id.localeCompare(b.id);
    });
  }, [presentation]);
  const visiblePaths = presentation.paths;
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
  const [layoutMode, setLayoutMode] = useState<"saved" | "aligned" | "staggered" | "horizontal">(
    "aligned",
  );
  const autoArrange = layoutMode !== "saved";
  const [arrangedEdits, setArrangedEdits] = useState<Map<string, MapPoint>>(() => new Map());
  const [layoutAnchors, setLayoutAnchors] = useState<Map<string, ProductMapPath["sourceAnchor"]>>(
    () => new Map(),
  );
  const arrangementPaths = useMemo(
    () =>
      visiblePaths.map((path) => ({
        ...path,
        sourceAnchor: layoutAnchors.get(path.id) ?? path.sourceAnchor,
      })),
    [visiblePaths, layoutAnchors],
  );
  const [imageDimensions, setImageDimensions] = useState<Map<string, ImageDimensions>>(
    () => new Map(),
  );
  const node = useMapNodeSize(appId, imageDimensions);
  const positions = useMemo(() => {
    let result = new Map(
      layoutMapScreens(
        autoArrange
          ? visibleScreens.map((screen) => ({ ...screen, position: undefined }))
          : visibleScreens,
        arrangementPaths,
        layoutMode === "saved" ? "aligned" : layoutMode,
        node,
      ),
    );
    for (const [id, point] of arrangedEdits) result.set(id, point);
    if (arrangedEdits.size)
      result = separateMapScreens(result, new Set(arrangedEdits.keys()), node.width, node.height);
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
  }, [visibleScreens, arrangementPaths, dragged, autoArrange, arrangedEdits, layoutMode, node]);
  const bounds = useMemo(
    () => mapContentBounds(visibleScreens, positions, node),
    [positions, visibleScreens, node],
  );
  const [screenSearch, setScreenSearch] = useState("");
  const isMobile = useIsMobile();
  const [screensPreference, setShowScreens] = useState<boolean | null>(null);
  const showScreens = screensPreference ?? !isMobile;
  const [handTool, setHandTool] = useState(false);
  const [showInteractionTargets, setShowInteractionTargets] = useState(false);
  const [showControlOrigins, setShowControlOrigins] = useState(false);
  const [spacePan, setSpacePan] = useState(false);
  const panningTool = handTool || spacePan;
  const [selectedPathId, setSelectedPathId] = useMapSelection(initialPathId, onPathChange);
  const selectedPath = visiblePaths.find((path) => path.id === selectedPathId);
  const [focusScreenId, setFocusScreenId] = useState<string | undefined>(
    initialScreenId ?? selectedPath?.fromScreenId,
  );
  const [selectedScreenId, setSingleScreenId] = useMapSelection(initialScreenId, onScreenChange);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number }>();
  function setSelectedScreenId(id: string | undefined) {
    setSingleScreenId(id);
    setSelectedIds(new Set(id ? [id] : []));
  }
  const selected = visibleScreens.find((screen) => screen.id === selectedScreenId);
  const originPaths = useMapOriginPaths(
    visibleScreens,
    visiblePaths,
    imageDimensions,
    showControlOrigins,
    loadAccessibilityTree,
  );
  // Resolve ordering as paired trees arrive, not only after a manual reset.
  // Retain the ordering when the overlay is hidden; toggling it off must not
  // move the map back to creation order. Manual positions still override it.
  useEffect(() => {
    if (!showControlOrigins || !autoArrange) return;
    setLayoutAnchors((current) => {
      const next = new Map(current);
      let changed = false;
      for (const path of originPaths) {
        if (!path.sourceAnchor) continue;
        if (JSON.stringify(current.get(path.id)) === JSON.stringify(path.sourceAnchor)) continue;
        next.set(path.id, path.sourceAnchor);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [originPaths, showControlOrigins, autoArrange]);
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

  const navigationFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(navigationFrame.current), []);

  function applyTransform(next: MapTransform, navigating = false) {
    if (!navigating) cancelAnimationFrame(navigationFrame.current);
    transformRef.current = next;
    if (worldRef.current) {
      worldRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
      // Screen titles counter-scale so they stay readable when zoomed out.
      worldRef.current.style.setProperty("--map-zoom", String(next.scale));
    }
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(next.scale * 100)}%`;
  }

  function animateTransform(next: MapTransform) {
    cancelAnimationFrame(navigationFrame.current);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      applyTransform(next);
      return;
    }
    const start = transformRef.current;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 220);
      const eased = 1 - Math.pow(1 - progress, 3);
      applyTransform(
        {
          x: start.x + (next.x - start.x) * eased,
          y: start.y + (next.y - start.y) * eased,
          scale: start.scale + (next.scale - start.scale) * eased,
        },
        true,
      );
      if (progress < 1) navigationFrame.current = requestAnimationFrame(tick);
    };
    navigationFrame.current = requestAnimationFrame(tick);
  }

  function navigationViewportSize() {
    const size = viewportSize();
    return { ...size, width: Math.max(240, size.width - 288) };
  }

  function viewportSize() {
    const viewport = viewportRef.current;
    return {
      width: viewport?.clientWidth || 900,
      height: viewport?.clientHeight || 560,
    };
  }

  function fitContent() {
    applyTransform(
      fitMapToBounds(bounds, selectedScreenId ? navigationViewportSize() : viewportSize()),
    );
    viewportRef.current?.focus({ preventScroll: true });
  }

  function resetView() {
    setLayoutAnchors(new Map(originPaths.map((path) => [path.id, path.sourceAnchor])));
    setArrangedEdits(new Map());
    const resetPositions = layoutMapScreens(
      autoArrange
        ? visibleScreens.map((screen) => ({ ...screen, position: undefined }))
        : visibleScreens,
      originPaths,
      layoutMode === "saved" ? "aligned" : layoutMode,
      node,
    );
    animateTransform(
      fitMapToBounds(
        mapContentBounds(visibleScreens, resetPositions),
        selectedScreenId ? navigationViewportSize() : viewportSize(),
      ),
    );
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
    // Wait for the selected screen to render before animating into view.
    const frame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => {
        const position = positions.get(focusScreenId);
        if (position)
          animateTransform(
            fitMapToBounds(
              {
                minX: position.x,
                minY: position.y,
                maxX: position.x + node.width,
                maxY: position.y + node.height,
              },
              navigationViewportSize(),
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
    const viewport = navigationViewportSize();
    const current = transformRef.current;
    const screen = {
      left: current.x + position.x * current.scale,
      top: current.y + position.y * current.scale,
      right: current.x + (position.x + node.width) * current.scale,
      bottom: current.y + (position.y + node.height) * current.scale,
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
    if (x !== current.x || y !== current.y) animateTransform({ ...current, x, y });
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const next = fitMapToBounds(
        bounds,
        {
          width: Math.max(240, (viewport?.clientWidth || 900) - (selectedScreenId ? 288 : 0)),
          height: viewport?.clientHeight || 560,
        },
        MAP_OPEN_SCALE,
      );
      transformRef.current = next;
      if (worldRef.current) {
        worldRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
        // Screen titles counter-scale so they stay readable when zoomed out.
        worldRef.current.style.setProperty("--map-zoom", String(next.scale));
      }
      if (zoomLabelRef.current) {
        zoomLabelRef.current.textContent = `${Math.round(next.scale * 100)}%`;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [appId, visibleScreens.length, node]);

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
          y: point.y + node.titleHeight + node.gap,
          width: node.width,
          height: node.imageHeight,
        },
        imageDimensions.get(id) ?? { width: node.width, height: node.imageHeight },
        "top",
      )!;
    const neighbors = [...positions]
      .filter(([id]) => !drag.members.has(id))
      .map(([id, point]) => boxFor(id, point));
    const snap = snapMapPreview(boxFor(drag.id, raw), neighbors, scale);
    return { position: { x: raw.x + snap.dx, y: raw.y + snap.dy }, guides: snap.guides };
  }

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    cancelAnimationFrame(navigationFrame.current);
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
          left + node.width * drag.transform.scale > box.x &&
          top < box.y + box.height &&
          top + node.height * drag.transform.scale > box.y
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
        (event.target as HTMLElement).closest('[data-slot="map-screen"]'))
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
      <MapCanvasPanels
        appId={appId}
        screens={screens}
        paths={paths}
        visibleScreens={visibleScreens}
        showIntermediateScreens={showIntermediateScreens}
        setShowIntermediateScreens={(value) => {
          setSelectedPathId(undefined);
          setSelectedScreenId(undefined);
          setShowIntermediateScreens(value);
          setArrangedEdits(new Map());
        }}
        showScreens={showScreens}
        setShowScreens={setShowScreens}
        screenSearch={screenSearch}
        setScreenSearch={setScreenSearch}
        selectedScreenId={selectedScreenId}
        selectScreen={setSelectedScreenId}
        focusScreen={focusScreen}
        revealScreen={revealScreen}
        loadScreenshot={loadScreenshot}
        handTool={handTool}
        setHandTool={setHandTool}
        zoomLabelRef={zoomLabelRef}
        zoomBy={zoomBy}
        fitContent={fitContent}
        showInteractionTargets={showInteractionTargets}
        setShowInteractionTargets={setShowInteractionTargets}
        showControlOrigins={showControlOrigins}
        setShowControlOrigins={setShowControlOrigins}
        layoutMode={layoutMode}
        setLayoutMode={setLayoutMode}
        originPaths={originPaths}
        setLayoutAnchors={setLayoutAnchors}
        setArrangedEdits={setArrangedEdits}
        animateTransform={animateTransform}
        viewportSize={() => (selectedScreenId ? navigationViewportSize() : viewportSize())}
        resetView={resetView}
        selectedPath={selectedPath}
        setSelectedPathId={setSelectedPathId}
      >
        <MapCanvasViewport
          viewportRef={viewportRef}
          panningTool={panningTool}
          marquee={marquee}
          selectedIds={selectedIds}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointerDrag}
          onPointerCancel={endPointerDrag}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          worldProps={{
            worldRef,
            transformRef,
            navigationFrame,
            nodeDrag,
            suppressNodeClick,
            alignmentGuides,
            visibleScreens,
            visiblePaths,
            originPaths,
            positions,
            selectedPathId,
            markerId,
            selectedScreenId,
            selectedIds,
            panningTool,
            showControlOrigins,
            showInteractionTargets,
            imageDimensions,
            node,
            layoutMode,
            loadScreenshot,
            loadAccessibilityTree,
            setImageDimensions,
            onSelectScreen: setSelectedScreenId,
            clearSelectedScreen: () => setSingleScreenId(undefined),
            setSelectedIds,
            onFocusScreen: focusScreen,
            onRevealScreen: revealScreen,
            onSelectPath: (pathId) => setSelectedPathId(pathId),
            alignedDragPosition,
            setAlignmentGuides,
            setDragged,
            setArrangedEdits,
            onUpdateScreen,
            saving,
          }}
        />
      </MapCanvasPanels>
      <ScreenInspector
        onFocusScreen={() => selectedScreenId && focusScreen(selectedScreenId)}
        loadScreenshot={loadScreenshot}
        screen={selected}
        paths={visiblePaths}
        onSelectScreen={focusScreen}
        onSelectPath={setSelectedPathId}
        onRefresh={onRefreshScreen && selected ? () => onRefreshScreen(selected) : undefined}
        onMerge={onMergeScreen && selected ? () => onMergeScreen(selected) : undefined}
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
