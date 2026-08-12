import { For, Show, createMemo, createSignal } from "solid-js";
import type { CollaborationAwareness, CanvasNote, ConnectionPresentation } from "@relay/protocol";
import { cn } from "../lib/cn";
import {
  canvasEdgeArrowPath,
  canvasEdgeStartArrowPath,
  canvasEdgeGeometry,
  connectorTargetGapForViewport,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  screenCardGeometry,
  screenFrameBounds,
  type CanvasScreenRotation,
  type CanvasPoint,
} from "../lib/app-map-canvas-layout";
import type { MapTreeNode } from "../lib/app-map-tree";
import type { CanvasConnection } from "../lib/app-map-connection-draft";
import {
  connectorAutoLanes,
  connectorHasAutomaticSourceLane,
  connectorPresentationWithAutoLane,
} from "../lib/app-map-connector-lanes";
import type { AppMapRunPresentationState } from "../lib/app-map-run-projection";
import type { CanvasCombineCardModel, CanvasCombineSection } from "../lib/app-map-combine-canvas";
import type { PresenceGeometry } from "./collaboration-presence";
import { CollaborationPresence } from "./collaboration-presence";
import { CanvasCombineCard, CanvasNoteCard, ScreenCard } from "./app-map-canvas-primitives";
import { AppMapConnectionToolbar } from "./app-map-connection-toolbar";
import type { ScreenshotOrientationEvidence, ScreenshotRotation } from "./oriented-screenshot";

export type AppMapCanvasSceneProps = {
  nodes: MapTreeNode[];
  connections: readonly CanvasConnection[];
  notes: readonly CanvasNote[];
  width: number;
  height: number;
  viewportScale: number;
  visibleBounds: { left: number; top: number; right: number; bottom: number };
  selectedNodeId: string | null;
  selectedNodeIds: readonly string[];
  selectedConnectionId: string | null;
  renamingNodeId: string | null;
  awareness: readonly CollaborationAwareness[];
  presenceGeometry: PresenceGeometry;
  positionFor: (node: MapTreeNode) => CanvasPoint;
  titleFor: (node: MapTreeNode) => string;
  imageFor: (node: MapTreeNode) => string;
  orientationEvidenceFor: (node: MapTreeNode) => ScreenshotOrientationEvidence | undefined;
  isFlowStart: (node: MapTreeNode) => boolean;
  screenRunState: (screenId: string) => AppMapRunPresentationState | undefined;
  connectionRunState: (connectionId: string) => AppMapRunPresentationState | undefined;
  caseCountFor: (connection: CanvasConnection) => { count: number; exact: boolean } | undefined;
  connectionLabelMode: (connection: CanvasConnection) => "always" | "hidden";
  onSelectNode: (node: MapTreeNode, event?: MouseEvent) => void;
  onSelectConnection: (connection: CanvasConnection) => void;
  onChangeConnectionPresentation: (
    connection: CanvasConnection,
    presentation: ConnectionPresentation | undefined,
  ) => void;
  onRenameNode: (node: MapTreeNode) => void;
  onOpenNodeDetails: (node: MapTreeNode) => void;
  canRunToScreen: (screenId: string) => boolean;
  onRunToScreen: (node: MapTreeNode) => void;
  onCommitNodeRename: (node: MapTreeNode, title: string) => void;
  onNodePointerDown: (event: PointerEvent, node: MapTreeNode) => void;
  onNotePointerDown: (event: PointerEvent, note: CanvasNote) => void;
  onNoteText: (note: CanvasNote, text: string) => void;
  onCommitNote: (note: CanvasNote, previousText: string) => void;
  onDeleteNote: (note: CanvasNote) => void;
  onScreenRotationChange?: (nodeId: string, rotation: CanvasScreenRotation) => void;
  hereScreenId?: string | null;
  combines?: readonly CanvasCombineCardModel[];
  onOpenCombine?: (combineId: string, section: CanvasCombineSection) => void;
  onOpenCombineResults?: (jobId: string) => void;
};

