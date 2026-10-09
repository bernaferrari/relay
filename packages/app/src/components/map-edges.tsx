/** @jsxImportSource react */
import { useState, type CSSProperties } from "react";
import type { PresentedMapPath } from "./map-presentation";
import { isRoutineReturn } from "./map-edge-paths";
import {
  arrowHead,
  midpointAlong,
  routeReturns,
  roundedPath,
  routeElbows,
  type CardBox,
} from "./map-edge-routing";
import {
  containedImageRect,
  PORTRAIT_NODE,
  type ImageDimensions,
  type MapBounds,
  type MapNodeSize,
  type MapPoint,
} from "./map-canvas-geometry";
export { isRoutineReturn } from "./map-edge-paths";

type Geometry = {
  path: PresentedMapPath;
  d: string;
  arrow: string;
  label: MapPoint;
  returning: boolean;
  anchor?: MapPoint;
};

/**
 * Connections between screens. Forward moves are always drawn, quietly, behind
 * the cards. Moves back to an earlier screen appear only for the selected
 * screen or path. Labels appear only for the path under the pointer or the
 * selected one, so the map reads as screens first.
 */
export function MapEdges({
  paths,
  positions,
  selectedScreenId,
  selectedPathId,
  onSelectPath,
  showInteractionTargets = false,
  screens,
  imageDimensions,
  node = PORTRAIT_NODE,
}: {
  paths: readonly PresentedMapPath[];
  positions: ReadonlyMap<string, MapPoint>;
  selectedScreenId?: string;
  selectedPathId?: string;
  onSelectPath?: (id: string) => void;
  showInteractionTargets?: boolean;
  screens: readonly { id: string; screenshotUri?: string }[];
  imageDimensions: ReadonlyMap<string, ImageDimensions>;
  node?: MapNodeSize;
}) {
  const [hoveredPathId, setHoveredPathId] = useState<string>();
  const activePathId = hoveredPathId ?? selectedPathId;
  const card = (id: string): CardBox | undefined => {
    const point = positions.get(id);
    return point ? { x: point.x, y: point.y, width: node.width, height: node.height } : undefined;
  };
  const image = (id: string): CardBox | undefined => {
    const point = positions.get(id);
    if (!point) return undefined;
    const frame = {
      x: point.x,
      y: point.y + node.titleHeight + node.gap,
      width: node.width,
      height: node.imageHeight,
    };
    const hasShot = screens.some((screen) => screen.id === id && screen.screenshotUri);
    return (
      (hasShot
        ? containedImageRect(frame, imageDimensions.get(id) ?? { width: 0, height: 0 }, "top")
        : undefined) ?? frame
    );
  };
  const columns = new Map<number, CardBox[]>();
  for (const id of positions.keys()) {
    const box = card(id)!;
    columns.set(box.x, [...(columns.get(box.x) ?? []), box]);
  }

  // Each forward connection gets its own port: outgoing ones spread down the
  // source's right edge in the order of their targets, incoming ones down the
  // target's left edge in the order of their sources. No shared bus.
  const isForward = (path: PresentedMapPath) => {
    const from = positions.get(path.fromScreenId);
    const to = path.toScreenId ? positions.get(path.toScreenId) : undefined;
    return Boolean(from && to && to.x > from.x && !isRoutineReturn(path));
  };
  const forwardPaths = paths.filter(isForward);
  const port = (box: CardBox, index: number, count: number) =>
    box.y + box.height * (count <= 1 ? 0.5 : 0.25 + (0.5 * index) / (count - 1));
  const portIndex = (
    path: PresentedMapPath,
    side: "fromScreenId" | "toScreenId",
    other: "fromScreenId" | "toScreenId",
  ) => {
    const siblings = forwardPaths
      .filter((candidate) => candidate[side] === path[side])
      .sort(
        (a, b) =>
          (positions.get(a[other]!)?.y ?? 0) - (positions.get(b[other]!)?.y ?? 0) ||
          a.id.localeCompare(b.id),
      );
    return {
      index: siblings.findIndex((candidate) => candidate.id === path.id),
      count: siblings.length,
    };
  };

  const ends = new Map<string, { start: MapPoint; end: MapPoint; anchor?: MapPoint }>();
  for (const path of forwardPaths) {
    const sourceCard = card(path.fromScreenId)!;
    const targetCard = card(path.toScreenId!)!;
    const source = image(path.fromScreenId)!;
    const target = image(path.toScreenId!)!;
    const anchor =
      showInteractionTargets && path.sourceAnchor
        ? {
            x: source.x + path.sourceAnchor.point.x * source.width,
            y: source.y + path.sourceAnchor.point.y * source.height,
          }
        : undefined;
    // Outgoing moves leave from one port and share a trunk per direction;
    // incoming moves land on separate ports so their sources stay distinct.
    const inc = portIndex(path, "toScreenId", "fromScreenId");
    ends.set(path.id, {
      start: {
        x: sourceCard.x + sourceCard.width + 8,
        y: anchor?.y ?? source.y + source.height / 2,
      },
      end: { x: targetCard.x - 8, y: port(target, inc.index, inc.count) },
      ...(anchor ? { anchor } : {}),
    });
  }
  const routes = routeElbows(
    [...ends].map(([id, { start, end }]) => ({ id, start, end })),
    columns,
    node.width,
  );

  // Returns are shown only for the selected screen or the active path.
  const shownReturns = paths.filter(
    (path) =>
      path.toScreenId &&
      path.toScreenId !== path.fromScreenId &&
      !routes.has(path.id) &&
      positions.has(path.fromScreenId) &&
      positions.has(path.toScreenId) &&
      (path.id === activePathId ||
        path.fromScreenId === selectedScreenId ||
        path.toScreenId === selectedScreenId),
  );
  const returnRoutes = routeReturns(
    shownReturns.map((path) => {
      const source = image(path.fromScreenId)!;
      const target = image(path.toScreenId!)!;
      return {
        id: path.id,
        source: card(path.fromScreenId)!,
        target: card(path.toScreenId!)!,
        sourceY: source.y + source.height * 0.8,
        targetY: target.y + target.height * 0.8,
      };
    }),
    columns,
    node.width,
  );

  const geometries = paths.flatMap((path): Geometry[] => {
    if (!path.toScreenId || path.toScreenId === path.fromScreenId) return [];
    const sourceCard = card(path.fromScreenId);
    const targetCard = card(path.toScreenId);
    if (!sourceCard || !targetCard) return [];
    const involved =
      path.id === activePathId ||
      path.fromScreenId === selectedScreenId ||
      path.toScreenId === selectedScreenId;
    const route = routes.get(path.id);
    if (!route) {
      const points = returnRoutes.get(path.id);
      if (!involved || !points) return [];
      return [
        {
          path,
          d: roundedPath(points),
          arrow: arrowHead(points),
          label: midpointAlong(points),
          returning: true,
        },
      ];
    }
    const anchor = ends.get(path.id)?.anchor;
    const points = anchor ? [anchor, ...route] : route;
    const label = midpointAlong(points);
    return [
      {
        path,
        d: roundedPath(points),
        arrow: arrowHead(points),
        label,
        returning: false,
        ...(anchor ? { anchor } : {}),
      },
    ];
  });
  // Paint the active path last so it sits above the others.
  geometries.sort(
    (a, b) => Number(a.path.id === activePathId) - Number(b.path.id === activePathId),
  );
  const bounds = [...positions.values()].reduce<MapBounds>(
    (result, point) => ({
      minX: Math.min(result.minX, point.x - 240),
      minY: Math.min(result.minY, point.y - 240),
      maxX: Math.max(result.maxX, point.x + node.width + 240),
      maxY: Math.max(result.maxY, point.y + node.height + 240),
    }),
    { minX: -240, minY: -240, maxX: 240, maxY: 240 },
  );
  const isActive = (path: PresentedMapPath) =>
    path.id === activePathId ||
    Boolean(
      selectedScreenId &&
      (path.fromScreenId === selectedScreenId || path.toScreenId === selectedScreenId),
    );
  // Quiet connections sit behind the cards; the hovered or selected ones are
  // lifted above them so they can be followed end to end.
  return (
    <>
      {renderLayer(geometries, "under")}
      {renderLayer(
        geometries.filter((geometry) => isActive(geometry.path)),
        "over",
      )}
    </>
  );

  function renderLayer(layer: readonly Geometry[], depth: "under" | "over") {
    return (
      <svg
        className={`pointer-events-none absolute left-(--box-left) top-(--box-top) h-(--box-height) w-(--box-width) overflow-visible ${depth === "over" ? "z-20" : "z-0"}`}
        aria-label={depth === "under" ? "Screen connections" : "Highlighted connections"}
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`}
        style={
          {
            "--box-left": `${bounds.minX}px`,
            "--box-top": `${bounds.minY}px`,
            "--box-width": `${bounds.maxX - bounds.minX}px`,
            "--box-height": `${bounds.maxY - bounds.minY}px`,
          } as CSSProperties
        }
      >
        {layer.map((geometry) => {
          const { path } = geometry;
          const active =
            path.id === activePathId ||
            Boolean(
              selectedScreenId &&
              (path.fromScreenId === selectedScreenId || path.toScreenId === selectedScreenId),
            );
          const faded = Boolean((activePathId || selectedScreenId) && !active);
          const more = path.parallelPaths ? path.parallelPaths.length - 1 : 0;
          const text = `${path.label.length > 32 ? `${path.label.slice(0, 31)}…` : path.label}${more ? ` · ${more} more` : ""}`;
          const showLabel = path.id === activePathId && depth === "over";
          // The bottom layer owns every pointer target, so hovering never
          // re-mounts the element under the pointer. Lifted paths are drawn on
          // top, visual only.
          const interactive = depth === "under";
          const drawn = depth === "over" || !active;
          const labelWidth = Math.min(260, text.length * 6.6 + 20);
          return (
            <g
              key={path.id}
              data-slot={interactive ? "map-edge" : "map-edge-lifted"}
              data-state={active ? "active" : faded ? "faded" : "neutral"}
              data-draft={path.draft ? "true" : undefined}
              role={onSelectPath && interactive ? "button" : undefined}
              tabIndex={onSelectPath && interactive ? 0 : undefined}
              aria-hidden={interactive ? undefined : true}
              aria-label={`${path.fromTitle}: ${path.label}${path.toTitle ? ` → ${path.toTitle}` : ""}${more ? ` (and ${more} more)` : ""}`}
              aria-pressed={onSelectPath ? selectedPathId === path.id : undefined}
              onPointerEnter={() => setHoveredPathId(path.id)}
              onPointerLeave={() => setHoveredPathId(undefined)}
              onFocus={() => setHoveredPathId(path.id)}
              onBlur={() => setHoveredPathId(undefined)}
              onPointerDown={onSelectPath ? (event) => event.stopPropagation() : undefined}
              onClick={
                onSelectPath
                  ? (event) => {
                      event.stopPropagation();
                      onSelectPath(path.id);
                    }
                  : undefined
              }
              onKeyDown={
                onSelectPath
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectPath(path.id);
                      }
                    }
                  : undefined
              }
              className={`outline-none transition-opacity ${active ? "text-info" : "text-muted-foreground"} ${faded ? "opacity-25" : path.draft && !active ? "opacity-60" : ""}`}
            >
              {onSelectPath && interactive ? (
                <path
                  data-slot="map-edge-hit"
                  d={geometry.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="14"
                  pointerEvents="stroke"
                  className="cursor-pointer"
                />
              ) : null}
              {drawn ? (
                <>
                  <path
                    data-slot="map-edge-line"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={active ? 2 : 1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d={geometry.d}
                    strokeDasharray={geometry.returning || path.draft ? "6 5" : undefined}
                  />
                  <path
                    data-slot="map-edge-arrow"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={active ? 2 : 1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d={geometry.arrow}
                  />
                </>
              ) : null}
              {geometry.anchor ? (
                <circle
                  cx={geometry.anchor.x}
                  cy={geometry.anchor.y}
                  r="4"
                  fill="var(--info)"
                  stroke="var(--background)"
                  strokeWidth="1.5"
                />
              ) : null}
              {showLabel ? (
                <g data-slot="map-edge-label">
                  <rect
                    x={geometry.label.x - labelWidth / 2}
                    y={geometry.label.y - 11}
                    width={labelWidth}
                    height={22}
                    rx="11"
                    className="fill-popover stroke-border"
                    strokeWidth="0.5"
                  />
                  <text
                    x={geometry.label.x}
                    y={geometry.label.y + 4}
                    textAnchor="middle"
                    className="fill-current font-sans text-xs font-medium"
                  >
                    {text}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
    );
  }
}
