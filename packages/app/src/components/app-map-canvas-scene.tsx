import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import type {
  CollaborationAwareness,
  CanvasNote,
  ConnectionPort,
  ConnectionPresentation,
  ConnectionRouteStyle,
} from "@relay/protocol";
import { cn } from "../lib/cn";
import {
  canvasEdgeArrowPath,
  canvasEdgeGeometry,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  screenCardGeometry,
  screenFrameBounds,
  type CanvasScreenRotation,
  type CanvasPoint,
} from "../lib/app-map-canvas-layout";
import type { MapTreeNode } from "../lib/app-map-tree";
import type { CanvasConnection } from "../lib/app-map-connection-draft";
import type { AppMapRunPresentationState } from "../lib/app-map-run-projection";
import type { CanvasCombineCardModel, CanvasCombineSection } from "../lib/app-map-combine-canvas";
import type { PresenceGeometry } from "./collaboration-presence";
import { CollaborationPresence } from "./collaboration-presence";
import { CanvasCombineCard, CanvasNoteCard, ScreenCard } from "./app-map-canvas-primitives";
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
  primaryConnectionIds: readonly string[];
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
  hereScreenId?: string | null;
  combines?: readonly CanvasCombineCardModel[];
  onOpenCombine?: (combineId: string, section: CanvasCombineSection) => void;
  onOpenCombineResults?: (jobId: string) => void;
};

type ConnectionPortDrag = {
  connectionId: string;
  endpoint: "source" | "target";
  presentation: ConnectionPresentation;
};

type EdgeAttachment = {
  port: Exclude<ConnectionPort, "auto">;
  offset: number;
};

