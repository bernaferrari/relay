import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { JourneyMetadata, Revisioned } from "@relay/protocol";
import { useServer } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { EmptyState } from "./empty-state";
import { frameCanvasItems, type FrameCanvasItem } from "../lib/frame-canvas-presentation";
import { btnGhost, dividerY, easeOut, mono, stepIndexOn, tColor } from "../lib/ui";
import {
  buildEdges,
  estimateLabelWidth,
  fitViewport,
  graphBounds,
  layoutScreenGraph,
  type EdgeKind,
  type ScreenNode,
} from "../lib/screen-graph";

/**
 * Free-form screenshot Map — Atlas/AgentBoard energy for run evidence.
 * Pan/zoom world, branch lanes (fail/heal), flexible card aspect,
 * smart edges, drag nodes, minimap, selection inspector.
 */

const MIN_SCALE = 0.12;
const MAX_SCALE = 1.8;
/** Screen-space px — click selects; beyond this is a freeform drag. */
const DRAG_THRESHOLD_PX = 5;

export function FrameCanvas(props: {
  onCollapse?: () => void;
  items?: FrameCanvasItem[];
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  showInspector?: boolean;
}) {
  const server = useServer();
  const wb = useWorkbench();
  const [viewport, setViewport] = createSignal({ x: 40, y: 40, scale: 0.55 });
  const [selected, setSelected] = createSignal(0);
  const [selectedEdge, setSelectedEdge] = createSignal<string | null>(null);
  const [edgeConfig, setEdgeConfig] = createSignal<
    Record<string, { label: string; kind: EdgeKind }>
  >({});
  const [journeyRevision, setJourneyRevision] = createSignal<Revisioned<JourneyMetadata>>({
    revision: 0,
    value: { positions: {}, edgeLabels: {}, edgeKinds: {} },
    updatedAt: 0,
  });
  /** User-dragged positions survive re-layout of other nodes. */
  const [overrides, setOverrides] = createSignal<Map<string, { x: number; y: number }>>(new Map());
  /** Natural image aspect (w/h) discovered on load — flexible cards. */
  const [aspects, setAspects] = createSignal<Map<string, number>>(new Map());
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  let rootEl: HTMLDivElement | undefined;
  let pan: { startX: number; startY: number; originX: number; originY: number } | undefined;
  let nodeDrag:
    | {
        id: string;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
        moved: boolean;
      }
    | undefined;

  const rawItems = createMemo(
    () =>
      props.items ??
      frameCanvasItems({
        reviewed: wb.reviewedRun(),
        liveFrames: server.frames(),
        activeJob: wb.activeLiveJob(),
        persistedFrameUrl: (run, frame) => server.frameUrlForPersisted(run, frame),
      }),
  );

  const nodes = createMemo(() => layoutScreenGraph(rawItems(), overrides(), undefined, aspects()));
  const journeyId = createMemo(() => server.selectedRecipeId() ?? rawItems()[0]?.id ?? "empty");
  const edges = createMemo(() =>
    buildEdges(nodes()).map((edge) => {
      const custom = edgeConfig()[`${edge.from}:${edge.to}`];
      return custom ? { ...edge, label: custom.label, kind: custom.kind } : edge;
    }),
  );
  const bounds = createMemo(() => graphBounds(nodes()));

  createEffect(() => {
    const id = journeyId();
    void server
      .loadJourney(id)
      .then((metadata) => {
        if (journeyId() !== id) return;
        setJourneyRevision(metadata);
        setEdgeConfig(
          Object.fromEntries(
            Object.keys(metadata.value.edgeLabels).map((key) => [
              key,
              {
                label: metadata.value.edgeLabels[key] ?? "Continue",
                kind: (metadata.value.edgeKinds[key] as EdgeKind | undefined) ?? "flow",
              },
            ]),
          ),
        );
        setOverrides(new Map(Object.entries(metadata.value.positions)));
      })
      .catch(() => {
        setEdgeConfig({});
        setOverrides(new Map());
      });
    setSelectedEdge(null);
  });

  function persistJourney(nextEdges = edgeConfig(), nextPositions = overrides()) {
    const id = journeyId();
    const current = journeyRevision();
    const value: JourneyMetadata = {
      positions: Object.fromEntries(nextPositions),
      edgeLabels: Object.fromEntries(
        Object.entries(nextEdges).map(([key, config]) => [key, config.label]),
      ),
      edgeKinds: Object.fromEntries(
        Object.entries(nextEdges).map(([key, config]) => [key, config.kind]),
      ),
    };
    setJourneyRevision({
      ...current,
      revision: current.revision + 1,
      value,
      updatedAt: Date.now(),
    });
    void server
      .saveJourney(id, current, value)
      .then(setJourneyRevision)
      .catch(() => setJourneyRevision(current));
  }

  function patchEdge(key: string, patch: Partial<{ label: string; kind: EdgeKind }>) {
    const edge = edges().find((item) => `${item.from}:${item.to}` === key);
    if (!edge) return;
    const next = {
      ...edgeConfig(),
      [key]: {
        label: edgeConfig()[key]?.label ?? edge.label ?? "Continue",
        kind: edgeConfig()[key]?.kind ?? edge.kind,
        ...patch,
      },
    };
    setEdgeConfig(next);
    persistJourney(next);
  }

  function noteAspect(id: string, naturalW: number, naturalH: number) {
    if (!(naturalW > 0 && naturalH > 0)) return;
    const a = naturalW / naturalH;
    setAspects((prev) => {
      const old = prev.get(id);
      // Ignore tiny drift from re-decode
      if (old != null && Math.abs(old - a) < 0.02) return prev;
      const next = new Map(prev);
      next.set(id, a);
      return next;
    });
  }

  const selectedNode = createMemo(() => {
    const i = selected();
    return nodes().find((n) => n.index === i) ?? nodes()[i] ?? null;
  });

  function select(i: number) {
    setSelected(i);
    wb.focusFrame(i);
    props.onSelect?.(i);
  }

  function fit() {
    const rect = rootEl?.getBoundingClientRect();
    if (!rect || nodes().length === 0) return;
    const b = bounds();
    // World content is rebased to (0,0) via -minX/-minY, so fit ignores min offsets.
    const rebased = { ...b, minX: 0, minY: 0 };
    setViewport(fitViewport(rebased, rect.width, rect.height, 56, MIN_SCALE, 1.05));
  }

  function resetLayout() {
    setOverrides(new Map());
    persistJourney(edgeConfig(), new Map());
    requestAnimationFrame(fit);
  }

  createEffect(() => {
    if (props.selectedIndex != null && props.selectedIndex >= 0) {
      setSelected(Math.min(props.selectedIndex, Math.max(0, rawItems().length - 1)));
      return;
    }
    const i = server.frameIndex();
    if (i >= 0 && i < rawItems().length) setSelected(i);
  });

  createEffect(() => {
    void rawItems().length;
    const ids = new Set(rawItems().map((r) => r.id));
    // Drop overrides / aspects for vanished frames
    setOverrides((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const k of next.keys()) {
        if (!ids.has(k)) {
          next.delete(k);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setAspects((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const k of next.keys()) {
        if (!ids.has(k)) {
          next.delete(k);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    requestAnimationFrame(fit);
  });

  // Refit when measured aspects change card heights (first image loads)
  createEffect(() => {
    void aspects().size;
    if (nodes().length) requestAnimationFrame(fit);
  });

  function onWheel(e: WheelEvent) {
    if (!rootEl) return;
    e.preventDefault();
    const rect = rootEl.getBoundingClientRect();
    const cur = viewport();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const worldX = (mx - cur.x) / cur.scale;
    const worldY = (my - cur.y) / cur.scale;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cur.scale * delta));
    setViewport({
      scale: nextScale,
      x: mx - worldX * nextScale,
      y: my - worldY * nextScale,
    });
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (
      t.closest?.("[data-fc-card]") ||
      t.closest?.("[data-fc-mini]") ||
      t.closest?.("[data-fc-ui]")
    )
      return;
    pan = {
      startX: e.clientX,
      startY: e.clientY,
      originX: viewport().x,
      originY: viewport().y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (nodeDrag) {
      const s = viewport().scale;
      const screenDist = Math.hypot(e.clientX - nodeDrag.startX, e.clientY - nodeDrag.startY);
      if (screenDist > DRAG_THRESHOLD_PX) nodeDrag.moved = true;
      // Only mutate position after threshold so micro-jitter doesn't nudge cards on click
      if (!nodeDrag.moved) return;
      const dx = (e.clientX - nodeDrag.startX) / s;
      const dy = (e.clientY - nodeDrag.startY) / s;
      const id = nodeDrag.id;
      const nx = nodeDrag.originX + dx;
      const ny = nodeDrag.originY + dy;
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(id, { x: nx, y: ny });
        return next;
      });
      return;
    }
    if (!pan) return;
    setViewport((v) => ({
      ...v,
      x: pan!.originX + (e.clientX - pan!.startX),
      y: pan!.originY + (e.clientY - pan!.startY),
    }));
  }

  function onPointerUp() {
    if (nodeDrag?.moved) {
      persistJourney(edgeConfig(), overrides());
    }
    pan = undefined;
    nodeDrag = undefined;
    setDraggingId(null);
  }

  function startNodeDrag(e: PointerEvent, node: ScreenNode) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    nodeDrag = {
      id: node.id,
      startX: e.clientX,
      startY: e.clientY,
      originX: node.x,
      originY: node.y,
      moved: false,
    };
    setDraggingId(node.id);
  }

  function tryCollapse() {
    props.onCollapse?.();
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.onCollapse) {
        e.preventDefault();
        props.onCollapse();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        select(Math.min(selected() + 1, rawItems().length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        select(Math.max(selected() - 1, 0));
      } else if (e.key === "f" || e.key === "F") {
        fit();
      } else if (e.key === "0") {
        resetLayout();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const worldStyle = () => {
    const b = bounds();
    const v = viewport();
    return {
      width: `${b.width}px`,
      height: `${b.height}px`,
      transform: `translate(${v.x}px, ${v.y}px) scale(${v.scale})`,
    };
  };

  /** Convert world coords for SVG/cards relative to bounds.min */
  const ox = () => bounds().minX;
  const oy = () => bounds().minY;

  return (
    <section
      class="relative flex min-h-0 flex-1 flex-col bg-background-base text-text-strong"
      aria-label="Screen map"
    >
      {/* Toolbar — denser AgentBoard strip */}
      <div
        data-fc-ui
        class="flex h-9 shrink-0 items-center gap-1.5 border-b border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 text-12-regular text-text-strong"
      >
        <Show when={props.onCollapse}>
          <button
            type="button"
            class={cn(btnGhost, "h-7 gap-1 px-2")}
            onClick={() => tryCollapse()}
            title="Back to phone"
          >
            <Icon name="smartphone" size={13} />
            Phone
          </button>
          <span class={cn(dividerY, "mx-0.5")} aria-hidden="true" />
        </Show>
        <span class="text-12-medium inline-flex items-center gap-1.5 text-text-strong">
          <Icon name="grid" size={13} class="text-text-base" />
          Map
        </span>
        <Show when={nodes().length > 0}>
          <span class={cn(mono, "text-12-regular text-text-weak")}>{nodes().length}</span>
          <span
            class={cn(
              mono,
              "rounded px-1.5 py-px text-12-medium text-text-weak ring-1 ring-inset ring-border-weak-base",
            )}
          >
            {Math.round(viewport().scale * 100)}%
          </span>
        </Show>
        <span class="flex-1" />
        <span class="mr-1 hidden text-12-regular tracking-wide text-text-weak lg:inline">
          drag · scroll · ←→ · F · 0
        </span>
        <button
          type="button"
          class={cn(btnGhost, "h-7 px-2 text-12-regular")}
          onClick={() => fit()}
          disabled={!nodes().length}
          title="Fit all screens (F)"
        >
          Fit
        </button>
        <button
          type="button"
          class={cn(btnGhost, "h-7 px-2 text-12-regular")}
          onClick={() => resetLayout()}
          disabled={!nodes().length}
          title="Reset free-form positions (0)"
        >
          Reset
        </button>
      </div>

      <div class="relative flex min-h-0 flex-1">
        <Show
          when={nodes().length > 0}
          fallback={
            <EmptyState
              size="lg"
              icon="camera"
              title="No screens yet"
              description="Run a test to capture screenshots. They’ll appear here as a free-form journey map."
              class="flex-1 justify-center"
            />
          }
        >
          {/* Canvas */}
          <div
            class="relative min-h-0 min-w-0 flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
            ref={(el) => {
              rootEl = el;
            }}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* Subtler parallax dot grid */}
            <div
              class="pointer-events-none absolute inset-0 opacity-[0.32]"
              style={{
                "background-image":
                  "radial-gradient(color-mix(in srgb, var(--border-weak-base) 70%, transparent) 1px, transparent 1px)",
                "background-size": "22px 22px",
                "background-position": `${viewport().x % 22}px ${viewport().y % 22}px`,
              }}
              aria-hidden="true"
            />

            <div
              class={cn("absolute top-0 left-0 origin-top-left will-change-transform")}
              style={worldStyle()}
            >
              {/* Edges */}
              <svg
                class="absolute z-[1] overflow-visible"
                width={bounds().width}
                height={bounds().height}
                aria-label="Captured journey connections"
              >
                <defs>
                  <marker
                    id="stage-edge-arrow-flow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.2 L 8 5 L 0 8.8 z" class="fill-icon-interactive-base/55" />
                  </marker>
                  <marker
                    id="stage-edge-arrow-fail"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.2 L 8 5 L 0 8.8 z" class="fill-icon-critical-base/70" />
                  </marker>
                  <marker
                    id="stage-edge-arrow-heal"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.2 L 8 5 L 0 8.8 z" class="fill-icon-warning-base/75" />
                  </marker>
                </defs>
                <For each={edges()}>
                  {(e) => {
                    const lw = () => estimateLabelWidth(e.label ?? "");
                    const stroke = () => edgeStrokeClass(e.kind);
                    const marker = () => edgeMarker(e.kind);
                    const labelFill = () => edgeLabelClass(e.kind);
                    return (
                      <g>
                        <path
                          d={shiftPath(e.path, -ox(), -oy())}
                          class="fill-none stroke-transparent"
                          stroke-width="18"
                          pointer-events="stroke"
                          data-fc-ui
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => setSelectedEdge(`${e.from}:${e.to}`)}
                        />
                        <path
                          d={shiftPath(e.path, -ox(), -oy())}
                          stroke-width={e.kind === "flow" ? 1.75 : 2}
                          stroke-linecap="round"
                          stroke-dasharray={e.kind === "fail" ? "5 4" : undefined}
                          marker-end={marker()}
                          class={cn("pointer-events-none fill-none", stroke())}
                        />
                        <Show when={e.label}>
                          <g transform={`translate(${e.midX - ox()}, ${e.midY - oy()})`}>
                            <rect
                              x={-lw() / 2}
                              y={-9}
                              width={lw()}
                              height={18}
                              rx={5}
                              class={cn("stroke-border-weak-base", labelFill())}
                              stroke-width="1"
                            />
                            <text
                              text-anchor="middle"
                              dominant-baseline="middle"
                              y={0.5}
                              class={
                                e.kind === "fail"
                                  ? "fill-icon-critical-base"
                                  : e.kind === "heal"
                                    ? "fill-icon-warning-base"
                                    : "fill-text-weak"
                              }
                              font-size="9.5"
                              font-weight="600"
                              style={{ "font-family": "var(--font-sans, system-ui)" }}
                            >
                              {e.label}
                            </text>
                          </g>
                        </Show>
                      </g>
                    );
                  }}
                </For>
              </svg>

              {/* Nodes */}
              <For each={nodes()}>
                {(node) => (
                  <ScreenCard
                    node={node}
                    selected={selected() === node.index}
                    dragging={draggingId() === node.id}
                    ox={ox()}
                    oy={oy()}
                    onPointerDown={(e) => startNodeDrag(e, node)}
                    onPointerMove={onPointerMove}
                    onPointerUp={(e) => {
                      const wasDrag = nodeDrag?.moved;
                      onPointerUp();
                      if (!wasDrag) {
                        e.stopPropagation();
                        select(node.index);
                      }
                    }}
                    onPointerCancel={onPointerUp}
                    onDblClick={() => {
                      if (props.onCollapse) tryCollapse();
                    }}
                    onAspect={(w, h) => noteAspect(node.id, w, h)}
                  />
                )}
              </For>
            </div>

            <Show when={selectedEdge()}>
              {(key) => {
                const edge = () => edges().find((item) => `${item.from}:${item.to}` === key());
                return (
                  <div
                    data-fc-ui
                    class="absolute top-3 right-3 z-[8] grid w-64 gap-2 rounded-xl border border-border-weak-base bg-surface-raised-stronger-non-alpha p-3 shadow-xl"
                  >
                    <div class="flex items-center justify-between">
                      <div>
                        <span class="text-12-regular text-text-weak">Connection</span>
                        <p class="m-0 text-12-medium text-text-strong">Customize arrow</p>
                      </div>
                      <button
                        type="button"
                        class={cn(btnGhost, "size-7")}
                        onClick={() => setSelectedEdge(null)}
                      >
                        <Icon name="x" size={13} />
                      </button>
                    </div>
                    <label class="grid gap-1 text-12-regular text-text-weak">
                      Label
                      <input
                        class="h-8 rounded-md border border-border-weak-base bg-background-base px-2 text-12-regular text-text-strong"
                        value={edge()?.label ?? "Continue"}
                        onInput={(event) => patchEdge(key(), { label: event.currentTarget.value })}
                      />
                    </label>
                    <label class="grid gap-1 text-12-regular text-text-weak">
                      Path
                      <select
                        class="h-8 rounded-md border border-border-weak-base bg-background-base px-2 text-12-regular text-text-strong"
                        value={edge()?.kind ?? "flow"}
                        onChange={(event) =>
                          patchEdge(key(), { kind: event.currentTarget.value as EdgeKind })
                        }
                      >
                        <option value="flow">Normal</option>
                        <option value="heal">Alternate / recovery</option>
                        <option value="fail">Failure</option>
                      </select>
                    </label>
                  </div>
                );
              }}
            </Show>

            {/* Minimap */}
            <Minimap
              bounds={bounds()}
              nodes={nodes()}
              selected={selected()}
              viewport={viewport()}
              viewW={() => rootEl?.clientWidth ?? 1}
              viewH={() => rootEl?.clientHeight ?? 1}
              onJump={(x, y) => setViewport((v) => ({ ...v, x, y }))}
            />
          </div>

          {/* Selection inspector */}
          <Show when={(props.showInspector ?? true) && selectedNode()}>
            {(n) => (
              <aside
                data-fc-ui
                class="flex w-[min(300px,34%)] shrink-0 flex-col border-l border-border-weak-base bg-surface-raised-stronger-non-alpha text-text-strong"
              >
                <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border-weak-base px-3">
                  <span class={stepIndexOn}>{n().index + 1}</span>
                  <span class="min-w-0 flex-1 truncate text-12-medium tracking-tight text-text-strong">
                    {n().caption}
                  </span>
                  <Show
                    when={n().status === "pass" || n().status === "fail" || n().status === "heal"}
                  >
                    <StatusChip status={n().status} />
                  </Show>
                </div>
                <div class="min-h-0 flex-1 overflow-y-auto p-3">
                  <div
                    class={cn(
                      "overflow-hidden rounded-xl border border-border-weak-base bg-background-base",
                      "shadow-[0_12px_32px_-16px_color-mix(in_srgb,var(--text-strong)_28%,transparent)]",
                    )}
                  >
                    <Show
                      when={n().src}
                      fallback={
                        <div class="grid aspect-[9/19.5] place-items-center text-12-regular text-text-weak">
                          No image
                        </div>
                      }
                    >
                      <img
                        class="block w-full object-contain"
                        src={n().src}
                        alt={n().caption}
                        style={{
                          "aspect-ratio": n().aspect ? `${n().aspect}` : `${n().w} / ${n().h}`,
                        }}
                      />
                    </Show>
                  </div>

                  <div class="mt-3.5 space-y-2.5">
                    <p class="m-0 text-12-medium leading-snug text-text-strong">{n().caption}</p>
                    <dl class="m-0 grid gap-2">
                      <div class="flex items-center justify-between gap-2">
                        <dt class="text-12-regular text-text-weak">Status</dt>
                        <dd class="m-0">
                          <Show
                            when={
                              n().status === "pass" ||
                              n().status === "fail" ||
                              n().status === "heal"
                            }
                            fallback={
                              <span class={cn(mono, "text-12-regular text-text-weak")}>
                                Captured
                              </span>
                            }
                          >
                            <StatusChip status={n().status} />
                          </Show>
                        </dd>
                      </div>
                      <div class="flex items-center justify-between gap-2">
                        <dt class="text-12-regular text-text-weak">Step</dt>
                        <dd class={cn(mono, "m-0 text-12-medium text-text-strong")}>
                          {n().index + 1}
                          <span class="text-text-weak"> / {nodes().length}</span>
                        </dd>
                      </div>
                      <div class="flex items-center justify-between gap-2">
                        <dt class="text-12-regular text-text-weak">Aspect</dt>
                        <dd class={cn(mono, "m-0 text-12-regular text-text-weak")}>
                          {n().aspect
                            ? n().aspect! >= 1
                              ? `${n().aspect!.toFixed(2)} · landscape`
                              : `${(1 / n().aspect!).toFixed(2)} · portrait`
                            : "phone"}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <p class="mt-4 text-12-regular leading-relaxed text-text-weak">
                    Drag screens to rearrange. Fail drops into a lower lane; heal climbs back. Edges
                    follow run order.{" "}
                    <kbd
                      class={cn(
                        mono,
                        "rounded bg-surface-base px-1 py-px text-12-regular text-text-weak ring-1 ring-inset ring-border-weak-base",
                      )}
                    >
                      0
                    </kbd>{" "}
                    resets layout.
                  </p>

                  <Show when={props.onCollapse}>
                    <button
                      type="button"
                      class={cn(btnGhost, "mt-3 h-8 w-full gap-1.5 text-12-regular")}
                      onClick={() => tryCollapse()}
                    >
                      <Icon name="smartphone" size={13} />
                      Open in Phone
                    </button>
                  </Show>
                </div>
              </aside>
            )}
          </Show>
        </Show>
      </div>
    </section>
  );
}

/** One screen card — pure props, no local signals (Solid For-safe). */
function ScreenCard(props: {
  node: ScreenNode;
  selected: boolean;
  dragging: boolean;
  ox: number;
  oy: number;
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerCancel: () => void;
  onDblClick: () => void;
  onAspect: (naturalW: number, naturalH: number) => void;
}) {
  const n = () => props.node;
  const on = () => props.selected;
  const drag = () => props.dragging;

  return (
    <div
      data-fc-card
      class={cn(
        "absolute z-[2] flex cursor-grab flex-col overflow-hidden rounded-2xl border bg-surface-raised-stronger-non-alpha",
        "transition-[box-shadow,border-color,opacity] duration-150",
        easeOut,
        "active:cursor-grabbing",
        // Priority chain (not a stack): dragging beats selected beats default —
        // cn() doesn't merge classes, so overlapping shadow utilities here would
        // silently fight over stylesheet order instead of expressing intent.
        drag()
          ? "z-[4] opacity-95 border-border-interactive-base shadow-[0_28px_56px_-12px_color-mix(in_srgb,var(--text-strong)_40%,transparent)]"
          : on()
            ? "z-[3] border-border-interactive-base shadow-[0_22px_48px_-14px_color-mix(in_srgb,var(--text-strong)_35%,transparent)]"
            : "border-border-weak-base shadow-[0_14px_36px_-16px_color-mix(in_srgb,var(--text-strong)_22%,transparent)] hover:border-border-strong-base",
        !on() && !drag() && n().status === "pass" && "ring-1 ring-icon-success-base/30",
        !on() && !drag() && n().status === "fail" && "ring-1 ring-icon-critical-base/35",
        !on() && !drag() && n().status === "heal" && "ring-1 ring-icon-warning-base/40",
      )}
      style={{
        left: `${n().x - props.ox}px`,
        top: `${n().y - props.oy}px`,
        width: `${n().w}px`,
        height: `${n().h}px`,
      }}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onDblClick={(e) => {
        e.stopPropagation();
        props.onDblClick();
      }}
      title={on() ? "Double-click to open Phone" : undefined}
    >
      {/* Status bar — thin, high contrast */}
      <Show when={n().status === "pass" || n().status === "fail" || n().status === "heal"}>
        <span
          class={cn(
            "absolute top-0 right-0 left-0 z-[1] h-[2.5px]",
            n().status === "pass" && "bg-icon-success-base",
            n().status === "fail" && "bg-icon-critical-base",
            n().status === "heal" && "bg-icon-warning-base",
          )}
        />
      </Show>

      {/* Index badge — high-contrast ink pill */}
      <span class={cn(stepIndexOn, "absolute top-2 right-2 z-[2] shadow-sm")}>{n().index + 1}</span>

      {/* Caption chrome */}
      <div class="flex h-7 shrink-0 items-center gap-1.5 border-b border-border-weak-base bg-surface-raised-stronger-non-alpha px-2 pr-9 text-text-strong">
        <Show when={n().status === "pass"}>
          <span
            class="grid size-3.5 shrink-0 place-items-center text-icon-success-base"
            aria-hidden="true"
          >
            <Icon name="check" size={11} />
          </span>
        </Show>
        <Show when={n().status === "fail"}>
          <span
            class="grid size-3.5 shrink-0 place-items-center text-icon-critical-base"
            aria-hidden="true"
          >
            <Icon name="x" size={11} />
          </span>
        </Show>
        <Show when={n().status === "heal"}>
          <span
            class="grid size-3.5 shrink-0 place-items-center text-icon-warning-base"
            aria-hidden="true"
          >
            <Icon name="sparkle" size={11} />
          </span>
        </Show>
        <Show when={n().status === "idle"}>
          <span class="size-1.5 shrink-0 rounded-full bg-text-weaker/70" aria-hidden="true" />
        </Show>
        <span class="min-w-0 flex-1 truncate text-left text-12-medium text-text-strong">
          {n().caption}
        </span>
      </div>

      {/* Screenshot well — sized by flexible card h */}
      <div class="relative min-h-0 flex-1 bg-background-base text-text-strong">
        <Show
          when={n().src}
          fallback={
            <div class="grid h-full place-items-center text-12-regular text-text-weak">
              No image
            </div>
          }
        >
          <img
            class="pointer-events-none h-full w-full object-contain select-none"
            src={n().src}
            alt={n().caption}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              props.onAspect(img.naturalWidth, img.naturalHeight);
            }}
          />
        </Show>
      </div>
    </div>
  );
}

function StatusChip(props: { status: ScreenNode["status"] }) {
  const label = () =>
    props.status === "idle"
      ? "Captured"
      : props.status === "heal"
        ? "Healed"
        : props.status === "pass"
          ? "Pass"
          : "Fail";
  return (
    <span
      class={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
        "text-12-medium tracking-wide ring-1 ring-inset",
        props.status === "pass" &&
          "bg-icon-success-base/12 text-icon-success-base ring-icon-success-base/30",
        props.status === "fail" &&
          "bg-icon-critical-base/12 text-icon-critical-base ring-icon-critical-base/30",
        props.status === "heal" &&
          "bg-icon-warning-base/12 text-icon-warning-base ring-icon-warning-base/35",
        props.status === "idle" && "bg-surface-base text-text-weak ring-border-weak-base",
      )}
    >
      <Show when={props.status === "pass"}>
        <Icon name="check" size={10} />
      </Show>
      <Show when={props.status === "fail"}>
        <Icon name="x" size={10} />
      </Show>
      <Show when={props.status === "heal"}>
        <Icon name="sparkle" size={10} />
      </Show>
      {label()}
    </span>
  );
}

