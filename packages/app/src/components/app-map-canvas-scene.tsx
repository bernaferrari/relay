import { For, Show } from "solid-js";
import type { CollaborationAwareness, CanvasNote } from "@relay/protocol";
import { cn } from "../lib/cn";
import {
  canvasEdgeGeometry,
  draftCanvasConnectionPath,
  type CanvasPoint,
} from "../lib/app-map-canvas-layout";
import type { MapTreeNode } from "../lib/app-map-tree";
import type { CanvasConnection } from "../lib/app-map-connection-draft";
import type { AppMapRunPresentationState } from "../lib/app-map-run-projection";
import type { PresenceGeometry } from "./collaboration-presence";
import { CollaborationPresence } from "./collaboration-presence";
import { CanvasNoteCard, KeyboardConnectionChooser, ScreenCard } from "./app-map-canvas-primitives";

type ConnectionPreview = Readonly<{
  fromScreenId: string;
  point: CanvasPoint;
}>;

export type AppMapCanvasSceneProps = {
  nodes: MapTreeNode[];
  connections: readonly CanvasConnection[];
  notes: readonly CanvasNote[];
  width: number;
  height: number;
  selectedNodeId: string | null;
  selectedConnectionId: string | null;
  renamingNodeId: string | null;
  keyboardConnectionSourceId: string | null;
  connectionPreview?: ConnectionPreview;
  awareness: readonly CollaborationAwareness[];
  presenceGeometry: PresenceGeometry;
  positionFor: (node: MapTreeNode) => CanvasPoint;
  titleFor: (node: MapTreeNode) => string;
  imageFor: (node: MapTreeNode) => string;
  isFlowStart: (node: MapTreeNode) => boolean;
  screenRunState: (screenId: string) => AppMapRunPresentationState | undefined;
  connectionRunState: (connectionId: string) => AppMapRunPresentationState | undefined;
  caseCountFor: (connection: CanvasConnection) => { count: number; exact: boolean } | undefined;
  onSelectNode: (node: MapTreeNode) => void;
  onSelectConnection: (connection: CanvasConnection) => void;
  onRenameNode: (node: MapTreeNode) => void;
  onOpenNodeDetails: (node: MapTreeNode) => void;
  onCommitNodeRename: (node: MapTreeNode, title: string) => void;
  onConnectStart: (event: PointerEvent, node: MapTreeNode) => void;
  onConnectKeyboard: (node: MapTreeNode) => void;
  onNodePointerDown: (event: PointerEvent, node: MapTreeNode) => void;
  onChooseKeyboardConnection: (sourceId: string, targetId: string) => void;
  onCreateKeyboardDestination: (sourceId: string) => void;
  onCancelKeyboardConnection: () => void;
  onNotePointerDown: (event: PointerEvent, note: CanvasNote) => void;
  onNoteText: (note: CanvasNote, text: string) => void;
  onCommitNote: () => void;
  onDeleteNote: (note: CanvasNote) => void;
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
  const nodeFor = (id: string) => props.nodes.find((node) => node.id === id);
  const geometryFor = (connection: CanvasConnection) =>
    canvasEdgeGeometry(
      {
        from: connection.fromScreenId,
        to: connection.toScreenId,
        kind: connection.kind,
      },
      props.nodes,
      props.positionFor,
    );

  return (
    <>
      <svg
        class="absolute inset-0 overflow-visible"
        width={props.width}
        height={props.height}
        aria-label="Map connections"
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
        <For each={props.connections}>
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
                  class="cursor-pointer fill-none stroke-transparent"
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
        <Show when={props.connectionPreview}>
          {(preview) => (
            <path
              d={draftCanvasConnectionPath(
                preview().fromScreenId,
                preview().point,
                props.nodes,
                props.positionFor,
              )}
              class="pointer-events-none fill-none stroke-[var(--text-interactive-base)] [stroke-dasharray:5_5]"
              stroke-width="2"
              stroke-linecap="round"
            />
          )}
        </Show>
      </svg>

      <For each={props.connections}>
        {(connection) => {
          const geometry = () => geometryFor(connection);
          const count = () => props.caseCountFor(connection);
          const source = () => nodeFor(connection.fromScreenId);
          const target = () => nodeFor(connection.toScreenId);
          return (
            <button
              type="button"
              class={cn(
                "group absolute z-[6] flex min-h-6 max-w-52 items-center gap-1 rounded-[5px] bg-[color-mix(in_srgb,var(--map-canvas)_94%,transparent)] px-1.5 text-[10.5px] font-medium text-[var(--text-base)] backdrop-blur-[6px] transition-[background-color,box-shadow,color] duration-150 before:absolute before:-inset-1 before:rounded-[8px] hover:bg-[var(--v2-background-bg-base)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]",
                props.selectedConnectionId === connection.id &&
                  "bg-[var(--v2-background-bg-base)] text-[var(--text-interactive-base)] shadow-[var(--map-elevation-control)]",
              )}
              style={{
                left: `${geometry().labelPoint.x}px`,
                top: `${geometry().labelPoint.y - 19}px`,
                transform: "translate(-50%, -50%)",
              }}
              aria-label={`Open connection from ${source() ? props.titleFor(source()!) : "source screen"} to ${target() ? props.titleFor(target()!) : "destination screen"}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                props.onSelectConnection(connection);
              }}
            >
              <span class="truncate">
                {connection.label ||
                  (connection.state === "needs-recording" ? "Add action" : "Open")}
              </span>
              <Show when={count()}>
                {(value) => (
                  <span class="inline-flex items-center gap-1 text-[9.5px] font-normal tabular-nums text-[var(--text-weak)]">
                    <span aria-hidden="true">·</span>{" "}
                    {value().exact ? value().count : `~${value().count}`}{" "}
                    {value().count === 1 ? "case" : "cases"}
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

      <For each={props.nodes}>
        {(node) => (
          <ScreenCard
            node={node}
            isFlowStart={props.isFlowStart(node)}
            title={props.titleFor(node)}
            selected={props.selectedNodeId === node.id}
            editing={props.renamingNodeId === node.id}
            runState={props.screenRunState(node.id)}
            position={props.positionFor(node)}
            src={() => props.imageFor(node)}
            onSelect={() => props.onSelectNode(node)}
            onRename={() => props.onRenameNode(node)}
            onOpenDetails={() => props.onOpenNodeDetails(node)}
            onCommitRename={(title) => props.onCommitNodeRename(node, title)}
            onConnectStart={(event) => props.onConnectStart(event, node)}
            onConnectKeyboard={() => props.onConnectKeyboard(node)}
            onPointerDown={(event) => props.onNodePointerDown(event, node)}
          />
        )}
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

      <For each={props.notes}>
        {(note) => (
          <CanvasNoteCard
            note={note}
            onPointerDown={(event) => props.onNotePointerDown(event, note)}
            onText={(text) => props.onNoteText(note, text)}
            onCommit={props.onCommitNote}
            onDelete={() => props.onDeleteNote(note)}
          />
        )}
      </For>
    </>
  );
}
