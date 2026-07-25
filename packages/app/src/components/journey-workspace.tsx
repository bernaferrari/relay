import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import type { JourneyCanvasNote, JourneyMetadata, JourneyTake, Revisioned } from "@relay/protocol";
import { useRecipeDraft } from "../context/recipe-draft";
import { useRecorder, type RecordingTake } from "../context/recorder";
import { useServer, type RecipeInfo, type RecipeStep } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { buildJourneyTree, transitionLabel, type JourneyTreeNode } from "../lib/journey-tree";
import { zoomViewportAtPoint } from "../lib/viewport-zoom";
import { DeviceStage } from "./stage";
import { Icon } from "./icon";
import { accentForStep, evidenceForStep, iconForStep } from "./journey-step-presentation";

type Viewport = { x: number; y: number; scale: number };
type Point = { x: number; y: number };

const CARD_W = 196;
const CARD_H = 248;
const MIN_SCALE = 0.3;
const MAX_SCALE = 1.25;
const EMPTY_METADATA: JourneyMetadata = {
  schemaVersion: 3,
  positions: {},
  edgeLabels: {},
  edgeKinds: {},
  notes: [],
  takes: [],
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The graph is the authoring surface for a journey. A card is a captured
 * screen; the small actions attached to it are the things a person can do
 * there. Recording remains the only way to create the real transitions, so
 * the canvas never promises a route that the runner cannot execute.
 */
export function JourneyWorkspace(props: { onLive: () => void; onOpenTargets: () => void }) {
  const server = useServer();
  const draft = useRecipeDraft();
  const recorder = useRecorder();
  const workbench = useWorkbench();
  const tree = createMemo(() => buildJourneyTree(draft.steps()));
  const hasMap = () => tree().hasScreenIdentity && tree().nodes.length > 0;
  const [view, setView] = createSignal<Viewport>({ x: 72, y: 68, scale: 0.78 });
  const [metadata, setMetadata] = createSignal<Revisioned<JourneyMetadata>>({
    revision: 0,
    value: EMPTY_METADATA,
    updatedAt: 0,
  });
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [historyOpen, setHistoryOpen] = createSignal(false);
  let canvas: HTMLElement | undefined;
  let pan: { x: number; y: number; view: Viewport } | undefined;
  let nodeDrag: { id: string; x: number; y: number; origin: Point; moved: boolean } | undefined;
  let noteDrag: { id: string; x: number; y: number; origin: Point; moved: boolean } | undefined;
  let fittedSignature = "";

  createEffect(() => {
    const recipeId = server.selectedRecipeId();
    if (!recipeId) {
      setMetadata({ revision: 0, value: EMPTY_METADATA, updatedAt: 0 });
      return;
    }
    void server
      .loadJourney(recipeId)
      .then((next) => {
        if (server.selectedRecipeId() === recipeId) setMetadata(next);
      })
      .catch(() => {
        if (server.selectedRecipeId() === recipeId) {
          setMetadata({ revision: 0, value: EMPTY_METADATA, updatedAt: 0 });
        }
      });
  });

  const positions = () => metadata().value.positions;
  const hasCanvasContent = () => hasMap() || (metadata().value.notes?.length ?? 0) > 0;
  const positionFor = (node: JourneyTreeNode): Point => positions()[node.id] ?? node;
  const selectedNode = createMemo(
    () => tree().nodes.find((node) => node.id === selectedNodeId()) ?? tree().nodes[0] ?? null,
  );
  const selectedActions = createMemo(() => {
    const node = selectedNode();
    return node ? node.stepIndexes.map((index) => ({ index, step: draft.steps()[index]! })) : [];
  });
  const bounds = createMemo(() => {
    const nodes = tree().nodes;
    const notes = metadata().value.notes ?? [];
    if (!nodes.length && !notes.length) return { width: 760, height: 560 };
    const right = Math.max(
      ...nodes.map((node) => positionFor(node).x + CARD_W),
      ...notes.map((note) => note.x + 220),
      648,
    );
    const bottom = Math.max(
      ...nodes.map((node) => positionFor(node).y + CARD_H),
      ...notes.map((note) => note.y + 132),
      448,
    );
    return {
      width: Math.max(760, right + 112),
      height: Math.max(560, bottom + 112),
    };
  });

  const fit = () => {
    const element = canvas;
    if (!element || !hasCanvasContent()) return;
    const content = bounds();
    const padding = 56;
    const scale = clamp(
      Math.min(
        1,
        (element.clientWidth - padding * 2) / content.width,
        (element.clientHeight - padding * 2) / content.height,
      ),
      MIN_SCALE,
      MAX_SCALE,
    );
    setView({
      scale,
      x: Math.max(padding, (element.clientWidth - content.width * scale) / 2),
      y: Math.max(padding, (element.clientHeight - content.height * scale) / 2),
    });
  };

  onMount(() => requestAnimationFrame(fit));
  createEffect(() => {
    const signature = [
      ...tree().nodes.map((node) => node.id),
      ...(metadata().value.notes ?? []).map((note) => note.id),
    ].join("|");
    if (!signature || signature === fittedSignature) return;
    fittedSignature = signature;
    setSelectedNodeId((current) =>
      current && tree().nodes.some((node) => node.id === current)
        ? current
        : (tree().nodes[0]?.id ?? null),
    );
    requestAnimationFrame(fit);
  });

  const selectStep = (index: number) => {
    workbench.focusStep(index);
    draft.setExpandedStep(index);
  };
  const selectNode = (node: JourneyTreeNode) => {
    setSelectedNodeId(node.id);
    selectStep(node.representativeStepIndex);
  };
  const zoom = (delta: number, clientPoint?: Point) => {
    const element = canvas;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const anchor = clientPoint
      ? { x: clientPoint.x - rect.left, y: clientPoint.y - rect.top }
      : { x: rect.width / 2, y: rect.height / 2 };
    setView((current) =>
      zoomViewportAtPoint(current, clamp(current.scale + delta, MIN_SCALE, MAX_SCALE), anchor),
    );
  };
  const persistPositions = (next: Record<string, Point>) => {
    const recipeId = server.selectedRecipeId();
    if (!recipeId) return;
    const current = metadata();
    const value: JourneyMetadata = { ...current.value, schemaVersion: 3, positions: next };
    setMetadata({ ...current, revision: current.revision + 1, value, updatedAt: Date.now() });
    void server
      .saveJourney(recipeId, current, value)
      .then(setMetadata)
      .catch(() => setMetadata(current));
  };
  const persistTake = (take: RecordingTake, state: JourneyTake["state"]) => {
    const recipeId = take.recipeId;
    if (!recipeId || recipeId !== server.selectedRecipeId()) return;
    const current = metadata();
    const nextTake: JourneyTake = {
      id: take.id,
      recipeId,
      startedAt: take.startedAt,
      ...(take.finishedAt ? { finishedAt: take.finishedAt } : {}),
      group: take.group,
      state,
      steps: structuredClone(take.steps),
    };
    const previous = current.value.takes ?? [];
    const same = previous.find((entry) => entry.id === nextTake.id);
    if (same && JSON.stringify(same) === JSON.stringify(nextTake)) return;
    const value: JourneyMetadata = {
      ...current.value,
      schemaVersion: 3,
      takes: [...previous.filter((entry) => entry.id !== nextTake.id), nextTake].slice(-50),
    };
    setMetadata({ ...current, revision: current.revision + 1, value, updatedAt: Date.now() });
    void server
      .saveJourney(recipeId, current, value)
      .then(setMetadata)
      .catch(() => setMetadata(current));
  };
  const persistNotes = (notes: JourneyCanvasNote[]) => {
    const recipeId = server.selectedRecipeId();
    if (!recipeId) return;
    const current = metadata();
    const value: JourneyMetadata = { ...current.value, schemaVersion: 3, notes };
    setMetadata({ ...current, revision: current.revision + 1, value, updatedAt: Date.now() });
    void server
      .saveJourney(recipeId, current, value)
      .then(setMetadata)
      .catch(() => setMetadata(current));
  };
  const addNote = () => {
    const element = canvas;
    const current = view();
    const x = element ? (element.clientWidth * 0.52 - current.x) / current.scale : 320;
    const y = element ? (element.clientHeight * 0.42 - current.y) / current.scale : 180;
    const at = Date.now();
    const id = `note-${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? at.toString(36)}`;
    persistNotes([
      ...(metadata().value.notes ?? []),
      { id, text: "Add context for this part of the journey", x, y, createdAt: at, updatedAt: at },
    ]);
  };
  createEffect(() => {
    const recipeId = server.selectedRecipeId();
    const current = recorder.take();
    if (!recipeId || !current || current.recipeId !== recipeId || current.state !== "review")
      return;
    persistTake(current, "review");
  });
  createEffect(() => {
    const recipeId = server.selectedRecipeId();
    if (!recipeId || recorder.take()) return;
    const review = [...(metadata().value.takes ?? [])]
      .reverse()
      .find((take) => take.recipeId === recipeId && take.state === "review");
    if (review?.state === "review") recorder.restoreTake({ ...review, state: "review" });
  });
  const keepTake = () => {
    const take = recorder.take();
    if (!take) return;
    if (recorder.keepTake()) persistTake(take, "kept");
  };
  const discardTake = () => {
    const take = recorder.take();
    if (take) persistTake(take, "discarded");
    recorder.discardTake();
  };
  const recordFromHere = () => {
    const screen = selectedNode();
    // A recording group is a lightweight, executable breadcrumb: it makes the
    // outline say which screen the captured actions belong to without adding a
    // second, non-runnable graph model.
    if (screen) recorder.setRecordingGroup(screen.title);
    recorder.enterRecordMode();
    // Keep the graph visible: the device is already alongside it, and a new
    // action will appear on the selected screen as soon as it is captured.
  };

  return (
    <section class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(300px,38%)] bg-[var(--v2-background-bg-deep)]">
      <section
        ref={(element) => {
          canvas = element;
        }}
        class="relative isolate flex min-h-0 min-w-0 select-none overflow-hidden border-r border-[var(--v2-border-border-muted)]"
        aria-label="Journey graph"
        onWheel={(event) => {
          if (!hasCanvasContent() || (!event.ctrlKey && !event.metaKey && !event.altKey)) return;
          event.preventDefault();
          zoom(event.deltaY > 0 ? -0.08 : 0.08, { x: event.clientX, y: event.clientY });
        }}
        onPointerDown={(event) => {
          if (
            !hasCanvasContent() ||
            event.button !== 0 ||
            (event.target as HTMLElement).closest("button")
          )
            return;
          pan = { x: event.clientX, y: event.clientY, view: view() };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (nodeDrag) {
            const moved = Math.hypot(event.clientX - nodeDrag.x, event.clientY - nodeDrag.y) > 4;
            if (!moved && !nodeDrag.moved) return;
            nodeDrag.moved = true;
            const next = {
              ...positions(),
              [nodeDrag.id]: {
                x: nodeDrag.origin.x + (event.clientX - nodeDrag.x) / view().scale,
                y: nodeDrag.origin.y + (event.clientY - nodeDrag.y) / view().scale,
              },
            };
            setMetadata((current) => ({
              ...current,
              value: { ...current.value, positions: next },
            }));
            return;
          }
          if (noteDrag) {
            const moved = Math.hypot(event.clientX - noteDrag.x, event.clientY - noteDrag.y) > 4;
            if (!moved && !noteDrag.moved) return;
            noteDrag.moved = true;
            const next = (metadata().value.notes ?? []).map((note) =>
              note.id === noteDrag!.id
                ? {
                    ...note,
                    x: noteDrag!.origin.x + (event.clientX - noteDrag!.x) / view().scale,
                    y: noteDrag!.origin.y + (event.clientY - noteDrag!.y) / view().scale,
                    updatedAt: Date.now(),
                  }
                : note,
            );
            setMetadata((current) => ({ ...current, value: { ...current.value, notes: next } }));
            return;
          }
          if (!pan) return;
          setView({
            ...pan.view,
            x: pan.view.x + event.clientX - pan.x,
            y: pan.view.y + event.clientY - pan.y,
          });
        }}
        onPointerUp={() => {
          if (nodeDrag?.moved) persistPositions(positions());
          if (noteDrag?.moved) persistNotes(metadata().value.notes ?? []);
          nodeDrag = undefined;
          noteDrag = undefined;
          pan = undefined;
        }}
        onPointerCancel={() => {
          nodeDrag = undefined;
          noteDrag = undefined;
          pan = undefined;
        }}
      >
        <div
          class="pointer-events-none absolute inset-0 opacity-35"
          style={{
            "background-image":
              "radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--text-strong) 9%,transparent) 1px,transparent 0)",
            "background-size": "22px 22px",
          }}
        />
        <header class="absolute top-0 right-0 left-0 z-20 flex h-12 items-center justify-between border-b border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-deep)_88%,transparent)] px-4 backdrop-blur-[12px]">
          <div class="min-w-0">
            <strong class="block text-[12px] font-semibold text-[var(--text-strong)]">
              Screen tree
            </strong>
            <span class="text-[10.5px] text-[var(--text-weak)]">
              {tree().nodes.length || "No"} captured{" "}
              {tree().nodes.length === 1 ? "screen" : "screens"}
            </span>
          </div>
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class={mapControlButton}
              aria-label="Undo"
              title="Undo"
              disabled={!draft.canUndo()}
              onClick={draft.undo}
            >
              <Icon name="undo" size={13} />
            </button>
            <button
              type="button"
              class={mapControlButton}
              aria-label="Redo"
              title="Redo"
              disabled={!draft.canRedo()}
              onClick={draft.redo}
            >
              <Icon name="redo" size={13} />
            </button>
            <button
              type="button"
              class={mapControlButton}
              aria-expanded={historyOpen()}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <Icon name="clock" size={13} /> History
            </button>
            <button type="button" class={mapControlButton} onClick={addNote}>
              <Icon name="plus" size={13} /> Note
            </button>
            <button type="button" class={recordButton} onClick={recordFromHere}>
              <i class="size-1.5 rounded-full bg-[var(--icon-critical-base)]" /> Record from device
            </button>
          </div>
        </header>
        <Show when={historyOpen()}>
          <HistoryPanel
            loading={draft.historyLoading()}
            entries={draft.savedHistory()}
            onClose={() => setHistoryOpen(false)}
            onRestore={(updatedAt) => {
              void draft.restoreSavedHistory(updatedAt);
              setHistoryOpen(false);
            }}
          />
        </Show>
        <Show
          when={hasCanvasContent()}
          fallback={<GraphEmptyState onRecord={recordFromHere} onOpenDevice={props.onLive} />}
        >
          <div
            class="absolute top-0 left-0 origin-top-left will-change-transform"
            style={{
              width: `${bounds().width}px`,
              height: `${bounds().height}px`,
              transform: `translate3d(${view().x}px, ${view().y}px, 0) scale(${view().scale})`,
            }}
          >
            <svg
              class="pointer-events-none absolute inset-0 overflow-visible"
              width={bounds().width}
              height={bounds().height}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="journey-graph-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" class="fill-[var(--text-interactive-base)]" />
                </marker>
                <marker
                  id="journey-graph-return"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" class="fill-[var(--text-weak)]" />
                </marker>
              </defs>
              <For each={tree().edges}>
                {(edge) => {
                  const geometry = () => edgeGeometry(edge, tree().nodes, positionFor);
                  return (
                    <path
                      d={geometry().path}
                      class={cn(
                        "fill-none",
                        edge.kind === "return"
                          ? "stroke-[var(--text-weak)] [stroke-dasharray:6_6]"
                          : "stroke-[var(--text-interactive-base)]",
                      )}
                      stroke-width={edge.kind === "return" ? 1.5 : 2}
                      stroke-linecap="round"
                      marker-end={`url(#journey-graph-${edge.kind === "return" ? "return" : "arrow"})`}
                    />
                  );
                }}
              </For>
            </svg>
            <For each={tree().nodes}>
              {(node) => (
                <ScreenCard
                  node={node}
                  step={draft.steps()[node.representativeStepIndex]!}
                  selected={selectedNode()?.id === node.id}
                  position={positionFor(node)}
                  src={() => screenshotUrl(server, draft.steps()[node.representativeStepIndex])}
                  onSelect={() => selectNode(node)}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    nodeDrag = {
                      id: node.id,
                      x: event.clientX,
                      y: event.clientY,
                      origin: positionFor(node),
                      moved: false,
                    };
                  }}
                />
              )}
            </For>
            <For each={metadata().value.notes ?? []}>
              {(note) => (
                <CanvasNote
                  note={note}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    noteDrag = {
                      id: note.id,
                      x: event.clientX,
                      y: event.clientY,
                      origin: { x: note.x, y: note.y },
                      moved: false,
                    };
                  }}
                  onText={(text) =>
                    setMetadata((current) => ({
                      ...current,
                      value: {
                        ...current.value,
                        notes: (current.value.notes ?? []).map((entry) =>
                          entry.id === note.id ? { ...entry, text, updatedAt: Date.now() } : entry,
                        ),
                      },
                    }))
                  }
                  onCommit={() => persistNotes(metadata().value.notes ?? [])}
                  onDelete={() =>
                    persistNotes(
                      (metadata().value.notes ?? []).filter((entry) => entry.id !== note.id),
                    )
                  }
                />
              )}
            </For>
          </div>
          <ScreenActions
            node={selectedNode()}
            actions={selectedActions()}
            onSelect={selectStep}
            onRecord={recordFromHere}
          />
          <div class="absolute right-4 bottom-4 z-20 flex items-center gap-1 rounded-[10px] border border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_92%,transparent)] p-1 shadow-[var(--v2-elevation-floating)] backdrop-blur-[12px]">
            <button
              type="button"
              class={mapControlButton}
              aria-label="Zoom out"
              onClick={() => zoom(-0.1)}
            >
              −
            </button>
            <span class="min-w-9 text-center font-mono text-[10px] tabular-nums text-[var(--text-weak)]">
              {Math.round(view().scale * 100)}%
            </span>
            <button
              type="button"
              class={mapControlButton}
              aria-label="Zoom in"
              onClick={() => zoom(0.1)}
            >
              +
            </button>
            <button type="button" class={mapControlButton} onClick={fit}>
              Fit
            </button>
          </div>
        </Show>
      </section>
      <aside
        class="relative flex min-h-0 min-w-0 flex-col bg-[var(--v2-background-bg-base)]"
        aria-label="Device capture"
      >
        <div class="flex h-12 shrink-0 items-center justify-between border-b border-[var(--v2-border-border-muted)] px-4">
          <div>
            <strong class="block text-[12px] font-semibold text-[var(--text-strong)]">
              Device
            </strong>
            <span class="text-[10.5px] text-[var(--text-weak)]">
              Record a screen, then its connections
            </span>
          </div>
          <button
            type="button"
            class={mapControlButton}
            aria-label="Open full device editor"
            onClick={props.onLive}
          >
            <Icon name="arrow-right" size={13} />
          </button>
        </div>
        <Show when={recorder.take()}>
          {(take) => (
            <TakeReviewBar
              take={take()}
              onStop={() => void recorder.stopRecording()}
              onKeep={keepTake}
              onDiscard={discardTake}
              onRemove={(index) => recorder.removeTakeStep(index)}
            />
          )}
        </Show>
        <div class="min-h-0 flex-1">
          <DeviceStage onOpenTargets={props.onOpenTargets} />
        </div>
      </aside>
    </section>
  );
}