type ConnectionControlDrag = {
  connectionId: string;
  presentation: ConnectionPresentation;
  originPointer: CanvasPoint;
  originOffset: CanvasPoint;
};

const CURVE_KEYBOARD_NUDGE = 20;

function connectionOriginClipId(connectionId: string): string {
  return `app-map-connection-origin-${connectionId.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`;
}

function connectorHitWidthInScreenPixels(): number {
  if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) {
    return 44;
  }
  return 32;
}

const connectionStrokeClass = (
  state: AppMapRunPresentationState | undefined,
  connection: CanvasConnection,
  selected: boolean,
) =>
  state === "failed"
    ? "stroke-[var(--icon-critical-base)]"
    : state === "running"
      ? "stroke-[var(--text-interactive-base)] [stroke-dasharray:7_4] motion-safe:animate-pulse"
      : state === "healed"
        ? "stroke-[var(--icon-warning-base)]"
        : selected
          ? "stroke-[var(--text-interactive-base)]"
          : connection.state === "needs-recording"
            ? "stroke-[var(--text-weak)] [stroke-dasharray:5_5]"
            : connection.review?.status === "failed"
              ? "stroke-[var(--icon-critical-base)]"
              : connection.kind === "return"
                ? "stroke-[var(--text-weak)] [stroke-dasharray:6_6]"
                : "stroke-[color-mix(in_srgb,var(--text-base)_68%,transparent)]";

