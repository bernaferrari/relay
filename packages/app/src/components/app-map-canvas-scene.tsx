import { For, Show, createMemo, createSignal } from "solid-js";
import type { CollaborationAwareness, CanvasNote, MapGroup } from "@relay/protocol";
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
import type { CanvasCombineCardModel } from "../lib/app-map-combine-canvas";
import type { PresenceGeometry } from "./collaboration-presence";
import { CollaborationPresence } from "./collaboration-presence";
import {
  CanvasCombineCard,
  CanvasNoteCard,
  KeyboardConnectionChooser,
  ScreenCard,
} from "./app-map-canvas-primitives";
import { AppMapGroupsLayer } from "./app-map-groups-layer";
import type { ScreenshotOrientationEvidence, ScreenshotRotation } from "./oriented-screenshot";

export type AppMapCanvasSceneProps = {
  nodes: MapTreeNode[];
  connections: readonly CanvasConnection[];
  notes: readonly CanvasNote[];
  groups: readonly MapGroup[];
  width: number;
  height: number;
  viewportScale: number;
  visibleBounds: { left: number; top: number; right: number; bottom: number };
  selectedNodeId: string | null;
  selectedNodeIds: readonly string[];
  selectedGroupId: string | null;
  selectedConnectionId: string | null;
  renamingNodeId: string | null;
  renamingGroupId: string | null;
  keyboardConnectionSourceId: string | null;
  awareness: readonly CollaborationAwareness[];
  presenceGeometry: PresenceGeometry;
  positionFor: (node: MapTreeNode) => CanvasPoint;
  titleFor: (node: MapTreeNode) => string;
  imageFor: (node: MapTreeNode) => string;
  orientationEvidenceFor: (node: MapTreeNode) => ScreenshotOrientationEvidence | undefined;
  isFlowStart: (node: MapTreeNode) => boolean;
  detailsOpen: boolean;
  screenRunState: (screenId: string) => AppMapRunPresentationState | undefined;
  connectionRunState: (connectionId: string) => AppMapRunPresentationState | undefined;
  caseCountFor: (connection: CanvasConnection) => { count: number; exact: boolean } | undefined;
  onSelectNode: (node: MapTreeNode, event?: MouseEvent) => void;
  onNodeContextMenu: (event: MouseEvent, node: MapTreeNode) => void;
  onSelectConnection: (connection: CanvasConnection) => void;
  onRenameNode: (node: MapTreeNode) => void;
  onOpenNodeDetails: (node: MapTreeNode) => void;
  onCommitNodeRename: (node: MapTreeNode, title: string) => void;
  onConnectKeyboard: (node: MapTreeNode) => void;
  onNodePointerDown: (event: PointerEvent, node: MapTreeNode) => void;
  onSelectGroup: (group: MapGroup) => void;
  onGroupPointerDown: (
    event: PointerEvent & { currentTarget: HTMLElement },
    group: MapGroup,
  ) => void;
  onGroupContextMenu: (event: MouseEvent, group: MapGroup) => void;
  onRenameGroup: (group: MapGroup) => void;
  onCommitGroupRename: (group: MapGroup, name: string) => void;
  onUngroup: (group: MapGroup) => void;
  onGroupSelection: () => void;
  onChooseKeyboardConnection: (sourceId: string, targetId: string) => void;
  onCreateKeyboardDestination: (sourceId: string) => void;
  onCancelKeyboardConnection: () => void;
  onNotePointerDown: (event: PointerEvent, note: CanvasNote) => void;
  onNoteText: (note: CanvasNote, text: string) => void;
  onCommitNote: (note: CanvasNote, previousText: string) => void;
  onDeleteNote: (note: CanvasNote) => void;
  hereScreenId?: string | null;
  combines?: readonly CanvasCombineCardModel[];
  onOpenCombine?: (combineId: string) => void;
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
  const selectedNodeIds = createMemo(() => new Set(props.selectedNodeIds));
  const screenPositions = createMemo(() =>
    Object.fromEntries(props.nodes.map((node) => [node.id, props.positionFor(node)])),
  );
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
  const geometryForNode = (node: MapTreeNode) =>
    screenCardGeometry(props.orientationEvidenceFor(node));
  const geometries = createMemo(
    () =>
      new Map(
        props.connections.map((connection) => [
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
    geometries().get(connection.id) ?? { path: "", labelPoint: { x: 0, y: 0 } };
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
  const visibleConnections = createMemo(() =>
    props.connections.filter((connection) => {
      if (
        connection.id === props.selectedConnectionId ||
        visibleNodeIds().has(connection.fromScreenId) ||
        visibleNodeIds().has(connection.toScreenId)
      ) {
        return true;
      }
      const from = nodeFor(connection.fromScreenId);
      const to = nodeFor(connection.toScreenId);
      if (!from || !to) return false;
      const fromPoint = props.positionFor(from);
      const toPoint = props.positionFor(to);
      const left = Math.min(fromPoint.x, toPoint.x);
      const right = Math.max(fromPoint.x, toPoint.x) + SCREEN_CARD_WIDTH;
      const top = Math.min(fromPoint.y, toPoint.y);
      const bottom = Math.max(fromPoint.y, toPoint.y) + SCREEN_CARD_HEIGHT;
      return (
        right >= props.visibleBounds.left &&
        left <= props.visibleBounds.right &&
        bottom >= props.visibleBounds.top &&
        top <= props.visibleBounds.bottom
      );
    }),
  );
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
      <AppMapGroupsLayer
        groups={props.groups}
        positions={screenPositions()}
        selectedGroupId={props.selectedGroupId}
        renamingGroupId={props.renamingGroupId}
        selectedScreenIds={selectedNodeIds()}
        viewportScale={props.viewportScale}
        onSelectGroup={props.onSelectGroup}
        onGroupPointerDown={props.onGroupPointerDown}
        onGroupContextMenu={props.onGroupContextMenu}
        onRenameGroup={props.onRenameGroup}
        onCommitGroupRename={props.onCommitGroupRename}
        onUngroup={props.onUngroup}
        onGroupSelection={props.onGroupSelection}
      />
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
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onSelectConnection(connection);
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
          return (
            <button
              type="button"
              class={cn(
                "group absolute z-[6] flex min-h-6 max-w-52 items-center gap-1 rounded-[5px] bg-[color-mix(in_srgb,var(--map-canvas)_94%,transparent)] px-1.5 text-[10.5px] font-medium text-[var(--text-base)] backdrop-blur-[6px] transition-[background-color,box-shadow,color] duration-150 before:absolute before:-inset-1 before:rounded-[8px] hover:bg-[var(--background-base)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]",
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
              detailsOpen={props.detailsOpen && node.id === props.selectedNodeId}
              sourceAnchor={selectedConnectionAnchor()}
              pathDraft={props.keyboardConnectionSourceId === node.id}
              onRotationChange={(rotation) => rememberRotation(node.id, rotation)}
              onSelect={(event) => props.onSelectNode(node, event)}
              onContextMenu={(event) => props.onNodeContextMenu(event, node)}
              onRename={() => props.onRenameNode(node)}
              onOpenDetails={() => props.onOpenNodeDetails(node)}
              onCommitRename={(title) => props.onCommitNodeRename(node, title)}
              onConnectKeyboard={() => props.onConnectKeyboard(node)}
              onPointerDown={(event) => props.onNodePointerDown(event, node)}
            />
          );
        }}
      </For>

      <Show when={props.keyboardConnectionSourceId}>
        {(sourceId) => {
          const source = () => nodeFor(sourceId());
          return (
            <KeyboardConnectionChooser
              sourceTitle={source() ? props.titleFor(source()!) : "Selected screen"}
              destinations={props.nodes
                .filter((node) => node.id !== sourceId())
                .map((node) => ({ id: node.id, title: props.titleFor(node) }))}
              onChoose={(targetId) => props.onChooseKeyboardConnection(sourceId(), targetId)}
              onCreate={() => props.onCreateKeyboardDestination(sourceId())}
              onCancel={props.onCancelKeyboardConnection}
            />
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
            values={combine.values}
            tests={combine.tests}
            cellCount={combine.cellCount}
            onOpen={() => props.onOpenCombine?.(combine.id)}
          />
        )}
      </For>
    </>
  );
}