type ConnectionControlDrag = {
  connectionId: string;
  presentation: ConnectionPresentation;
  originPointer: CanvasPoint;
  originOffset: CanvasPoint;
};

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
  const [connectionPortDrag, setConnectionPortDrag] = createSignal<ConnectionPortDrag | null>(null);
  const [connectionControlDrag, setConnectionControlDrag] =
    createSignal<ConnectionControlDrag | null>(null);
  let clearHoveredConnectionTimer: ReturnType<typeof setTimeout> | undefined;
  const keepConnectionHovered = (connectionId: string) => {
    if (clearHoveredConnectionTimer) clearTimeout(clearHoveredConnectionTimer);
    setHoveredConnectionId(connectionId);
  };
  const releaseConnectionHover = (connectionId: string) => {
    if (clearHoveredConnectionTimer) clearTimeout(clearHoveredConnectionTimer);
    clearHoveredConnectionTimer = setTimeout(() => {
      if (hoveredConnectionId() === connectionId) setHoveredConnectionId(null);
    }, 60);
  };
  onCleanup(() => {
    if (clearHoveredConnectionTimer) clearTimeout(clearHoveredConnectionTimer);
  });
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
    setScreenRotations((current) =>
      current[nodeId] === rotation ? current : { ...current, [nodeId]: rotation },
    );
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
    const selectedNodes = selectedNodeIds();
    const primary = new Set(props.primaryConnectionIds);
    return props.connections.filter((connection) => {
      const touchesSelected =
        selectedNodes.has(connection.fromScreenId) || selectedNodes.has(connection.toScreenId);
      return (
        connection.id === props.selectedConnectionId ||
        touchesSelected ||
        (primary.has(connection.id) &&
          (visibleNodeIds().has(connection.fromScreenId) ||
            visibleNodeIds().has(connection.toScreenId)))
      );
    });
  });
  const displayedPresentation = (connection: CanvasConnection) => {
    const portDrag = connectionPortDrag();
    if (portDrag?.connectionId === connection.id) return portDrag.presentation;
    const controlDrag = connectionControlDrag();
    return controlDrag?.connectionId === connection.id
      ? controlDrag.presentation
      : connection.presentation;
  };
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
  const nearestAttachment = (point: CanvasPoint, nodeId: string): EdgeAttachment | undefined => {
    const node = nodeFor(nodeId);
    if (!node) return undefined;
    const frame = screenFrameBounds(props.positionFor(node), geometryForNode(node));
    const distances: Array<[Exclude<ConnectionPort, "auto">, number]> = [
      ["left", Math.abs(point.x - frame.left)],
      ["right", Math.abs(point.x - frame.right)],
      ["top", Math.abs(point.y - frame.top)],
      ["bottom", Math.abs(point.y - frame.bottom)],
    ];
    distances.sort((left, right) => left[1] - right[1]);
    const port = distances[0]![0];
    const vertical = port === "left" || port === "right";
    const rawOffset = vertical
      ? (point.y - frame.top) / (frame.bottom - frame.top)
      : (point.x - frame.left) / (frame.right - frame.left);
    return { port, offset: Math.max(0, Math.min(1, rawOffset)) };
  };
  const beginPortDrag = (
    event: PointerEvent,
    connection: CanvasConnection,
    endpoint: "source" | "target",
  ) => {
    event.stopPropagation();
    (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
    setConnectionPortDrag({
      connectionId: connection.id,
      endpoint,
      presentation: { ...connection.presentation },
    });
  };
  const movePortDrag = (event: PointerEvent, connection: CanvasConnection) => {
    const drag = connectionPortDrag();
    if (!drag || drag.connectionId !== connection.id) return;
    const point = pointerInCanvas(event, event.currentTarget as SVGGraphicsElement);
    const attachment = nearestAttachment(
      point,
      drag.endpoint === "source" ? connection.fromScreenId : connection.toScreenId,
    );
    if (!attachment) return;
    const presentation =
      drag.endpoint === "source"
        ? {
            ...drag.presentation,
            sourcePort: attachment.port,
            sourceOffset: attachment.offset,
          }
        : {
            ...drag.presentation,
            targetPort: attachment.port,
            targetOffset: attachment.offset,
          };
    setConnectionPortDrag({ ...drag, presentation });
  };
  const finishPortDrag = (event: PointerEvent, connection: CanvasConnection) => {
    const drag = connectionPortDrag();
    if (!drag || drag.connectionId !== connection.id) return;
    event.stopPropagation();
    setConnectionPortDrag(null);
    props.onChangeConnectionPresentation(connection, drag.presentation);
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
            const strokeClass = () =>
              connectionStrokeClass(
                runState(),
                connection,
                props.selectedConnectionId === connection.id,
              );
            return (
              <g>
                <path
                  d={geometry().path}
                  class={cn("pointer-events-none fill-none", strokeClass())}
                  stroke-width={strokeWidth()}
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <Show when={presentation()?.arrow !== "none"}>
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
                  class="pointer-events-auto cursor-pointer fill-none stroke-transparent"
                  stroke-width="16"
                  aria-hidden="true"
                  onPointerEnter={() => keepConnectionHovered(connection.id)}
                  onPointerLeave={() => releaseConnectionHover(connection.id)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onSelectConnection(connection);
                  }}
                />
                <Show when={connection.sourceAnchor && hoveredConnectionId() === connection.id}>
                  <circle
                    cx={geometry().startPoint.x}
                    cy={geometry().startPoint.y}
                    r="4"
                    class="pointer-events-none fill-[var(--map-canvas)] stroke-[var(--text-interactive-base)]"
                    stroke-width="1.5"
                    aria-hidden="true"
                  />
                </Show>
                <Show when={props.selectedConnectionId === connection.id}>
                  <circle
                    cx={geometry().startPoint.x}
                    cy={geometry().startPoint.y}
                    r="5.5"
                    class="pointer-events-auto cursor-grab fill-[var(--background-base)] stroke-[var(--text-interactive-base)] active:cursor-grabbing"
                    stroke-width="2"
                    aria-label="Move path start attachment"
                    onPointerDown={(event) => beginPortDrag(event, connection, "source")}
                    onPointerMove={(event) => movePortDrag(event, connection)}
                    onPointerUp={(event) => finishPortDrag(event, connection)}
                    onPointerCancel={() => setConnectionPortDrag(null)}
                  />
                  <circle
                    cx={geometry().endPoint.x}
                    cy={geometry().endPoint.y}
                    r="5.5"
                    class="pointer-events-auto cursor-grab fill-[var(--background-base)] stroke-[var(--text-interactive-base)] active:cursor-grabbing"
                    stroke-width="2"
                    aria-label="Move path end attachment"
                    onPointerDown={(event) => beginPortDrag(event, connection, "target")}
                    onPointerMove={(event) => movePortDrag(event, connection)}
                    onPointerUp={(event) => finishPortDrag(event, connection)}
                    onPointerCancel={() => setConnectionPortDrag(null)}
                  />
                  <circle
                    cx={geometry().labelPoint.x}
                    cy={geometry().labelPoint.y}
                    r="5.5"
                    class="pointer-events-auto cursor-move fill-[var(--background-base)] stroke-[var(--text-interactive-base)]"
                    stroke-width="2"
                    aria-label="Adjust path curve"
                    onPointerDown={(event) => beginControlDrag(event, connection)}
                    onPointerMove={(event) => moveControlDrag(event, connection)}
                    onPointerUp={(event) => finishControlDrag(event, connection)}
                    onPointerCancel={() => setConnectionControlDrag(null)}
                  />
                </Show>
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
              onFocus={() => keepConnectionHovered(connection.id)}
              onBlur={() => releaseConnectionHover(connection.id)}
              onPointerEnter={() => keepConnectionHovered(connection.id)}
              onPointerLeave={() => releaseConnectionHover(connection.id)}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                props.onSelectConnection(connection);
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

      <Show
        when={props.connections.find((connection) => connection.id === props.selectedConnectionId)}
      >
        {(connection) => {
          const geometry = () => geometryFor(connection());
          const presentation = () => connection().presentation ?? {};
          const update = (patch: Partial<ConnectionPresentation>) =>
            props.onChangeConnectionPresentation(connection(), {
              ...presentation(),
              ...patch,
            });
          const routeButton = (route: ConnectionRouteStyle, label: string) => (
            <button
              type="button"
              class={cn(
                "grid size-8 place-items-center rounded-[6px] text-[var(--text-base)] hover:bg-[var(--background-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]",
                (presentation().route ?? "curve") === route &&
                  "bg-[var(--background-interactive-subtle)] text-[var(--text-interactive-base)]",
              )}
              aria-label={label}
              title={label}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                update({ route });
              }}
            >
              <svg viewBox="0 0 20 20" class="size-4 fill-none stroke-current" aria-hidden="true">
                <path
                  d={
                    route === "elbow"
                      ? "M3 16V8a4 4 0 0 1 4-4h10"
                      : route === "straight"
                        ? "M3 16 17 4"
                        : "M3 16C3 7 17 13 17 4"
                  }
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          );
          return (
            <div
              class="absolute z-20 flex h-11 items-center gap-1 rounded-[10px] border border-[var(--border-base)] bg-[var(--background-base)] p-1 shadow-[var(--map-elevation-control)]"
              style={{
                left: `${geometry().labelPoint.x}px`,
                top: `${geometry().labelPoint.y + 26}px`,
                transform: "translate(-50%, 0)",
              }}
              role="toolbar"
              aria-label="Path appearance"
              onPointerDown={(event) => event.stopPropagation()}
            >
              {routeButton("elbow", "Elbow path")}
              {routeButton("curve", "Curved path")}
              {routeButton("straight", "Straight path")}
              <span class="mx-0.5 h-5 w-px bg-[var(--border-base)]" aria-hidden="true" />
              <select
                class="h-8 rounded-[6px] border-0 bg-transparent px-1.5 text-xs font-medium text-[var(--text-base)] hover:bg-[var(--background-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                aria-label="Path weight"
                value={presentation().strokeWidth ?? 2}
                onChange={(event) =>
                  update({ strokeWidth: Number(event.currentTarget.value) as 1 | 2 | 3 })
                }
              >
                <option value="1">1 px</option>
                <option value="2">2 px</option>
                <option value="3">3 px</option>
              </select>
              <button
                type="button"
                class={cn(
                  "grid size-8 place-items-center rounded-[6px] text-lg text-[var(--text-base)] hover:bg-[var(--background-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]",
                  presentation().arrow !== "none" &&
                    "bg-[var(--background-interactive-subtle)] text-[var(--text-interactive-base)]",
                )}
                aria-label={presentation().arrow === "none" ? "Show arrowhead" : "Hide arrowhead"}
                title={presentation().arrow === "none" ? "Show arrowhead" : "Hide arrowhead"}
                onClick={() => update({ arrow: presentation().arrow === "none" ? "end" : "none" })}
              >
                <span aria-hidden="true">→</span>
              </button>
              <select
                class="h-8 max-w-24 rounded-[6px] border-0 bg-transparent px-1 text-xs text-[var(--text-base)] hover:bg-[var(--background-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                aria-label="Start attachment"
                title="Start attachment"
                value={presentation().sourcePort ?? "auto"}
                onChange={(event) => {
                  const sourcePort = event.currentTarget.value as ConnectionPort;
                  update({
                    sourcePort,
                    ...(sourcePort === "auto" ? { sourceOffset: undefined } : {}),
                  });
                }}
              >
                <option value="auto">Start: Auto</option>
                <option value="left">Start: Left</option>
                <option value="right">Start: Right</option>
                <option value="top">Start: Top</option>
                <option value="bottom">Start: Bottom</option>
              </select>
              <select
                class="h-8 max-w-24 rounded-[6px] border-0 bg-transparent px-1 text-xs text-[var(--text-base)] hover:bg-[var(--background-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                aria-label="End attachment"
                title="End attachment"
                value={presentation().targetPort ?? "auto"}
                onChange={(event) => {
                  const targetPort = event.currentTarget.value as ConnectionPort;
                  update({
                    targetPort,
                    ...(targetPort === "auto" ? { targetOffset: undefined } : {}),
                  });
                }}
              >
                <option value="auto">End: Auto</option>
                <option value="left">End: Left</option>
                <option value="right">End: Right</option>
                <option value="top">End: Top</option>
                <option value="bottom">End: Bottom</option>
              </select>
              <button
                type="button"
                class="h-8 rounded-[6px] px-2 text-xs text-[var(--text-weak)] hover:bg-[var(--background-hover)] hover:text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                onClick={() => props.onChangeConnectionPresentation(connection(), undefined)}
              >
                Reset
              </button>
            </div>
          );
        }}
      </Show>

      <CollaborationPresence
        awareness={props.awareness}
        geometry={props.presenceGeometry}
        width={props.width}
        height={props.height}
      />

      <For each={visibleNodes()}>
        {(node) => {
          const selectedConnectionAnchor = () =>
            props.connections.find(
              (connection) =>
                connection.id === props.selectedConnectionId && connection.fromScreenId === node.id,
            )?.sourceAnchor;
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
              sourceAnchor={selectedConnectionAnchor()}
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
    </>
  );
}
