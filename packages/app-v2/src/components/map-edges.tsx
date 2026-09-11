import { forwardRoute, avoidPreviewObstacles, routeCrossesBox } from "./map-forward-route";
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
  horizontal = false,
  positions,
  markerId,
  selectedScreenId,
  selectedPathId,
  showInteractionTargets = false,
  screens,
  imageDimensions,
}: {
  horizontal?: boolean;
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
          "top",
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
          "top",
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
    // Leave an intentional gap around previews. Recorded click origins retain
    // their exact position inside the source screenshot.
    const clearance = 14;
    if (!anchor) start.x += backwards ? -clearance : clearance;
    if (to) end.x += backwards ? clearance : -clearance;
    if (!to) {
      const width = Math.min(240, Math.max(168, path.label.length * 6.2 + 24));
      const left = start.x + 32;
      return [
        {
          path,
          id: `-${index}`,
          anchor,
          anchorRect,
          d: `M ${start.x} ${start.y} L ${left} ${start.y}`,
          label: { x: left + width / 2, y: start.y - 5, width },
          bounds: {
            minX: start.x - 24,
            minY: start.y - 30,
            maxX: left + width + 24,
            maxY: start.y + 36,
          },
        },
      ];
    }
    const selfLoop = path.toScreenId === path.fromScreenId;
    const labelWidth = Math.min(180, Math.max(44, path.label.length * 6.2 + 18));
    if (selfLoop) {
      const loopTop = from.y - 74;
      const loopStart = anchor ?? {
        x: from.x + MAP_NODE_WIDTH * 0.72,
        y: from.y - clearance,
      };
      const loopEnd = anchor
        ? { x: from.x + MAP_NODE_WIDTH * 0.28, y: from.y + 4 }
        : imageRect
          ? { x: imageRect.x - clearance, y: imageRect.y + imageRect.height / 2 }
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
    const isReturn = backwards || /^(back|close|dismiss|return|cancel|disable)\b/i.test(path.label);
    const sourceBox = imageRect ?? {
      x: from.x,
      y: from.y + MAP_NODE_TITLE_HEIGHT + MAP_NODE_GAP,
      width: MAP_NODE_WIDTH,
      height: MAP_NODE_IMAGE_HEIGHT,
    };
    const targetBox = targetImageRect ?? {
      x: to.x,
      y: to.y + MAP_NODE_TITLE_HEIGHT + MAP_NODE_GAP,
      width: MAP_NODE_WIDTH,
      height: MAP_NODE_IMAGE_HEIGHT,
    };
    if (horizontal) {
      const upward = to.y < from.y;
      const leavesRight = targetBox.x + targetBox.width / 2 >= sourceBox.x + sourceBox.width / 2;
      const controlOrigin = anchor && {
        x: anchorRect ? anchorRect.x + (leavesRight ? anchorRect.width : 0) : anchor.x,
        y: anchor.y,
      };
      const origin = controlOrigin ?? {
        x: sourceBox.x + sourceBox.width / 2,
        y: upward ? from.y - clearance : sourceBox.y + sourceBox.height + clearance,
      };
      const destination = {
        x: targetBox.x + targetBox.width / 2,
        y: upward ? targetBox.y + targetBox.height + clearance : to.y - clearance,
      };
      // All siblings branch before the nearest destination. Choosing a lane
      // per destination sends the farther trunks through nearer captures.
      const siblingRows = paths
        .filter(
          (candidate) =>
            candidate.fromScreenId === path.fromScreenId && !isRoutineReturn(candidate),
        )
        .flatMap((candidate) => {
          const target = positions.get(candidate.toScreenId ?? "");
          return target && target.y < from.y === upward ? [target.y] : [];
        });
      const lane = upward
        ? Math.max(destination.y, ...siblingRows.map((y) => y + MAP_NODE_HEIGHT + clearance)) + 80
        : Math.min(destination.y, ...siblingRows.map((y) => y - clearance)) - 80;
      const exitX = leavesRight ? sourceBox.x + sourceBox.width + 24 : sourceBox.x - 24;
      const direct = [origin, { x: destination.x, y: origin.y }, destination];
      const directClear =
        controlOrigin &&
        Math.abs(destination.x - origin.x) > 24 &&
        [...positions].every(
          ([id, point]) =>
            id === path.fromScreenId ||
            id === path.toScreenId ||
            direct.slice(1).every(
              (end, index) =>
                !routeCrossesBox(direct[index]!, end, {
                  x: point.x - 14,
                  y: point.y - 14,
                  width: MAP_NODE_WIDTH + 28,
                  height: MAP_NODE_HEIGHT + 28,
                }),
            ),
        );
      const points = directClear
        ? direct
        : controlOrigin
          ? [
              origin,
              { x: exitX, y: origin.y },
              { x: exitX, y: lane },
              { x: destination.x, y: lane },
              destination,
            ]
          : Math.abs(origin.x - destination.x) < 1
            ? [origin, destination]
            : [origin, { x: origin.x, y: lane }, { x: destination.x, y: lane }, destination];
      return [
        {
          path,
          id: `-${index}`,
          anchor: controlOrigin,
          anchorRect,
          d: roundedConnector(points),
          label: {
            x: destination.x,
            y: directClear
              ? destination.y - 20
              : points.length === 2
                ? (origin.y + destination.y) / 2
                : lane - 12,
            width: labelWidth,
          },
          bounds: {
            minX: Math.min(...points.map((p) => p.x)) - labelWidth / 2,
            minY: Math.min(...points.map((p) => p.y)) - 40,
            maxX: Math.max(...points.map((p) => p.x)) + labelWidth / 2,
            maxY: Math.max(...points.map((p) => p.y)) + 40,
          },
        },
      ];
    }
    // Give each return to this destination a stable landing port. Ordering by
    // source height keeps nearby branches from swapping lanes on selection.
    const siblings = paths
      .filter(
        (candidate) =>
          candidate.toScreenId === path.toScreenId &&
          (positions.get(candidate.fromScreenId)?.x ?? Infinity) > to.x,
      )
      .sort(
        (a, b) =>
          (positions.get(a.fromScreenId)?.y ?? 0) - (positions.get(b.fromScreenId)?.y ?? 0) ||
          a.id.localeCompare(b.id),
      );
    const slot = Math.max(
      0,
      siblings.findIndex((candidate) => candidate.id === path.id),
    );
    const returning = isReturn
      ? returnConnector(sourceBox, targetBox, slot, siblings.length, anchor)
      : undefined;
    const portY = (screenId: string, fraction = 0.5) => {
      const point = positions.get(screenId);
      const dimensions = imageDimensions.get(screenId);
      const height = dimensions
        ? Math.min(MAP_NODE_IMAGE_HEIGHT, (MAP_NODE_WIDTH * dimensions.height) / dimensions.width)
        : MAP_NODE_IMAGE_HEIGHT;
      return (point?.y ?? 0) + MAP_NODE_TITLE_HEIGHT + MAP_NODE_GAP + height * fraction;
    };
    // Order the whole corridor, not each source independently. Otherwise two
    // branching screens reuse the same lanes and their exits interleave.
    const directionSiblings = paths
      .filter((candidate) => {
        const source = positions.get(candidate.fromScreenId);
        const target = candidate.toScreenId ? positions.get(candidate.toScreenId) : undefined;
        if (
          !source ||
          !target ||
          source.x !== from.x ||
          target.x <= source.x ||
          isRoutineReturn(candidate)
        )
          return false;
        const sourceY = portY(
          candidate.fromScreenId,
          showInteractionTargets ? candidate.sourceAnchor?.point.y : undefined,
        );
        return portY(candidate.toScreenId!) < sourceY === end.y < start.y;
      })
      .sort((a, b) => portY(a.toScreenId!) - portY(b.toScreenId!) || a.id.localeCompare(b.id));
    const corridorEnd = Math.min(
      end.x,
      ...directionSiblings.map((candidate) => positions.get(candidate.toScreenId!)!.x - clearance),
    );
    const forwardSlot = Math.max(
      0,
      directionSiblings.findIndex((candidate) => candidate.id === path.id),
    );
    // Center-origin branches form one visual bus. Direction-specific lanes
    // are only needed when the paths originate at different controls/screens.
    const sourceBranches = anchor
      ? []
      : paths.filter(
          (candidate) =>
            candidate.fromScreenId === path.fromScreenId &&
            candidate.toScreenId &&
            !isRoutineReturn(candidate) &&
            (positions.get(candidate.toScreenId)?.x ?? -Infinity) > from.x,
        );
    const sharedJunction = sourceBranches.length > 1;
    const branchEnd = sharedJunction
      ? Math.min(
          ...sourceBranches.map((candidate) => positions.get(candidate.toScreenId!)!.x - clearance),
        )
      : corridorEnd;
    let points =
      returning?.points ??
      forwardRoute(
        start,
        end,
        from.x + MAP_NODE_WIDTH,
        sharedJunction ? 0 : forwardSlot,
        sharedJunction ? 1 : directionSiblings.length,
        branchEnd,
      );
    if (!returning)
      points = avoidPreviewObstacles(
        points,
        [...positions]
          .filter(([id]) => id !== path.fromScreenId && id !== path.toScreenId)
          .flatMap(([id, point]) => {
            const image = containedImageRect(
              {
                x: point.x,
                y: point.y + MAP_NODE_TITLE_HEIGHT + MAP_NODE_GAP,
                width: MAP_NODE_WIDTH,
                height: MAP_NODE_IMAGE_HEIGHT,
              },
              imageDimensions.get(id) ?? { width: MAP_NODE_WIDTH, height: MAP_NODE_IMAGE_HEIGHT },
              "top",
            )!;
            return [
              {
                x: image.x - 10,
                y: image.y - 10,
                width: image.width + 20,
                height: image.height + 20,
              },
              {
                x: point.x - 8,
                y: point.y - 8,
                width: MAP_NODE_WIDTH + 16,
                height: MAP_NODE_TITLE_HEIGHT + 16,
              },
            ];
          }),
      );
    return [
      {
        path,
        id: `-${index}`,
        anchor,
        anchorRect,
        d: returning ? quadraticReturn(points) : roundedConnector(points),
        label: {
          x:
            returning?.label.x ??
            end.x - Math.min(labelWidth / 2 + 4, Math.abs(end.x - points.at(-2)!.x) / 2),
          y: returning?.label.y ?? end.y - 12,
          width: labelWidth,
        },
        bounds: {
          minX: Math.min(...points.map((point) => point.x)) - 24,
          minY: Math.min(...points.map((point) => point.y)) - 40,
          maxX: Math.max(...points.map((point) => point.x)) + 24,
          maxY: Math.max(...points.map((point) => point.y)) + 40,
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
      className="relay-map-edges pointer-events-none absolute z-10 overflow-visible"
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
        {["neutral", "selected", "muted"].map((state) => (
          <marker
            key={state}
            id={`${markerId}-${state}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path
              d="M 1 1 L 8 5 L 1 9"
              fill="none"
              stroke={
                state === "selected"
                  ? "var(--color-blue-400)"
                  : state === "muted"
                    ? "color-mix(in oklch, var(--text-weak) 80%, var(--background) 20%)"
                    : "var(--text-weak)"
              }
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        ))}
      </defs>
      {geometries.map((geometry) => {
        const dimmed = selectedPathId
          ? geometry.path.id !== selectedPathId
          : Boolean(
              selectedScreenId &&
              geometry.path.fromScreenId !== selectedScreenId &&
              geometry.path.toScreenId !== selectedScreenId,
            );
        const state =
          selectedPathId === geometry.path.id ? "selected" : dimmed ? "muted" : "neutral";
        return (
          <g
            key={geometry.path.id}
            style={{
              color:
                state === "selected"
                  ? "var(--color-blue-400)"
                  : state === "muted"
                    ? "color-mix(in oklch, var(--text-weak) 80%, var(--background) 20%)"
                    : "var(--text-weak)",
            }}
            className="relay-map-edge [&>path]:fill-none [&>path]:stroke-current [&>path]:[stroke-linecap:round] [&>path]:stroke-[1.5] [&>path]:[vector-effect:non-scaling-stroke] [&>rect]:fill-[var(--surface-raised-stronger-non-alpha)] [&>rect]:stroke-[var(--border-weak-base)] [&>rect]:stroke-0 [&>rect]:[vector-effect:non-scaling-stroke] [&_text]:fill-current [&_text]:font-sans [&_text]:text-[10.5px] [&_text]:font-normal"
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
              </>
            ) : null}
            <path
              id={geometry.id}
              d={geometry.d}
              markerEnd={geometry.path.toScreenId ? `url(#${markerId}-${state})` : undefined}
              strokeDasharray={geometry.path.toScreenId ? undefined : "3 4"}
            />
            {geometry.anchor ? (
              <path
                d="M 0 -5 A 5 5 0 1 0 0 5 L 7 0 Z"
                transform={`translate(${geometry.anchor.x} ${geometry.anchor.y}) rotate(${(positions.get(geometry.path.toScreenId ?? "")?.x ?? Infinity) < (positions.get(geometry.path.fromScreenId)?.x ?? 0) ? 180 : 0})`}
                style={{
                  fill: "var(--color-blue-500)",
                  stroke: "var(--background)",
                  strokeWidth: 1.5,
                }}
              />
            ) : null}
            <rect
              x={geometry.label.x - geometry.label.width / 2}
              y={geometry.label.y - 14}
              width={geometry.label.width}
              height={geometry.path.toScreenId ? 22 : 44}
              rx="4"
            />
            <text x={geometry.label.x} y={geometry.label.y} textAnchor="middle">
              {geometry.path.label}
            </text>
            {!geometry.path.toScreenId ? (
              <text
                x={geometry.label.x}
                y={geometry.label.y + 17}
                textAnchor="middle"
                style={{ fontWeight: 400 }}
              >
                Destination not recorded
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

// Axis-aligned segments with bounded corner radii; straight continuations
// remain straight instead of acquiring unnecessary bezier curvature.
export function roundedConnector(points: readonly MapPoint[], radius = 12): string {
  const clean = points.filter(
    (point, index) =>
      !index || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y,
  );
  if (!clean.length) return "";
  let d = `M ${clean[0]!.x} ${clean[0]!.y}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const previous = clean[i - 1]!,
      current = clean[i]!,
      next = clean[i + 1]!;
    const before = Math.hypot(current.x - previous.x, current.y - previous.y);
    const after = Math.hypot(next.x - current.x, next.y - current.y);
    const r = Math.min(radius, before / 2, after / 2);
    const entry = {
      x: current.x + ((previous.x - current.x) * r) / before,
      y: current.y + ((previous.y - current.y) * r) / before,
    };
    const exit = {
      x: current.x + ((next.x - current.x) * r) / after,
      y: current.y + ((next.y - current.y) * r) / after,
    };
    if (
      (current.x - previous.x) * (next.y - current.y) ===
      (current.y - previous.y) * (next.x - current.x)
    )
      d += ` L ${current.x} ${current.y}`;
    else d += ` L ${entry.x} ${entry.y} Q ${current.x} ${current.y} ${exit.x} ${exit.y}`;
  }
  if (clean.length > 1) d += ` L ${clean.at(-1)!.x} ${clean.at(-1)!.y}`;
  return d;
}

type PreviewBox = { x: number; y: number; width: number; height: number };
/** Returns use bottom ports, leaving the center lane for forward navigation. */
export function returnConnector(
  source: PreviewBox,
  target: PreviewBox,
  slot = 0,
  count = 1,
  anchor?: MapPoint,
) {
  const gap = 14;
  const sourceBottom = source.y + source.height;
  const targetBottom = target.y + target.height;
  const end = {
    x: target.x + target.width * (0.2 + (0.3 * (slot + 1)) / (Math.max(1, count) + 1)),
    y: targetBottom + gap,
  };
  if (Math.abs(source.y - target.y) < 40) {
    const start = anchor ?? { x: source.x + source.width * 0.65, y: sourceBottom + gap };
    const y = Math.max(sourceBottom, targetBottom) + 44 + slot * 28;
    return {
      points: [start, { x: start.x, y }, { x: end.x, y }, end],
      label: { x: (start.x + end.x) / 2, y: y - 12 },
    };
  }
  // Unequal rows take the inter-column corridor directly, without first
  // climbing above both previews and doubling back down the same corridor.
  const leftward = source.x > target.x;
  const start = anchor ?? {
    x: leftward ? source.x - gap : source.x + source.width + gap,
    y: source.y + source.height * 0.78,
  };
  const corridorX = leftward
    ? (source.x + target.x + target.width) / 2 + 24 + Math.min(slot, 3) * 12
    : (source.x + source.width + target.x) / 2 - 24 - Math.min(slot, 3) * 12;
  const y = targetBottom + 44 + (slot / Math.max(1, count - 1)) * 48;
  return {
    points: [start, { x: corridorX, y: start.y }, { x: corridorX, y }, { x: end.x, y }, end],
    label: { x: corridorX, y: Math.abs(start.y - y) > 100 ? (start.y + y) / 2 : start.y - 12 },
  };
}

export function isRoutineReturn(path: Pick<ProductMapPath, "label" | "toScreenId">): boolean {
  return Boolean(
    path.toScreenId && /^(back|close|dismiss|return|cancel|disable)\b/i.test(path.label),
  );
}

/** A single shallow bend distinguishes a revealed return from forward elbows. */
export function quadraticReturn(points: readonly MapPoint[]): string {
  const start = points[0],
    end = points.at(-1);
  if (!start || !end) return "";
  const aligned = Math.abs(start.y - end.y) < 40;
  const control = aligned
    ? { x: (start.x + end.x) / 2, y: Math.max(start.y, end.y) + 72 }
    : { x: end.x, y: start.y };
  return `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
}
