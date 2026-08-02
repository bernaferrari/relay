import { For, Show } from "solid-js";
import type { CollaborationAwareness, JourneyCanvasNote } from "@relay/protocol";
import type { RecipeStep } from "../context/server";
import { cn } from "../lib/cn";
import {
  canvasEdgeGeometry,
  draftCanvasConnectionPath,
  type CanvasPoint,
} from "../lib/journey-canvas-layout";
import type { JourneyTreeNode } from "../lib/journey-tree";
import type { CanvasConnection } from "../lib/journey-prototype";
import type { JourneyRunPresentationState } from "../lib/journey-run-projection";
import type { PresenceGeometry } from "./collaboration-presence";
import { CollaborationPresence } from "./collaboration-presence";
import { CanvasNote, KeyboardConnectionChooser, ScreenCard } from "./app-map-canvas-primitives";

type ConnectionPreview = Readonly<{
  fromScreenId: string;
  point: CanvasPoint;
}>;

export type AppMapCanvasSceneProps = {
  nodes: JourneyTreeNode[];
  connections: readonly CanvasConnection[];
  notes: readonly JourneyCanvasNote[];
  width: number;
  height: number;
  selectedNodeId: string | null;
  selectedConnectionId: string | null;
  renamingNodeId: string | null;
  keyboardConnectionSourceId: string | null;
  connectionPreview?: ConnectionPreview;
  awareness: readonly CollaborationAwareness[];
  presenceGeometry: PresenceGeometry;
  positionFor: (node: JourneyTreeNode) => CanvasPoint;
  titleFor: (node: JourneyTreeNode) => string;
  stepFor: (node: JourneyTreeNode) => RecipeStep | undefined;
  imageFor: (node: JourneyTreeNode) => string;
  isFlowStart: (node: JourneyTreeNode) => boolean;
  screenRunState: (screenId: string) => JourneyRunPresentationState | undefined;
  connectionRunState: (connectionId: string) => JourneyRunPresentationState | undefined;
  caseCountFor: (connection: CanvasConnection) => { count: number; exact: boolean } | undefined;
  onSelectNode: (node: JourneyTreeNode) => void;
  onSelectConnection: (connection: CanvasConnection) => void;
  onRenameNode: (node: JourneyTreeNode) => void;
  onCommitNodeRename: (node: JourneyTreeNode, title: string) => void;
  onConnectStart: (event: PointerEvent, node: JourneyTreeNode) => void;
  onConnectKeyboard: (node: JourneyTreeNode) => void;
  onNodePointerDown: (event: PointerEvent, node: JourneyTreeNode) => void;
  onChooseKeyboardConnection: (sourceId: string, targetId: string) => void;
  onCreateKeyboardDestination: (sourceId: string) => void;
  onCancelKeyboardConnection: () => void;
  onNotePointerDown: (event: PointerEvent, note: JourneyCanvasNote) => void;
  onNoteText: (note: JourneyCanvasNote, text: string) => void;
  onCommitNote: () => void;
  onDeleteNote: (note: JourneyCanvasNote) => void;
};

const markerClass = (
  state: JourneyRunPresentationState | undefined,
  connection: CanvasConnection,
) =>
  state === "failed"
    ? "failed"
    : state === "healed"
      ? "healed"
      : state === "passed"
        ? "verified"
        : connection.review?.status === "failed"
          ? "failed"
          : connection.review?.status === "verified"
            ? "verified"
            : connection.kind === "return"
              ? "return"
              : "arrow";

const connectionStrokeClass = (
  state: JourneyRunPresentationState | undefined,
  connection: CanvasConnection,
) =>
  state === "failed"
    ? "stroke-[var(--icon-critical-base)]"
    : state === "running"
      ? "stroke-[var(--text-interactive-base)] [stroke-dasharray:7_4] motion-safe:animate-pulse"
      : state === "healed"
        ? "stroke-[var(--icon-warning-base)]"
        : state === "passed"
          ? "stroke-[var(--icon-success-base)]"
          : connection.state === "needs-recording"
            ? "stroke-[var(--icon-warning-base)] [stroke-dasharray:5_5]"
            : connection.review?.status === "verified"
              ? "stroke-[var(--icon-success-base)]"
              : connection.review?.status === "failed"
                ? "stroke-[var(--icon-critical-base)]"
                : connection.kind === "return"
                  ? "stroke-[var(--text-weak)] [stroke-dasharray:6_6]"
                  : "stroke-[var(--text-interactive-base)]";

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
                ["arrow", "var(--text-interactive-base)"],
                ["return", "var(--text-weak)"],
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
                <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: color }} />
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
                    connectionStrokeClass(runState(), connection),
                  )}
                  stroke-width={
                    connection.state === "needs-recording"
                      ? 2
                      : connection.kind === "return"
                        ? 1.5
                        : 2
                  }
                  stroke-linecap="round"
                  marker-end={`url(#app-map-${markerClass(runState(), connection)})`}
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
                "group absolute z-[6] flex min-h-8 max-w-44 items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--v2-background-bg-base)_94%,transparent)] px-2.5 text-[10px] font-medium text-[var(--text-base)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--v2-border-border-strong)_72%,transparent),0_5px_14px_rgb(0_0_0/12%)] backdrop-blur-[10px] transition-[background-color,box-shadow,color] duration-150 before:absolute before:-inset-1.5 before:rounded-full hover:bg-[var(--v2-background-bg-layer-01)] hover:text-[var(--text-strong)] hover:shadow-[0_0_0_1px_var(--border-focus),0_7px_18px_rgb(0_0_0/16%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]",
                props.selectedConnectionId === connection.id &&
                  "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)] shadow-[0_0_0_1px_var(--border-focus),0_7px_18px_rgb(0_0_0/16%)]",
              )}
              style={{
                left: `${geometry().labelPoint.x}px`,
                top: `${geometry().labelPoint.y}px`,
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
                  <span class="relative grid min-w-5 place-items-center rounded-full bg-[var(--text-interactive-base)] px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-white after:absolute after:-right-0.5 after:-top-0.5 after:-z-10 after:size-full after:rounded-full after:bg-[color-mix(in_srgb,var(--text-interactive-base)_32%,transparent)]">
                    {value().exact ? value().count : `~${value().count}`}
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
            step={props.stepFor(node)}
            isFlowStart={props.isFlowStart(node)}
            outgoingCount={
              props.connections.filter((connection) => connection.fromScreenId === node.id).length
            }
            title={props.titleFor(node)}
            selected={props.selectedNodeId === node.id}
            editing={props.renamingNodeId === node.id}
            runState={props.screenRunState(node.id)}
            position={props.positionFor(node)}
            src={() => props.imageFor(node)}
            onSelect={() => props.onSelectNode(node)}
            onRename={() => props.onRenameNode(node)}
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
          <CanvasNote
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