function edgeStrokeClass(kind: EdgeKind): string {
  if (kind === "fail") return "stroke-icon-critical-base/55";
  if (kind === "heal") return "stroke-icon-warning-base/55";
  return "stroke-icon-interactive-base/35";
}

function edgeMarker(kind: EdgeKind): string {
  if (kind === "fail") return "url(#stage-edge-arrow-fail)";
  if (kind === "heal") return "url(#stage-edge-arrow-heal)";
  return "url(#stage-edge-arrow-flow)";
}

function edgeLabelClass(kind: EdgeKind): string {
  if (kind === "fail") return "fill-icon-critical-base/10";
  if (kind === "heal") return "fill-icon-warning-base/10";
  return "fill-surface-raised-base";
}

function Minimap(props: {
  bounds: ReturnType<typeof graphBounds>;
  nodes: ScreenNode[];
  selected: number;
  viewport: { x: number; y: number; scale: number };
  viewW: () => number;
  viewH: () => number;
  onJump: (x: number, y: number) => void;
}) {
  const MW = 152;
  const MH = 100;
  const scale = () => {
    const b = props.bounds;
    return Math.min(MW / b.width, MH / b.height);
  };
  const viewRect = () => {
    const s = props.viewport.scale;
    const b = props.bounds;
    const sc = scale();
    const vx = -props.viewport.x / s + b.minX;
    const vy = -props.viewport.y / s + b.minY;
    const vw = props.viewW() / s;
    const vh = props.viewH() / s;
    return {
      x: (vx - b.minX) * sc,
      y: (vy - b.minY) * sc,
      w: vw * sc,
      h: vh * sc,
    };
  };

  function onClick(e: MouseEvent) {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const sc = scale();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const localX = mx / sc;
    const localY = my / sc;
    const s = props.viewport.scale;
    props.onJump(props.viewW() / 2 - localX * s, props.viewH() / 2 - localY * s);
  }

  return (
    <button
      type="button"
      data-fc-mini
      class={cn(
        "absolute right-3 bottom-3 z-20 overflow-hidden rounded-lg",
        "border border-border-strong-base bg-surface-raised-stronger-non-alpha shadow-lg",
        tColor,
        "hover:border-border-interactive-base/40",
      )}
      style={{ width: `${MW}px`, height: `${MH}px` }}
      aria-label="Minimap — click to jump"
      title="Click to jump"
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <svg width={MW} height={MH} class="block">
        <rect width={MW} height={MH} class="fill-background-base" />
        <For each={props.nodes}>
          {(n) => {
            const isSel = () => props.selected === n.index;
            return (
              <rect
                x={(n.x - props.bounds.minX) * scale()}
                y={(n.y - props.bounds.minY) * scale()}
                width={Math.max(2, n.w * scale())}
                height={Math.max(2, n.h * scale())}
                rx={1.5}
                class={cn(
                  isSel()
                    ? "fill-icon-interactive-base/55 stroke-icon-interactive-base"
                    : n.status === "pass"
                      ? "fill-icon-success-base/45 stroke-icon-success-base/50"
                      : n.status === "fail"
                        ? "fill-icon-critical-base/45 stroke-icon-critical-base/50"
                        : n.status === "heal"
                          ? "fill-icon-warning-base/45 stroke-icon-warning-base/50"
                          : "fill-surface-weak stroke-border-weak-base",
                )}
                stroke-width={isSel() ? 1.25 : 0.6}
              />
            );
          }}
        </For>
        <rect
          x={viewRect().x}
          y={viewRect().y}
          width={Math.max(8, viewRect().w)}
          height={Math.max(8, viewRect().h)}
          class="fill-icon-interactive-base/12 stroke-icon-interactive-base"
          stroke-width="1.75"
          rx={1}
        />
      </svg>
    </button>
  );
}

/** Shift absolute cubic path from edgePath by (-minX, -minY). */
function shiftPath(d: string, dx: number, dy: number): string {
  const nums = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number);
  if (!nums || nums.length < 8) return d;
  const [x1, y1, c1x, c1y, c2x, c2y, x2, y2] = nums;
  return `M ${x1! + dx} ${y1! + dy} C ${c1x! + dx} ${c1y! + dy}, ${c2x! + dx} ${c2y! + dy}, ${x2! + dx} ${y2! + dy}`;
}