const recordButton =
  "inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-[var(--product-accent-soft)] px-2.5 text-[10.5px] font-semibold text-[var(--text-interactive-base)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] active:scale-[0.97]";
const mapControlButton =
  "grid h-7 min-w-7 place-items-center rounded-[7px] px-1.5 text-[10px] text-[var(--text-base)] transition-colors duration-100 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-border-strong-focus";

function TakeReviewBar(props: {
  take: RecordingTake;
  onStop: () => void;
  onKeep: () => void;
  onDiscard: () => void;
  onRemove: (index: number) => void;
}) {
  const count = () => props.take.steps.length;
  const isRecording = () => props.take.state === "recording";
  return (
    <section class="border-b border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-4 py-2.5">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-strong)]">
            <i
              class={cn(
                "size-1.5 rounded-full",
                isRecording()
                  ? "bg-[var(--icon-critical-base)]"
                  : "bg-[var(--text-interactive-base)]",
              )}
            />
            {isRecording() ? "Recording freely" : "Review this take"}
          </div>
          <p class="m-0 mt-0.5 text-[10px] text-[var(--text-weak)]">
            {isRecording()
              ? `${count()} captured action${count() === 1 ? "" : "s"}. Nothing is permanent yet.`
              : `${count()} action${count() === 1 ? "" : "s"} ready to add to this journey.`}
          </p>
        </div>
        <Show
          when={isRecording()}
          fallback={
            <div class="flex shrink-0 items-center gap-1.5">
              <button type="button" class={mapControlButton} onClick={props.onDiscard}>
                Discard
              </button>
              <button type="button" class={recordButton} onClick={props.onKeep}>
                <Icon name="check" size={12} /> Keep take
              </button>
            </div>
          }
        >
          <button type="button" class={mapControlButton} onClick={props.onStop}>
            <Icon name="square" size={11} /> Stop & review
          </button>
        </Show>
      </div>
      <Show when={!isRecording() && count() > 0}>
        <div class="mt-2 grid gap-0.5 border-t border-[var(--v2-border-border-muted)] pt-1.5">
          <For each={props.take.steps.slice(-4)}>
            {(step, displayIndex) => {
              const index = () => Math.max(0, props.take.steps.length - 4) + displayIndex();
              return (
                <div class="flex min-w-0 items-center gap-2 rounded-[6px] px-1.5 py-1 text-[10px] text-[var(--text-base)]">
                  <span class="font-mono text-[9px] text-[var(--text-weak)]">
                    {String(index() + 1).padStart(2, "0")}
                  </span>
                  <span class="min-w-0 flex-1 truncate">{transitionLabel(step)}</span>
                  <button
                    type="button"
                    class="grid size-5 place-items-center rounded-[5px] text-[var(--text-weak)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--icon-critical-base)]"
                    aria-label={`Remove ${transitionLabel(step)}`}
                    onClick={() => props.onRemove(index())}
                  >
                    <Icon name="x" size={10} />
                  </button>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </section>
  );
}

function HistoryPanel(props: {
  loading: boolean;
  entries: RecipeInfo[];
  onClose: () => void;
  onRestore: (updatedAt: number) => void;
}) {
  return (
    <aside class="absolute top-14 right-4 z-30 w-[min(320px,calc(100%-32px))] overflow-hidden rounded-[12px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)] shadow-[0_16px_40px_rgb(0_0_0/28%)]">
      <header class="flex items-center justify-between border-b border-[var(--v2-border-border-muted)] px-3 py-2.5">
        <div>
          <strong class="block text-[11.5px] text-[var(--text-strong)]">Journey history</strong>
          <span class="text-[9.5px] text-[var(--text-weak)]">
            Restore any prior save. Your current state stays recoverable.
          </span>
        </div>
        <button
          type="button"
          class={mapControlButton}
          aria-label="Close history"
          onClick={props.onClose}
        >
          <Icon name="x" size={13} />
        </button>
      </header>
      <div class="max-h-60 overflow-auto p-1.5">
        <Show
          when={!props.loading}
          fallback={
            <p class="m-0 px-2 py-3 text-[10.5px] text-[var(--text-weak)]">
              Loading saved versions…
            </p>
          }
        >
          <Show
            when={props.entries.length}
            fallback={
              <p class="m-0 px-2 py-3 text-[10.5px] text-[var(--text-weak)]">
                Your first meaningful edit will appear here.
              </p>
            }
          >
            <For each={props.entries}>
              {(entry) => (
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-3 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-[var(--v2-background-bg-layer-02)]"
                  onClick={() => props.onRestore(entry.updatedAt)}
                >
                  <span class="min-w-0">
                    <strong class="block truncate text-[10.5px] font-medium text-[var(--text-strong)]">
                      {entry.title}
                    </strong>
                    <span class="text-[9.5px] text-[var(--text-weak)]">
                      {entry.steps.length} {entry.steps.length === 1 ? "action" : "actions"}
                    </span>
                  </span>
                  <span class="shrink-0 text-[9.5px] text-[var(--text-weak)]">
                    {new Date(entry.updatedAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </aside>
  );
}

function GraphEmptyState(props: { onRecord: () => void; onOpenDevice: () => void }) {
  return (
    <div class="relative z-[1] flex flex-1 flex-col items-center justify-center px-5 pt-12 text-center">
      <span class="mb-3 grid size-9 place-items-center rounded-[11px] bg-[var(--v2-background-bg-layer-01)] text-[var(--text-base)]">
        <Icon name="move" size={16} />
      </span>
      <h2 class="m-0 text-[18px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
        Start with a screen
      </h2>
      <p class="m-0 mt-1.5 max-w-[34ch] text-[12px]/[1.5] text-[var(--text-weak)]">
        Record on the device. Relay will place each captured screen and its outgoing actions here.
      </p>
      <div class="mt-4 flex items-center gap-2">
        <button type="button" class={recordButton} onClick={props.onRecord}>
          <i class="size-1.5 rounded-full bg-[var(--icon-critical-base)]" /> Start recording
        </button>
        <button type="button" class={mapControlButton} onClick={props.onOpenDevice}>
          Device
        </button>
      </div>
    </div>
  );
}

function CanvasNote(props: {
  note: JourneyCanvasNote;
  onPointerDown: (event: PointerEvent & { currentTarget: HTMLButtonElement }) => void;
  onText: (text: string) => void;
  onCommit: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      class="absolute w-[220px] overflow-hidden rounded-[12px] border border-[color-mix(in_srgb,var(--v2-border-border-strong)_74%,transparent)] bg-[color-mix(in_srgb,var(--v2-background-bg-layer-01)_96%,var(--product-accent-soft))] shadow-[0_8px_26px_rgb(0_0_0/18%)]"
      style={{ transform: `translate3d(${props.note.x}px, ${props.note.y}px, 0)` }}
    >
      <header class="flex h-8 items-center justify-between border-b border-[color-mix(in_srgb,var(--v2-border-border-muted)_82%,transparent)] px-1">
        <button
          type="button"
          class="flex h-full min-w-0 flex-1 cursor-grab items-center gap-1.5 px-1.5 text-left active:cursor-grabbing"
          onPointerDown={props.onPointerDown}
        >
          <Icon name="edit" size={11} class="text-[var(--text-interactive-base)]" />
          <span class="text-[10px] font-semibold text-[var(--text-strong)]">Note</span>
          <span class="text-[9px] text-[var(--text-weak)]">drag</span>
        </button>
        <button
          type="button"
          class="grid size-6 place-items-center rounded-[6px] text-[var(--text-weak)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--icon-critical-base)]"
          aria-label="Delete note"
          onClick={props.onDelete}
        >
          <Icon name="x" size={11} />
        </button>
      </header>
      <textarea
        class="block min-h-[96px] w-full resize-none bg-transparent px-2.5 py-2 text-[11px]/[1.5] text-[var(--text-base)] outline-none placeholder:text-[var(--text-weak)]"
        value={props.note.text}
        aria-label="Canvas note"
        onPointerDown={(event) => event.stopPropagation()}
        onInput={(event) => props.onText(event.currentTarget.value.slice(0, 480))}
        onBlur={props.onCommit}
      />
    </article>
  );
}

function ScreenCard(props: {
  node: JourneyTreeNode;
  step: RecipeStep;
  selected: boolean;
  position: Point;
  src: () => string;
  onSelect: () => void;
  onPointerDown: (event: PointerEvent & { currentTarget: HTMLButtonElement }) => void;
}) {
  return (
    <button
      type="button"
      class={cn(
        "absolute grid h-[248px] w-[196px] grid-rows-[34px_minmax(0,1fr)_30px] overflow-hidden rounded-[14px] border bg-[var(--v2-background-bg-base)] text-left shadow-[0_8px_28px_rgb(0_0_0/20%)] transition-[border-color,box-shadow] duration-150",
        props.selected
          ? "border-[var(--text-interactive-base)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--v2-background-bg-accent)_20%,transparent),0_8px_28px_rgb(0_0_0/24%)]"
          : "border-[var(--v2-border-border-muted)] hover:border-[var(--v2-border-border-strong)]",
      )}
      style={{ transform: `translate3d(${props.position.x}px, ${props.position.y}px, 0)` }}
      onClick={props.onSelect}
      onPointerDown={props.onPointerDown}
    >
      <header class="flex min-w-0 items-center gap-2 border-b border-[var(--v2-border-border-muted)] px-2.5">
        <span
          class="grid size-[17px] shrink-0 place-items-center rounded-[5px] text-white"
          style={{ background: accentForStep(props.step) }}
        >
          <Icon name={iconForStep(props.step)} size={9} />
        </span>
        <strong class="min-w-0 truncate text-[11px] font-semibold text-[var(--text-strong)]">
          {props.node.title}
        </strong>
      </header>
      <Show
        when={props.src()}
        fallback={
          <div class="grid place-items-center bg-[radial-gradient(circle_at_50%_35%,color-mix(in_srgb,var(--v2-background-bg-accent)_14%,transparent),transparent_44%),var(--v2-background-bg-deep)]">
            <Icon name={iconForStep(props.step)} size={20} class="text-[var(--text-base)]" />
          </div>
        }
      >
        {(src) => (
          <div class="min-h-0 overflow-hidden bg-[#080a0f] p-1.5">
            <img
              src={src()}
              alt={`Recorded ${props.node.title} screen`}
              draggable={false}
              class="size-full rounded-[9px] object-contain object-top"
            />
          </div>
        )}
      </Show>
      <footer class="flex items-center justify-between px-2.5 text-[9.5px] text-[var(--text-weak)]">
        <span>
          {props.node.stepIndexes.length}{" "}
          {props.node.stepIndexes.length === 1 ? "action" : "actions"}
        </span>
        <span>Drag to arrange</span>
      </footer>
    </button>
  );
}

function ScreenActions(props: {
  node: JourneyTreeNode | null;
  actions: { index: number; step: RecipeStep }[];
  onSelect: (index: number) => void;
  onRecord: () => void;
}) {
  return (
    <Show when={props.node}>
      {(node) => (
        <aside class="absolute top-[62px] left-4 z-20 w-[min(280px,calc(100%-32px))] rounded-[12px] border border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_94%,transparent)] p-2 shadow-[0_8px_30px_rgb(0_0_0/18%)] backdrop-blur-[12px]">
          <div class="flex items-start justify-between gap-3 px-1.5 pt-0.5">
            <div>
              <strong class="block text-[11.5px] font-semibold text-[var(--text-strong)]">
                {node().title}
              </strong>
              <span class="text-[10px] text-[var(--text-weak)]">Actions from this screen</span>
            </div>
            <button
              type="button"
              class={mapControlButton}
              aria-label="Record another connection"
              onClick={props.onRecord}
            >
              <Icon name="plus" size={13} />
            </button>
          </div>
          <div class="mt-1.5 grid gap-0.5">
            <For each={props.actions}>
              {({ index, step }) => (
                <button
                  type="button"
                  class="flex min-h-8 items-center gap-2 rounded-[7px] px-1.5 text-left text-[10.5px] text-[var(--text-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                  onClick={() => props.onSelect(index)}
                >
                  <span
                    class="grid size-5 shrink-0 place-items-center rounded-[5px] text-white"
                    style={{ background: accentForStep(step) }}
                  >
                    <Icon name={iconForStep(step)} size={10} />
                  </span>
                  <span class="min-w-0 flex-1 truncate">{transitionLabel(step)}</span>
                  <Icon name="arrow-right" size={11} class="text-[var(--text-weak)]" />
                </button>
              )}
            </For>
          </div>
          <p class="m-0 border-t border-[var(--v2-border-border-muted)] px-1.5 pt-1.5 text-[9.5px]/[1.4] text-[var(--text-weak)]">
            To return, record Back, Home, or a relaunch as the next connection.
          </p>
        </aside>
      )}
    </Show>
  );
}

function screenshotUrl(server: ReturnType<typeof useServer>, step: RecipeStep | undefined): string {
  const screenshot = evidenceForStep(step)?.screenshot;
  return screenshot ? server.recordingEvidenceUrl(screenshot.recipeId, screenshot.id) : "";
}

function edgeGeometry(
  edge: { from: string; to: string; kind: "forward" | "return" },
  nodes: JourneyTreeNode[],
  positionFor: (node: JourneyTreeNode) => Point,
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const from = byId.get(edge.from)!;
  const to = byId.get(edge.to)!;
  const fromPosition = positionFor(from);
  const toPosition = positionFor(to);
  if (edge.kind === "return") {
    const startX = fromPosition.x + CARD_W / 2;
    const startY = fromPosition.y;
    const endX = toPosition.x + CARD_W / 2;
    const endY = toPosition.y;
    const railY = Math.min(startY, endY) - 34;
    return {
      path: `M ${startX} ${startY} C ${startX} ${railY}, ${endX} ${railY}, ${endX} ${endY}`,
    };
  }
  const startX = fromPosition.x + CARD_W;
  const startY = fromPosition.y + CARD_H / 2;
  const endX = toPosition.x;
  const endY = toPosition.y + CARD_H / 2;
  return {
    path: `M ${startX} ${startY} C ${startX + 48} ${startY}, ${endX - 48} ${endY}, ${endX} ${endY}`,
  };
}
