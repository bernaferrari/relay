/** @jsxImportSource react */
import { Tooltip, TooltipTrigger, TooltipContent } from "@relay/ui-react/components/tooltip";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { Button } from "@relay/ui-react/components/button";
import { Focus, Hand, LocateFixed, Minus, Plus, RotateCcw, X } from "lucide-react";
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
import { Link } from "@tanstack/react-router";

export const MAP_MIN_SCALE = 0.35;
export const MAP_MAX_SCALE = 2.2;
export const MAP_NODE_WIDTH = 208;
export const MAP_NODE_HEIGHT = 88;

export type MapTransform = { x: number; y: number; scale: number };
export type MapPoint = { x: number; y: number };
export type MapBounds = { minX: number; minY: number; maxX: number; maxY: number };

const INITIAL_TRANSFORM: MapTransform = { x: 48, y: 64, scale: 1 };
const MAP_PADDING = 72;

export function clampMapScale(scale: number): number {
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, scale));
}

export function zoomMapAtPoint(
  transform: MapTransform,
  nextScale: number,
  point: MapPoint,
): MapTransform {
  const scale = clampMapScale(nextScale);
  const ratio = scale / transform.scale;
  return {
    x: point.x - (point.x - transform.x) * ratio,
    y: point.y - (point.y - transform.y) * ratio,
    scale,
  };
}

export function fitMapToBounds(
  bounds: MapBounds,
  viewport: { width: number; height: number },
): MapTransform {
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = clampMapScale(
    Math.min(
      1.15,
      Math.max(1, viewport.width - MAP_PADDING * 2) / contentWidth,
      Math.max(1, viewport.height - MAP_PADDING * 2) / contentHeight,
    ),
  );
  return {
    x: (viewport.width - contentWidth * scale) / 2 - bounds.minX * scale,
    y: (viewport.height - contentHeight * scale) / 2 - bounds.minY * scale,
    scale,
  };
}

export function layoutMapScreens(
  screens: readonly ProductMapScreen[],
): ReadonlyMap<string, MapPoint> {
  const columnCount = Math.max(1, Math.ceil(Math.sqrt(screens.length)));
  return new Map(
    screens.map((screen, index) => [
      screen.id,
      screen.position ?? {
        x: (index % columnCount) * 276,
        y: Math.floor(index / columnCount) * 168,
      },
    ]),
  );
}

