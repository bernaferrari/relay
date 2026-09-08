import type { ProductMapPath } from "@relay/product/map-exploration";
import {
  MAP_NODE_WIDTH,
  MAP_NODE_HEIGHT,
  type MapPoint,
  type MapBounds,
} from "./map-canvas-geometry";
export function MapEdges({
  paths,
  positions,
  markerId,
  selectedScreenId,
}: {
  paths: readonly ProductMapPath[];
  positions: ReadonlyMap<string, MapPoint>;
  markerId: string;
  selectedScreenId?: string;
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
          id: `-${index}`,
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
    const reciprocal = paths.some(
      (candidate) =>
        candidate.fromScreenId === path.toScreenId && candidate.toScreenId === path.fromScreenId,
    );
    const labelY =
      reciprocal && backwards
        ? Math.max(from.y, to?.y ?? from.y) + MAP_NODE_HEIGHT + 28
        : gap < labelWidth + 24
          ? Math.min(from.y, to?.y ?? from.y) - 18
          : (start.y + end.y) / 2 - 11;
    return [
      {
        path,
        id: `-${index}`,
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
      className="relay-map-edges pointer-events-none absolute overflow-visible [&_marker_path]:fill-[var(--text-weaker)]"
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
        <g
          key={geometry.path.id}
          opacity={
            selectedScreenId &&
            geometry.path.fromScreenId !== selectedScreenId &&
            geometry.path.toScreenId !== selectedScreenId
              ? 0.15
              : 1
          }
          className="relay-map-edge [&>path]:fill-none [&>path]:stroke-[color-mix(in_srgb,var(--text-weaker)_58%,var(--border-weak-base))] [&>path]:[stroke-linecap:round] [&>path]:stroke-[1.5] [&>path]:[vector-effect:non-scaling-stroke] [&>rect]:fill-[var(--surface-raised-stronger-non-alpha)] [&>rect]:stroke-[var(--border-weak-base)] [&>rect]:stroke-1 [&>rect]:[vector-effect:non-scaling-stroke] [&_text]:fill-[var(--text-weak)] [&_text]:font-sans [&_text]:text-[10.5px] [&_text]:font-semibold"
        >
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