export function AppMapCanvasScene(props: AppMapCanvasSceneProps) {
  const [screenRotations, setScreenRotations] = createSignal<Record<string, CanvasScreenRotation>>(
    {},
  );
  const [screenNaturalSizes, setScreenNaturalSizes] = createSignal<
    Record<string, { width: number; height: number }>
  >({});
  const [hoveredConnectionId, setHoveredConnectionId] = createSignal<string | null>(null);
  const [connectionControlDrag, setConnectionControlDrag] =
    createSignal<ConnectionControlDrag | null>(null);
  const [connectorToolbarAnchor, setConnectorToolbarAnchor] = createSignal<{
    connectionId: string;
    point: CanvasPoint;
  } | null>(null);
  const selectedNodeIds = createMemo(() => new Set(props.selectedNodeIds));
  const nodeIndex = createMemo(() => new Map(props.nodes.map((node) => [node.id, node])));
  const nodeFor = (id: string) => nodeIndex().get(id);
  const rotationForNode = (node: MapTreeNode): CanvasScreenRotation =>
    screenRotations()[node.id] ?? "none";
  const rotationForNodeId = (nodeId: string): CanvasScreenRotation => {
    const node = nodeFor(nodeId);
    return node ? rotationForNode(node) : "none";
  };
  const rememberRotation = (nodeId: string, rotation: ScreenshotRotation) => {
    if (screenRotations()[nodeId] === rotation) return;
    setScreenRotations((current) => ({ ...current, [nodeId]: rotation }));
    props.onScreenRotationChange?.(nodeId, rotation);
  };
  const geometryForNode = (node: MapTreeNode) => {
    const evidence = props.orientationEvidenceFor(node);
    return screenCardGeometry({
      ...evidence,
      logicalViewport: evidence?.logicalViewport ?? screenNaturalSizes()[node.id],
    });
  };
  const rememberNaturalSize = (nodeId: string, size: { width: number; height: number }) => {
    if (!size.width || !size.height) return;
    setScreenNaturalSizes((current) => {
      const previous = current[nodeId];
      return previous?.width === size.width && previous.height === size.height
        ? current
        : { ...current, [nodeId]: size };
    });
  };
  const autoConnectionLanes = createMemo(() =>
    connectorAutoLanes(
      props.connections,
      (screenId) => {
        const node = nodeFor(screenId);
        return node ? props.positionFor(node) : undefined;
      },
      (screenId) => {
        const node = nodeFor(screenId);
        return node ? geometryForNode(node) : undefined;
      },
    ),
  );
  const visibleNodes = createMemo(() =>
    props.nodes.filter((node) => {
      if (selectedNodeIds().has(node.id) || node.id === props.renamingNodeId) return true;
      const point = props.positionFor(node);
      return (
        point.x + SCREEN_CARD_WIDTH >= props.visibleBounds.left &&
        point.x <= props.visibleBounds.right &&
        point.y + SCREEN_CARD_HEIGHT >= props.visibleBounds.top &&
        point.y <= props.visibleBounds.bottom
      );
    }),
  );
  const visibleNodeIds = createMemo(() => new Set(visibleNodes().map((node) => node.id)));
  const visibleConnections = createMemo(() => {
    return props.connections.filter((connection) => {
      return (
        visibleNodeIds().has(connection.fromScreenId) || visibleNodeIds().has(connection.toScreenId)
      );
    });
  });
  const effectivePresentation = (connection: CanvasConnection) => {
    const controlDrag = connectionControlDrag();
    return controlDrag?.connectionId === connection.id
      ? controlDrag.presentation
      : connection.presentation;
  };
  const displayedPresentation = (connection: CanvasConnection) =>
    connectorPresentationWithAutoLane(
      { id: connection.id, presentation: effectivePresentation(connection) },
      autoConnectionLanes(),
    );
  const hasAutomaticSourceLane = (connection: CanvasConnection) =>
    connectorHasAutomaticSourceLane(
      { id: connection.id, presentation: effectivePresentation(connection) },
      autoConnectionLanes(),
    );
  const geometries = createMemo(
    () =>
      new Map(
        visibleConnections().map((connection) => [
          connection.id,
          canvasEdgeGeometry(
            {
              from: connection.fromScreenId,
              to: connection.toScreenId,
              kind: connection.kind,
              sourceAnchor: connection.sourceAnchor,
              sourceRotation: rotationForNodeId(connection.fromScreenId),
              presentation: displayedPresentation(connection),
              automaticSourceLane: hasAutomaticSourceLane(connection),
              targetGap: connectorTargetGapForViewport(props.viewportScale),
            },
            props.nodes,
            props.positionFor,
            nodeIndex(),
            geometryForNode,
          ),
        ]),
      ),
  );
  const geometryFor = (connection: CanvasConnection) =>
    geometries().get(connection.id) ?? {
      path: "",
      labelPoint: { x: 0, y: 0 },
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 0 },
      hitPoints: [],
    };
  const selectedConnection = createMemo(() =>
    props.connections.find((connection) => connection.id === props.selectedConnectionId),
  );
  const selectedCurveConnection = createMemo(() => {
    const connection = selectedConnection();
    return connection &&
      visibleConnections().some((candidate) => candidate.id === connection.id) &&
      (displayedPresentation(connection)?.route ?? "elbow") === "curve"
      ? connection
      : undefined;
  });
  const selectedConnectionOrigin = createMemo(() => {
    const connection = selectedConnection();
    if (!connection?.sourceAnchor || !visibleNodeIds().has(connection.fromScreenId))
      return undefined;
    const node = nodeFor(connection.fromScreenId);
    return node ? { connection, node } : undefined;
  });
  const pointerInCanvas = (event: PointerEvent, element: SVGGraphicsElement): CanvasPoint => {
    const svg = element.ownerSVGElement;
    const matrix = svg?.getScreenCTM()?.inverse();
    if (!svg || !matrix) return { x: event.clientX, y: event.clientY };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(matrix);
    return { x: transformed.x, y: transformed.y };
  };
  const selectConnectionAtPointer = (connection: CanvasConnection, event?: MouseEvent) => {
    if (event) {
      const target = event.currentTarget;
      if (target instanceof SVGGraphicsElement) {
        setConnectorToolbarAnchor({
          connectionId: connection.id,
          point: pointerInCanvas(event as PointerEvent, target),
        });
      }
    }
    props.onSelectConnection(connection);
  };
  const toolbarAnchorFor = (connection: CanvasConnection): CanvasPoint => {
    const remembered = connectorToolbarAnchor();
    if (remembered?.connectionId === connection.id) return remembered.point;
    const geometry = geometryFor(connection);
    const visiblePoints = geometry.hitPoints.filter(
      (point) =>
        point.x >= props.visibleBounds.left &&
        point.x <= props.visibleBounds.right &&
        point.y >= props.visibleBounds.top &&
        point.y <= props.visibleBounds.bottom,
    );
    if (!visiblePoints.length) return geometry.labelPoint;
    return visiblePoints.reduce((closest, point) =>
      Math.hypot(point.x - geometry.labelPoint.x, point.y - geometry.labelPoint.y) <
      Math.hypot(closest.x - geometry.labelPoint.x, closest.y - geometry.labelPoint.y)
        ? point
        : closest,
    );
  };
  const beginControlDrag = (event: PointerEvent, connection: CanvasConnection) => {
    event.stopPropagation();
    const element = event.currentTarget as SVGCircleElement;
    element.setPointerCapture(event.pointerId);
    setConnectionControlDrag({
      connectionId: connection.id,
      presentation: { ...connection.presentation, route: "curve" },
      originPointer: pointerInCanvas(event, element),
      originOffset: connection.presentation?.controlOffset ?? { x: 0, y: 0 },
    });
  };
  const moveControlDrag = (event: PointerEvent, connection: CanvasConnection) => {
    const drag = connectionControlDrag();
    if (!drag || drag.connectionId !== connection.id) return;
    const pointer = pointerInCanvas(event, event.currentTarget as SVGGraphicsElement);
    setConnectionControlDrag({
      ...drag,
      presentation: {
        ...drag.presentation,
        route: "curve",
        controlOffset: {
          x: drag.originOffset.x + pointer.x - drag.originPointer.x,
          y: drag.originOffset.y + pointer.y - drag.originPointer.y,
        },
      },
    });
  };
  const finishControlDrag = (event: PointerEvent, connection: CanvasConnection) => {
    const drag = connectionControlDrag();
    if (!drag || drag.connectionId !== connection.id) return;
    event.stopPropagation();
    setConnectionControlDrag(null);
    props.onChangeConnectionPresentation(connection, drag.presentation);
  };
  const nudgeCurveControl = (event: KeyboardEvent, connection: CanvasConnection) => {
    const multiplier = event.shiftKey ? 4 : 1;
    const delta =
      event.key === "ArrowLeft"
        ? { x: -CURVE_KEYBOARD_NUDGE * multiplier, y: 0 }
        : event.key === "ArrowRight"
          ? { x: CURVE_KEYBOARD_NUDGE * multiplier, y: 0 }
          : event.key === "ArrowUp"
            ? { x: 0, y: -CURVE_KEYBOARD_NUDGE * multiplier }
            : event.key === "ArrowDown"
              ? { x: 0, y: CURVE_KEYBOARD_NUDGE * multiplier }
              : undefined;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const offset = connection.presentation?.controlOffset ?? { x: 0, y: 0 };
    props.onChangeConnectionPresentation(connection, {
      ...connection.presentation,
      route: "curve",
      controlOffset: { x: offset.x + delta.x, y: offset.y + delta.y },
    });
  };
  const visibleNotes = createMemo(() =>
    props.notes.filter(
      (note) =>
        note.x + 220 >= props.visibleBounds.left &&
        note.x <= props.visibleBounds.right &&
        note.y + 140 >= props.visibleBounds.top &&
        note.y <= props.visibleBounds.bottom,
    ),
  );

  return (
    <>
      <svg
        class="pointer-events-none absolute inset-0 overflow-visible"
        width={props.width}
        height={props.height}
        aria-label="Map paths"
      >
        <For each={props.combines?.filter((combine) => combine.startsAt) ?? []}>
          {(combine) => {
            const start = combine.startsAt!;
            const x1 = start.position.x + SCREEN_CARD_WIDTH;
            const y1 = start.position.y + 22;
            const x2 = combine.position.x;
            const y2 = combine.position.y + 22;
            const bend = Math.max(12, (x2 - x1) / 2);
            return (
              <path
                d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
                class="fill-none stroke-[var(--text-interactive-base)] opacity-55 [stroke-dasharray:3_4]"
                stroke-width="1.25"
                stroke-linecap="round"
                aria-hidden="true"
              />
            );
          }}
        </For>
        <For each={visibleConnections()}>
          {(connection) => {
            const geometry = () => geometryFor(connection);
            const runState = () => props.connectionRunState(connection.id);
            const presentation = () => displayedPresentation(connection);
            const strokeWidth = () => presentation()?.strokeWidth ?? 2;
            const arrow = () => presentation()?.arrow ?? "end";
            const selected = () => props.selectedConnectionId === connection.id;
            const hovered = () => hoveredConnectionId() === connection.id;
            // Routes live in world coordinates but must remain practical to
            // select at every zoom level. The broad hit lane and selection
            // halo therefore use screen-relative widths.
            const hitStrokeWidth = () =>
              Math.max(16, connectorHitWidthInScreenPixels() / Math.max(props.viewportScale, 0.01));
            const selectedHaloWidth = () =>
              Math.max(strokeWidth() + 6, 10 / Math.max(props.viewportScale, 0.01));
            const hoveredHaloWidth = () =>
              Math.max(strokeWidth() + 4, 8 / Math.max(props.viewportScale, 0.01));
            const strokeClass = () => connectionStrokeClass(runState(), connection, selected());
            const connectionName = () => {
              const source = nodeFor(connection.fromScreenId);
              const target = nodeFor(connection.toScreenId);
              return `Path from ${source ? props.titleFor(source) : "start screen"} to ${target ? props.titleFor(target) : "next screen"}`;
            };
            return (
              <g>
                <Show when={hovered() && !selected()}>
                  <path
                    d={geometry().path}
                    class="pointer-events-none fill-none stroke-[color-mix(in_srgb,var(--text-interactive-base)_30%,transparent)]"
                    stroke-width={hoveredHaloWidth()}
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                    data-connection-hover-halo={connection.id}
                  />
                </Show>
                <Show when={selected()}>
                  <path
                    d={geometry().path}
                    class="pointer-events-none fill-none stroke-[color-mix(in_srgb,var(--text-interactive-base)_22%,transparent)]"
                    stroke-width={selectedHaloWidth()}
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  />
                </Show>
                <path
                  d={geometry().path}
                  class={cn("pointer-events-none fill-none", strokeClass())}
                  stroke-width={strokeWidth()}
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <Show when={arrow() === "start" || arrow() === "both"}>
                  <path
                    d={canvasEdgeStartArrowPath(geometry(), strokeWidth())}
                    class={cn("pointer-events-none fill-none", strokeClass())}
                    stroke-width={strokeWidth()}
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  />
                </Show>
                <Show when={arrow() === "end" || arrow() === "both"}>
                  <path
                    d={canvasEdgeArrowPath(geometry(), strokeWidth())}
                    class={cn("pointer-events-none fill-none", strokeClass())}
                    stroke-width={strokeWidth()}
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  />
                </Show>
                <path
                  d={geometry().path}
                  class="pointer-events-auto cursor-pointer fill-none stroke-transparent focus:outline-none"
                  stroke-width={hitStrokeWidth()}
                  role="button"
                  tabindex="0"
                  ref={(element) => element.setAttribute("focusable", "true")}
                  aria-label={connectionName()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerEnter={() => setHoveredConnectionId(connection.id)}
                  onPointerLeave={() =>
                    setHoveredConnectionId((current) =>
                      current === connection.id ? null : current,
                    )
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    selectConnectionAtPointer(connection, event);
                  }}
                  onFocus={() => {
                    setHoveredConnectionId(connection.id);
                    selectConnectionAtPointer(connection);
                  }}
                  onBlur={() =>
                    setHoveredConnectionId((current) =>
                      current === connection.id ? null : current,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    selectConnectionAtPointer(connection);
                  }}
                />
              </g>
            );
          }}
        </For>
      </svg>

      <For each={visibleConnections()}>
        {(connection) => {
          const geometry = () => geometryFor(connection);
          const count = () => props.caseCountFor(connection);
          const source = () => nodeFor(connection.fromScreenId);
          const target = () => nodeFor(connection.toScreenId);
          const showLabel = () => {
            return props.connectionLabelMode(connection) === "always";
          };
          return (
            <button
              type="button"
              class={cn(
                "group absolute z-[6] flex min-h-6 max-w-52 items-center gap-1 rounded-[5px] bg-[color-mix(in_srgb,var(--map-canvas)_94%,transparent)] px-1.5 text-[10.5px] font-medium text-[var(--text-base)] backdrop-blur-[6px] transition-[background-color,box-shadow,color] duration-150 before:absolute before:-inset-1 before:rounded-[8px] hover:bg-[var(--background-base)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]",
                !showLabel() && "pointer-events-none opacity-0",
                props.selectedConnectionId === connection.id &&
                  "bg-[var(--background-base)] text-[var(--text-interactive-base)] shadow-[var(--map-elevation-control)]",
              )}
              style={{
                left: `${geometry().labelPoint.x}px`,
                top: `${geometry().labelPoint.y - 19}px`,
                transform: "translate(-50%, -50%)",
              }}
              aria-label={`Open path from ${source() ? props.titleFor(source()!) : "start screen"} to ${target() ? props.titleFor(target()!) : "next screen"}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                selectConnectionAtPointer(connection);
              }}
            >
              <span class="truncate">
                {connection.label ||
                  (connection.state === "needs-recording" ? "Record path" : "Open path")}
              </span>
              <Show when={count()}>
                {(value) => (
                  <span class="inline-flex items-center gap-1 text-[9.5px] font-normal tabular-nums text-[var(--text-weak)]">
                    <span aria-hidden="true">·</span>{" "}
                    {value().exact ? value().count : `~${value().count}`}{" "}
                    {value().count === 1 ? "run" : "runs"}
                  </span>
                )}
              </Show>
            </button>
          );
        }}
      </For>

      <Show when={selectedConnection()}>
        {(connection) => (
          <AppMapConnectionToolbar
            connection={connection()}
            anchor={toolbarAnchorFor(connection())}
            viewportScale={props.viewportScale}
            visibleBounds={props.visibleBounds}
            onChangePresentation={(presentation) =>
              props.onChangeConnectionPresentation(connection(), presentation)
            }
          />
        )}
      </Show>

      <CollaborationPresence
        awareness={props.awareness}
        geometry={props.presenceGeometry}
        width={props.width}
        height={props.height}
      />

      <For each={visibleNodes()}>
        {(node) => {
          const selectedConnectionForNode = () => {
            const connection = selectedConnection();
            return connection?.fromScreenId === node.id ? connection : undefined;
          };
          return (
            <ScreenCard
              node={node}
              isFlowStart={props.isFlowStart(node)}
              title={props.titleFor(node)}
              selected={selectedNodeIds().has(node.id)}
              showActions={props.selectedNodeIds.length === 1 && props.selectedNodeId === node.id}
              editing={props.renamingNodeId === node.id}
              runState={props.screenRunState(node.id)}
              here={props.hereScreenId === node.id}
              position={props.positionFor(node)}
              geometry={geometryForNode(node)}
              src={() => props.imageFor(node)}
              orientationEvidence={props.orientationEvidenceFor(node)}
              onNaturalSize={(size) => rememberNaturalSize(node.id, size)}
              selectedConnectionOrigin={selectedConnectionForNode()?.sourceAnchor}
              connectionOrigin={Boolean(selectedConnectionForNode())}
              onRotationChange={(rotation) => rememberRotation(node.id, rotation)}
              onSelect={(event) => props.onSelectNode(node, event)}
              onRename={() => props.onRenameNode(node)}
              onOpenDetails={() => props.onOpenNodeDetails(node)}
              onRun={props.canRunToScreen(node.id) ? () => props.onRunToScreen(node) : undefined}
              onCommitRename={(title) => props.onCommitNodeRename(node, title)}
              onPointerDown={(event) => props.onNodePointerDown(event, node)}
            />
          );
        }}
      </For>

      <Show when={selectedConnectionOrigin()}>
        {(origin) => {
          const connection = () => origin().connection;
          const geometry = () => geometryFor(connection());
          const frame = () =>
            screenFrameBounds(props.positionFor(origin().node), geometryForNode(origin().node));
          const clipId = connectionOriginClipId(connection().id);
          const strokeWidth = () => displayedPresentation(connection())?.strokeWidth ?? 2;
          const haloWidth = () =>
            Math.max(strokeWidth() + 6, 10 / Math.max(props.viewportScale, 0.01));
          return (
            <svg
              class="pointer-events-none absolute inset-0 z-[21] overflow-visible"
              width={props.width}
              height={props.height}
              aria-hidden="true"
              data-connection-origin-guide
            >
              <defs>
                <clipPath id={clipId}>
                  <rect
                    x={frame().left}
                    y={frame().top}
                    width={frame().right - frame().left}
                    height={frame().bottom - frame().top}
                  />
                </clipPath>
              </defs>
              <path
                d={geometry().path}
                clip-path={`url(#${clipId})`}
                class="fill-none stroke-[color-mix(in_srgb,var(--text-interactive-base)_22%,transparent)]"
                stroke-width={haloWidth()}
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d={geometry().path}
                clip-path={`url(#${clipId})`}
                class="fill-none stroke-[var(--text-interactive-base)]"
                stroke-width={strokeWidth()}
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          );
        }}
      </Show>

      <For each={visibleNotes()}>
        {(note) => (
          <CanvasNoteCard
            note={note}
            onPointerDown={(event) => props.onNotePointerDown(event, note)}
            onText={(text) => props.onNoteText(note, text)}
            onCommit={(previousText) => props.onCommitNote(note, previousText)}
            onDelete={() => props.onDeleteNote(note)}
          />
        )}
      </For>

      <For each={props.combines ?? []}>
        {(combine) => (
          <CanvasCombineCard
            id={combine.id}
            name={combine.name}
            position={combine.position}
            startsAt={combine.startsAt}
            modifiers={combine.modifiers}
            tests={combine.tests}
            cellCount={combine.cellCount}
            run={combine.run}
            onOpen={(section) => props.onOpenCombine?.(combine.id, section)}
            onOpenResults={props.onOpenCombineResults}
          />
        )}
      </For>

      <Show when={selectedCurveConnection()}>
        {(connection) => {
          const geometry = () => geometryFor(connection());
          const hitRadius = () => 22 / Math.max(props.viewportScale, 0.01);
          const visibleRadius = () => 5.5 / Math.max(props.viewportScale, 0.01);
          return (
            <svg
              class="pointer-events-none absolute inset-0 z-[21] overflow-visible"
              width={props.width}
              height={props.height}
              role="group"
              aria-label="Curve anchor controls"
            >
              <circle
                cx={geometry().labelPoint.x}
                cy={geometry().labelPoint.y}
                r={hitRadius()}
                class="cursor-grab touch-none fill-transparent stroke-transparent focus-visible:stroke-[var(--border-focus)] active:cursor-grabbing"
                pointer-events="all"
                role="button"
                tabindex="0"
                ref={(element) => element.setAttribute("focusable", "true")}
                aria-label="Adjust cubic curve. Drag to reshape it, or use arrow keys to move it; hold Shift for larger steps."
                aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
                data-tip="Drag to reshape curve · Arrow keys nudge"
                onPointerDown={(event) => beginControlDrag(event, connection())}
                onPointerMove={(event) => moveControlDrag(event, connection())}
                onPointerUp={(event) => finishControlDrag(event, connection())}
                onPointerCancel={() => setConnectionControlDrag(null)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => nudgeCurveControl(event, connection())}
              />
              <circle
                cx={geometry().labelPoint.x}
                cy={geometry().labelPoint.y}
                r={visibleRadius()}
                class="pointer-events-none fill-[var(--background-base)] stroke-[var(--text-interactive-base)]"
                stroke-width={2 / Math.max(props.viewportScale, 0.01)}
                aria-hidden="true"
              />
            </svg>
          );
        }}
      </Show>
    </>
  );
}
