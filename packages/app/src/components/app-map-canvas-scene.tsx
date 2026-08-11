import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import type { CollaborationAwareness, CanvasNote } from "@relay/protocol";
import { cn } from "../lib/cn";
import {
  canvasEdgeGeometry,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  screenCardGeometry,
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
  draggingNodeIds: readonly string[];
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

const markerClass = (
  state: AppMapRunPresentationState | undefined,
  connection: CanvasConnection,
  selected: boolean,
) =>
  state === "failed"
    ? "failed"
    : state === "healed"
      ? "healed"
      : state === "passed"
        ? "verified"
        : selected
          ? "selected"
          : connection.review?.status === "failed"
            ? "failed"
            : connection.review?.status === "verified"
              ? "verified"
              : connection.kind === "return"
                ? "return"
                : "arrow";

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
        : state === "passed"
          ? "stroke-[var(--icon-success-base)]"
          : selected
            ? "stroke-[var(--text-interactive-base)]"
            : connection.state === "needs-recording"
              ? "stroke-[var(--text-weak)] [stroke-dasharray:5_5]"
              : connection.review?.status === "failed"
                ? "stroke-[var(--icon-critical-base)]"
                : connection.kind === "return"
                  ? "stroke-[var(--text-weak)] [stroke-dasharray:6_6]"
                  : "stroke-[color-mix(in_srgb,var(--text-weak)_78%,transparent)]";

export function AppMapCanvasScene(props: AppMapCanvasSceneProps) {
  const [screenRotations, setScreenRotations] = createSignal<Record<string, CanvasScreenRotation>>(
    {},
  );
  const [screenNaturalSizes, setScreenNaturalSizes] = createSignal<
    Record<string, { width: number; height: number }>
  >({});
  const [hoveredConnectionId, setHoveredConnectionId] = createSignal<string | null>(null);
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
    const dragging = new Set(props.draggingNodeIds);
    const selectedNodes = selectedNodeIds();
    const primary = new Set(props.primaryConnectionIds);
    return props.connections.filter((connection) => {
      if (dragging.size) {
        return dragging.has(connection.fromScreenId) || dragging.has(connection.toScreenId);
      }
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
        <defs>
          <For
            each={
              [
                ["arrow", "var(--text-weak)"],
                ["return", "var(--text-weak)"],
                ["selected", "var(--text-interactive-base)"],
                ["verified", "var(--icon-success-base)"],
                ["failed", "var(--icon-critical-base)"],
                ["healed", "var(--icon-warning-base)"],
              ] as const
            }
          >
            {([id, color]) => (
              <marker
                id={`app-map-${id}`}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path
                  d="M 1 1 L 8 5 L 1 9"
                  style={{ fill: "none", stroke: color, "stroke-width": 1.7 }}
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </marker>
            )}
          </For>
        </defs>
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
            return (
              <g>
                <path
                  d={geometry().path}
                  class={cn(
                    "pointer-events-none fill-none",
                    connectionStrokeClass(
                      runState(),
                      connection,
                      props.selectedConnectionId === connection.id,
                    ),
                  )}
                  stroke-width={
                    props.selectedConnectionId === connection.id
                      ? 2
                      : connection.state === "needs-recording"
                        ? 1.5
                        : connection.kind === "return"
                          ? 1.5
                          : 1.5
                  }
                  stroke-linecap="round"
                  marker-end={`url(#app-map-${markerClass(
                    runState(),
                    connection,
                    props.selectedConnectionId === connection.id,
                  )})`}
                />
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
                <Show
                  when={
                    connection.sourceAnchor &&
                    (props.selectedConnectionId === connection.id ||
                      hoveredConnectionId() === connection.id)
                  }
                >
                  <circle
                    cx={geometry().startPoint.x}
                    cy={geometry().startPoint.y}
                    r="4"
                    class="pointer-events-none fill-[var(--map-canvas)] stroke-[var(--text-interactive-base)]"
                    stroke-width="1.5"
                    aria-hidden="true"
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
