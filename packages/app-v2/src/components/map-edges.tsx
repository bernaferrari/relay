import type { ProductMapPath } from "@relay/product/map-exploration";
import {
  MAP_NODE_WIDTH,
  MAP_NODE_HEIGHT,
  type MapPoint,
  type MapBounds,
  containedImageRect,
  type ImageDimensions,
  MAP_NODE_GAP,
  MAP_NODE_IMAGE_HEIGHT,
  MAP_NODE_TITLE_HEIGHT,
} from "./map-canvas-geometry";
export function MapEdges({
  paths,
  positions,
  markerId,
  selectedScreenId,
  selectedPathId,
  showInteractionTargets = false,
  screens,
  imageDimensions,
}: {
  paths: readonly ProductMapPath[];
  positions: ReadonlyMap<string, MapPoint>;
  markerId: string;
  selectedScreenId?: string;
  selectedPathId?: string;
  showInteractionTargets?: boolean;
  screens: readonly { id: string; screenshotUri?: string }[];
  imageDimensions: ReadonlyMap<string, ImageDimensions>;
}) {
  const geometries = paths.flatMap((path, index) => {
    const from = positions.get(path.fromScreenId);
    if (!from) return [];
    const to = path.toScreenId ? positions.get(path.toScreenId) : undefined;
    // A path whose target is outside the bounded visible set is omitted rather
    // than being misrepresented as a terminal path.
    if (path.toScreenId && !to) return [];
    const sourceScreen = screens.find((screen) => screen.id === path.fromScreenId);
    const imageRect = sourceScreen?.screenshotUri
      ? containedImageRect(
          {
            x: from.x,
            y: from.y + MAP_NODE_TITLE_HEIGHT + MAP_NODE_GAP,
            width: MAP_NODE_WIDTH,
            height: MAP_NODE_IMAGE_HEIGHT,
          },
          imageDimensions.get(path.fromScreenId) ?? { width: 0, height: 0 },
        )
      : undefined;
    const targetScreen = to ? screens.find((screen) => screen.id === path.toScreenId) : undefined;
    const targetImageRect = targetScreen?.screenshotUri
      ? containedImageRect(
          {
            x: to!.x,
            y: to!.y + MAP_NODE_TITLE_HEIGHT + MAP_NODE_GAP,
            width: MAP_NODE_WIDTH,
            height: MAP_NODE_IMAGE_HEIGHT,
          },
          imageDimensions.get(path.toScreenId!) ?? { width: 0, height: 0 },
        )
      : undefined;
    const anchor =
      showInteractionTargets && path.sourceAnchor && imageRect
        ? {
            x: imageRect.x + path.sourceAnchor.point.x * imageRect.width,
            y: imageRect.y + path.sourceAnchor.point.y * imageRect.height,
          }
        : undefined;
    const anchorRect =
      anchor && path.sourceAnchor?.rect
        ? {
            x: imageRect!.x + path.sourceAnchor.rect.x * imageRect!.width,
            y: imageRect!.y + path.sourceAnchor.rect.y * imageRect!.height,
            width: path.sourceAnchor.rect.width * imageRect!.width,
            height: path.sourceAnchor.rect.height * imageRect!.height,
          }
        : undefined;
    const backwards = Boolean(to && to.x < from.x);
    const start = {
      x:
        anchor?.x ??
        (imageRect
          ? backwards
            ? imageRect.x
            : imageRect.x + imageRect.width
          : from.x + (backwards ? 0 : MAP_NODE_WIDTH)),
      y:
        anchor?.y ??
        (imageRect ? imageRect.y + imageRect.height / 2 : from.y + MAP_NODE_HEIGHT / 2),
    };
    const end = to
      ? {
          x: targetImageRect
            ? backwards
              ? targetImageRect.x + targetImageRect.width
              : targetImageRect.x
            : to.x + (backwards ? MAP_NODE_WIDTH : 0),
          y: targetImageRect
            ? targetImageRect.y + targetImageRect.height / 2
            : to.y + MAP_NODE_HEIGHT / 2,
        }
      : { x: start.x + 116, y: start.y };
    const selfLoop = path.toScreenId === path.fromScreenId;
    const labelWidth = Math.min(180, Math.max(44, path.label.length * 6.2 + 18));
    if (selfLoop) {
      const loopTop = from.y - 74;
      const loopStart = anchor ?? {
        x: from.x + MAP_NODE_WIDTH * 0.72,
        y: from.y,
      };
      const loopEnd = anchor
        ? { x: from.x + MAP_NODE_WIDTH * 0.28, y: from.y + 4 }
        : imageRect
          ? { x: imageRect.x, y: imageRect.y + imageRect.height / 2 }
          : { x: from.x + MAP_NODE_WIDTH * 0.28, y: from.y };
      return [
        {
          path,
          id: `-${index}`,
          anchor,
          anchorRect,
          d: `M ${loopStart.x} ${loopStart.y} C ${loopStart.x} ${loopTop}, ${loopEnd.x} ${loopTop}, ${loopEnd.x} ${loopEnd.y}`,
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
    const actualBackwards = end.x < start.x;
    if (actualBackwards && !anchor && !imageRect) {
      start.x = from.x;
      if (to) end.x = to.x + MAP_NODE_WIDTH;
    }
    const bend = Math.max(64, Math.abs(end.x - start.x) * 0.48);
    const direction = actualBackwards ? -1 : 1;
    const controlOneX = start.x + bend * direction;
    const controlTwoX = end.x - bend * direction;
    const gap = Math.abs(end.x - start.x);
    const reciprocal = paths.some(
      (candidate) =>
        candidate.fromScreenId === path.toScreenId && candidate.toScreenId === path.fromScreenId,
    );
    const labelY =
      reciprocal && actualBackwards
        ? Math.max(from.y, to?.y ?? from.y) + MAP_NODE_HEIGHT + 28
        : gap < labelWidth + 24
          ? Math.min(from.y, to?.y ?? from.y) - 18
          : (start.y + end.y) / 2 - 11;
    return [
      {
        path,
        id: `-${index}`,
        anchor,
        anchorRect,
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
      className="relay-map-edges pointer-events-none absolute z-10 overflow-visible [&_marker_path]:fill-[var(--text-weaker)]"
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
            selectedPathId
              ? geometry.path.id === selectedPathId
                ? 1
                : 0.12
              : selectedScreenId &&
                  geometry.path.fromScreenId !== selectedScreenId &&
                  geometry.path.toScreenId !== selectedScreenId
                ? 0.15
                : 1
          }
          className="relay-map-edge [&>path]:fill-none [&>path]:stroke-[color-mix(in_srgb,var(--text-weaker)_58%,var(--border-weak-base))] [&>path]:[stroke-linecap:round] [&>path]:stroke-[1.5] [&>path]:[vector-effect:non-scaling-stroke] [&>rect]:fill-[var(--surface-raised-stronger-non-alpha)] [&>rect]:stroke-[var(--border-weak-base)] [&>rect]:stroke-1 [&>rect]:[vector-effect:non-scaling-stroke] [&_text]:fill-[var(--text-weak)] [&_text]:font-sans [&_text]:text-[10.5px] [&_text]:font-semibold"
        >
          {geometry.anchor ? (
            <>
              {geometry.anchorRect ? (
                <rect
                  x={geometry.anchorRect.x}
                  y={geometry.anchorRect.y}
                  width={geometry.anchorRect.width}
                  height={geometry.anchorRect.height}
                  rx="3"
                  className="fill-blue-500/15 stroke-blue-500"
                  style={{ fill: "rgba(59,130,246,0.15)", stroke: "#3b82f6" }}
                  strokeWidth="1.5"
                />
              ) : null}
              <circle
                cx={geometry.anchor.x}
                cy={geometry.anchor.y}
                r="5"
                className="fill-blue-500 stroke-background"
                strokeWidth="2"
              />
            </>
          ) : null}
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