export function mapContentBounds(
  screens: readonly ProductMapScreen[],
  positions: ReadonlyMap<string, MapPoint>,
): MapBounds {
  if (!screens.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return screens.reduce<MapBounds>(
    (bounds, screen) => {
      const point = positions.get(screen.id) ?? { x: 0, y: 0 };
      return {
        minX: Math.min(bounds.minX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxX: Math.max(bounds.maxX, point.x + MAP_NODE_WIDTH),
        maxY: Math.max(bounds.maxY, point.y + MAP_NODE_HEIGHT),
      };
    },
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

export function InfiniteMapCanvas({
  appId,
  screens,
  paths,
}: {
  appId: string;
  screens: readonly ProductMapScreen[];
  paths: readonly ProductMapPath[];
}) {
  const visibleScreens = useMemo(() => screens.slice(0, 500), [screens]);
  const visiblePaths = useMemo(() => paths.slice(0, 500), [paths]);
  const positions = useMemo(() => layoutMapScreens(visibleScreens), [visibleScreens]);
  const bounds = useMemo(
    () => mapContentBounds(visibleScreens, positions),
    [positions, visibleScreens],
  );
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
  const markerId = `relay-map-arrow-${useId().replaceAll(":", "")}`;

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
  }, [bounds]);

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, a")) return;
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
    dragRef.current = undefined;
    delete event.currentTarget.dataset.panning;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleWheel(event: WheelEvent<HTMLElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const intensity = event.deltaMode === 1 ? 0.025 : event.deltaMode === 2 ? 0.18 : 0.0015;
    const nextScale = transformRef.current.scale * Math.exp(-event.deltaY * intensity);
    applyTransform(zoomMapAtPoint(transformRef.current, nextScale, point));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
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
    <section className="relay-map-workspace" aria-label="App Map explorer">
      <div className="relay-map-stage">
        <div className="relay-map-toolbar" aria-label="Map controls">
          <MapControl label="Zoom out" icon={Minus} onClick={() => zoomBy(1 / 1.18)} />
          <span className="relay-map-zoom" ref={zoomLabelRef} aria-live="polite">
            100%
          </span>
          <MapControl label="Zoom in" icon={Plus} onClick={() => zoomBy(1.18)} />
          <span className="relay-map-toolbar-divider" aria-hidden="true" />
          <MapControl label="Fit map" icon={Focus} onClick={fitContent} />
          <MapControl label="Reset view" icon={RotateCcw} onClick={resetView} />
        </div>
        <p className="relay-map-gesture-hint" id="map-interaction-help">
          <Hand aria-hidden="true" /> Drag to move · Scroll to zoom
        </p>
        <section
          className="relay-map-canvas"
          aria-label="Known screens and verified paths"
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
          <span className="relay-visually-hidden" id="map-keyboard-help">
            Use arrow keys to move, plus and minus to zoom, F to fit the map, or 0 to reset the
            view. Tab to visit each screen.
          </span>
          <div
            className="relay-map-world"
            ref={worldRef}
            style={{ transform: "translate3d(48px, 64px, 0) scale(1)" }}
          >
            <MapEdges paths={visiblePaths} positions={positions} markerId={markerId} />
            {visibleScreens.map((screen) => {
              const position = positions.get(screen.id) ?? { x: 0, y: 0 };
              const selectedNode = selectedScreenId === screen.id;
              return (
                <button
                  type="button"
                  className={`relay-map-screen${selectedNode ? " relay-map-screen--selected" : ""}`}
                  key={screen.id}
                  aria-pressed={selectedNode}
                  onClick={() => setSelectedScreenId(screen.id)}
                  onFocus={() => revealScreen(screen.id)}
                  style={{ left: position.x, top: position.y }}
                >
                  <span className="relay-map-screen-title">{screen.title}</span>
                  <span className="relay-map-screen-meta">
                    {screen.coveringTests.length
                      ? `${screen.coveringTests.length} covering ${screen.coveringTests.length === 1 ? "Test" : "Tests"}`
                      : "Not covered yet"}
                  </span>
                  <span
                    className={`relay-map-screen-state${screen.coveringTests.length ? " relay-map-screen-state--covered" : ""}`}
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
        screen={selected}
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
        render={<Button size="icon" variant="ghost" aria-label={label} onClick={onClick} />}
      >
        <Icon aria-hidden="true" />
      </TooltipTrigger>

      <TooltipContent sideOffset={7} className="relay-map-tooltip">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function MapEdges({
  paths,
  positions,
  markerId,
}: {
  paths: readonly ProductMapPath[];
  positions: ReadonlyMap<string, MapPoint>;
  markerId: string;
}) {
  const geometries = paths.flatMap((path, index) => {
    const from = positions.get(path.fromScreenId);
    if (!from) return [];
    const to = path.toScreenId ? positions.get(path.toScreenId) : undefined;
    // A path whose target is outside the bounded visible set is omitted rather
    // than being misrepresented as a terminal path.
    if (path.toScreenId && !to) return [];
    const start = {
      x: from.x + MAP_NODE_WIDTH,
      y: from.y + MAP_NODE_HEIGHT / 2,
    };
    const end = to
      ? {
          x: to.x,
          y: to.y + MAP_NODE_HEIGHT / 2,
        }
      : { x: start.x + 116, y: start.y };
    const selfLoop = path.toScreenId === path.fromScreenId;
    const labelWidth = Math.min(180, Math.max(44, path.label.length * 6.2 + 18));
    if (selfLoop) {
      const loopTop = from.y - 74;
      return [
        {
          path,
          id: `relay-map-edge-${index}`,
          d: `M ${from.x + MAP_NODE_WIDTH * 0.72} ${from.y} C ${from.x + MAP_NODE_WIDTH * 0.72} ${loopTop}, ${from.x + MAP_NODE_WIDTH * 0.28} ${loopTop}, ${from.x + MAP_NODE_WIDTH * 0.28} ${from.y}`,
          label: { x: from.x + MAP_NODE_WIDTH / 2, y: loopTop - 8, width: labelWidth },
          bounds: {
            minX: from.x + MAP_NODE_WIDTH * 0.28 - 24,
            minY: loopTop - 40,
            maxX: from.x + MAP_NODE_WIDTH * 0.72 + 24,
            maxY: from.y + 24,
          },
        },
      ];
    }
    const backwards = end.x < start.x;
    if (backwards) {
      start.x = from.x;
      if (to) end.x = to.x + MAP_NODE_WIDTH;
    }
    const bend = Math.max(64, Math.abs(end.x - start.x) * 0.48);
    const direction = backwards ? -1 : 1;
    const controlOneX = start.x + bend * direction;
    const controlTwoX = end.x - bend * direction;
    const gap = Math.abs(end.x - start.x);
    const labelY =
      gap < labelWidth + 24 ? Math.min(from.y, to?.y ?? from.y) - 18 : (start.y + end.y) / 2 - 11;
    return [
      {
        path,
        id: `relay-map-edge-${index}`,
        d: `M ${start.x} ${start.y} C ${controlOneX} ${start.y}, ${controlTwoX} ${end.y}, ${end.x} ${end.y}`,
        label: { x: (start.x + end.x) / 2, y: labelY, width: labelWidth },
        bounds: {
          minX: Math.min(start.x, end.x, controlOneX, controlTwoX) - 24,
          minY: Math.min(start.y, end.y) - 40,
          maxX: Math.max(start.x, end.x, controlOneX, controlTwoX) + 24,
          maxY: Math.max(start.y, end.y) + 40,
        },
      },
    ];
  });
  const edgeBounds = geometries.reduce<MapBounds>(
    (result, geometry) => ({
      minX: Math.min(result.minX, geometry.bounds.minX),
      minY: Math.min(result.minY, geometry.bounds.minY),
      maxX: Math.max(result.maxX, geometry.bounds.maxX),
      maxY: Math.max(result.maxY, geometry.bounds.maxY),
    }),
    { minX: -240, minY: -240, maxX: 1800, maxY: 1200 },
  );
  return (
    <svg
      className="relay-map-edges"
      aria-hidden="true"
      viewBox={`${edgeBounds.minX} ${edgeBounds.minY} ${edgeBounds.maxX - edgeBounds.minX} ${edgeBounds.maxY - edgeBounds.minY}`}
      style={{
        left: edgeBounds.minX,
        top: edgeBounds.minY,
        width: edgeBounds.maxX - edgeBounds.minX,
        height: edgeBounds.maxY - edgeBounds.minY,
      }}
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {geometries.map((geometry) => (
        <g key={geometry.path.id} className="relay-map-edge">
          <path id={geometry.id} d={geometry.d} markerEnd={`url(#${markerId})`} />
          <rect
            x={geometry.label.x - geometry.label.width / 2}
            y={geometry.label.y - 14}
            width={geometry.label.width}
            height="22"
            rx="11"
          />
          <text x={geometry.label.x} y={geometry.label.y} textAnchor="middle">
            {geometry.path.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ScreenInspector({
  appId,
  screen,
  onClose,
}: {
  appId: string;
  screen: ProductMapScreen | undefined;
  onClose: () => void;
}) {
  return (
    <aside className="relay-map-inspector" aria-label="Screen details" aria-live="polite">
      {screen ? (
        <>
          <header>
            <div>
              <p className="relay-section-label">Known screen</p>
              <h2>{screen.title}</h2>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Close screen details"
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </Button>
          </header>
          {screen.description ? (
            <p className="relay-map-inspector-description">{screen.description}</p>
          ) : null}
          <dl className="relay-map-inspector-facts">
            <div>
              <dt>Saved variants</dt>
              <dd>{screen.variantCount}</dd>
            </div>
            <div>
              <dt>Covering Tests</dt>
              <dd>{screen.coveringTests.length}</dd>
            </div>
          </dl>
          <section className="relay-map-inspector-section">
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
              <p>No saved Test covers this screen yet.</p>
            )}
          </section>
          {screen.recentFailures.length ? (
            <section className="relay-map-inspector-section">
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
            </section>
          ) : null}
          <Button
            className="relay-map-inspector-action"
            size="sm"
            nativeButton={false}
            render={<Link to="/tests/new" search={{ app: appId }} />}
          >
            Create Test for this app
          </Button>
        </>
      ) : (
        <div className="relay-map-inspector-empty">
          <span aria-hidden="true">
            <LocateFixed />
          </span>
          <h2>Select a screen</h2>
          <p>Choose any screen on the map to inspect its coverage and recent failures.</p>
        </div>
      )}
    </aside>
  );
}
