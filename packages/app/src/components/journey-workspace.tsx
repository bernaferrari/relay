import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { useRecipeDraft } from "../context/recipe-draft";
import { useServer, type RecipeStep } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { buildJourneyTree, type JourneyTreeEdge, type JourneyTreeNode } from "../lib/journey-tree";
import { zoomViewportAtPoint } from "../lib/viewport-zoom";
import { Icon } from "./icon";
import { AgentTestComposer } from "./agent-test-composer";
import { accentForStep, evidenceForStep, iconForStep } from "./journey-step-presentation";

type Viewport = { x: number; y: number; scale: number };

const CARD_W = 208;
const CARD_H = 292;
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.15;

/**
 * The screen tree is not a second way to edit a linear list of actions. A screen is reused when its captured evidence matches, so a recorded
 * Back action visibly returns to Settings rather than manufacturing a second
 * Settings card.
 */
export function JourneyWorkspace(props: { onLive: () => void }) {
  const server = useServer();
  const draft = useRecipeDraft();
  const workbench = useWorkbench();
  const tree = createMemo(() => buildJourneyTree(draft.steps()));
  const [view, setView] = createSignal<Viewport>({ x: 56, y: 72, scale: 0.78 });
  let canvas: HTMLElement | undefined;
  let pan: { x: number; y: number; view: Viewport } | undefined;

  const bounds = createMemo(() => {
    const nodes = tree().nodes;
    if (!nodes.length) return { width: 720, height: 520 };
    return {
      width: Math.max(720, Math.max(...nodes.map((node) => node.x + CARD_W)) + 96),
      height: Math.max(520, Math.max(...nodes.map((node) => node.y + CARD_H)) + 96),
    };
  });

  const returns = createMemo(() => tree().edges.filter((edge) => edge.kind === "return").length);

  const fit = () => {
    const element = canvas;
    if (!element) return;
    const width = bounds().width;
    const height = bounds().height;
    const pad = 52;
    const scale = Math.max(
      MIN_SCALE,
      Math.min(
        1,
        (element.clientWidth - pad * 2) / width,
        (element.clientHeight - pad * 2) / height,
      ),
    );
    setView({
      scale,
      x: Math.max(pad, (element.clientWidth - width * scale) / 2),
      y: Math.max(pad, (element.clientHeight - height * scale) / 2),
    });
  };

  onMount(() => requestAnimationFrame(fit));

  const selectStep = (index: number) => {
    workbench.focusStep(index);
    draft.setExpandedStep(index);
  };

  return (
    <section
      ref={(element) => {
        canvas = element;
      }}
      class="relative isolate flex min-h-0 flex-1 overflow-hidden bg-[var(--v2-background-bg-deep)]"
      aria-label="Screen tree"
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
        event.preventDefault();
        const element = canvas;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const current = view();
        setView(
          zoomViewportAtPoint(
            current,
            Math.max(
              MIN_SCALE,
              Math.min(MAX_SCALE, current.scale + (event.deltaY > 0 ? -0.08 : 0.08)),
            ),
            { x: event.clientX - rect.left, y: event.clientY - rect.top },
          ),
        );
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
        pan = { x: event.clientX, y: event.clientY, view: view() };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!pan) return;
        setView({
          ...pan.view,
          x: pan.view.x + event.clientX - pan.x,
          y: pan.view.y + event.clientY - pan.y,
        });
      }}
      onPointerUp={() => {
        pan = undefined;
      }}
      onPointerCancel={() => {
        pan = undefined;
      }}
    >
      <div
        class="pointer-events-none absolute inset-0 opacity-40"
        style={{
          "background-image":
            "radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--text-strong) 11%,transparent) 1px,transparent 0)",
          "background-size": "22px 22px",
        }}
      />

      <div class="absolute top-3 left-3 z-10 flex min-h-9 items-center gap-2 rounded-[10px] border border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_92%,transparent)] px-2.5 shadow-[var(--v2-elevation-floating)] backdrop-blur-[12px]">
        <Icon name="move" size={13} class="text-[var(--text-base)]" />
        <span class="text-[11px] font-medium text-[var(--text-strong)]">Screen tree</span>
        <Show
          when={tree().hasScreenIdentity}
          fallback={<span class="text-[10px] text-[var(--text-weak)]">No mapped screens</span>}
        >
          <span class="text-[10px] text-[var(--text-weak)]">
            {tree().nodes.length} {tree().nodes.length === 1 ? "screen" : "screens"}
          </span>
        </Show>
        <Show when={returns() > 0}>
          <span class="rounded bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-interactive-base)]">
            {returns()} return{returns() === 1 ? "" : "s"}
          </span>
        </Show>
      </div>
      <Show when={tree().hasScreenIdentity}>
        <div class="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-[10px] border border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_92%,transparent)] p-1 shadow-[var(--v2-elevation-floating)] backdrop-blur-[12px]">
          <button
            type="button"
            class="grid size-7 place-items-center rounded-[7px] text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
            aria-label="Zoom out"
            onClick={() =>
              setView((current) => ({
                ...current,
                scale: Math.max(MIN_SCALE, current.scale - 0.1),
              }))
            }
          >
            −
          </button>
          <span class="min-w-9 text-center font-mono text-[10px] text-[var(--text-weak)]">
            {Math.round(view().scale * 100)}%
          </span>
          <button
            type="button"
            class="grid size-7 place-items-center rounded-[7px] text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
            aria-label="Zoom in"
            onClick={() =>
              setView((current) => ({
                ...current,
                scale: Math.min(MAX_SCALE, current.scale + 0.1),
              }))
            }
          >
            +
          </button>
          <button
            type="button"
            class="h-7 rounded-[7px] px-2 text-[10px] font-medium text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
            onClick={fit}
          >
            Fit
          </button>
        </div>
      </Show>

      <Show
        when={tree().hasScreenIdentity}
        fallback={
          <div class="relative z-[1] flex flex-1 flex-col items-center justify-center px-5 text-center">
            <Show
              when={tree().nodes.length > 0}
              fallback={
                <>
                  <span class="mb-2 text-[10.5px] font-semibold tracking-[0.11em] text-[var(--text-weak)] uppercase">
                    New journey
                  </span>
                  <h2 class="m-0 mb-2 text-[24px] font-semibold tracking-[-0.035em] text-[var(--text-strong)]">
                    Build a journey
                  </h2>
                  <p class="m-0 mb-5 max-w-[36ch] text-[12px]/[1.5] text-[var(--text-weak)]">
                    Record or describe the path. Relay will fold repeated screens into return paths.
                  </p>
                  <AgentTestComposer variant="canvas" defaultOpen />
                </>
              }
            >
              <h2 class="m-0 mb-2 text-[24px] font-semibold tracking-[-0.035em] text-[var(--text-strong)]">
                No screen map yet
              </h2>
              <p class="m-0 max-w-[38ch] text-[12px]/[1.5] text-[var(--text-weak)]">
                Record a screen to see the journey’s paths and return points here.
              </p>
            </Show>
            <button
              type="button"
              class="mt-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-01)] hover:text-[var(--text-strong)]"
              onClick={props.onLive}
            >
              <Icon name="circle" size={13} /> Record a screen
            </button>
          </div>
        }
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
          >
            <defs>
              <marker
                id="journey-tree-forward"
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
                id="journey-tree-return"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" class="fill-[var(--text-base)]" />
              </marker>
            </defs>
            <For each={tree().edges}>
              {(edge) => {
                const geometry = () => edgeGeometry(edge, tree().nodes);
                return (
                  <g
                    class="pointer-events-auto cursor-pointer"
                    onClick={() => selectStep(edge.stepIndex)}
                  >
                    <path
                      d={geometry().path}
                      class="fill-none stroke-transparent"
                      stroke-width="18"
                    />
                    <path
                      d={geometry().path}
                      class={cn(
                        "pointer-events-none fill-none",
                        edge.kind === "return"
                          ? "stroke-[var(--text-base)] [stroke-dasharray:6_6]"
                          : "stroke-[var(--text-interactive-base)]",
                      )}
                      stroke-width={edge.kind === "return" ? 1.7 : 2}
                      stroke-linecap="round"
                      marker-end={`url(#journey-tree-${edge.kind})`}
                    />
                    <g transform={`translate(${geometry().labelX}, ${geometry().labelY})`}>
                      <rect
                        x={-Math.max(22, edge.label.length * 3.1 + 10)}
                        y={-10}
                        width={Math.max(44, edge.label.length * 6.2 + 20)}
                        height="20"
                        rx="6"
                        class="fill-[var(--v2-background-bg-base)] stroke-[var(--v2-border-border-muted)]"
                      />
                      <text
                        text-anchor="middle"
                        dominant-baseline="middle"
                        y="0.5"
                        class="fill-[var(--text-weak)] text-[9px] font-medium"
                      >
                        {edge.label}
                      </text>
                    </g>
                  </g>
                );
              }}
            </For>
          </svg>
          <For each={tree().nodes}>
            {(node) => (
              <JourneyScreenCard
                node={node}
                step={draft.steps()[node.representativeStepIndex]!}
                selected={workbench.focusedIndex() === node.representativeStepIndex}
                src={() => screenshotUrl(server, draft.steps()[node.representativeStepIndex])}
                onSelect={() => selectStep(node.representativeStepIndex)}
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={tree().hasScreenIdentity}>
        <p class="pointer-events-none absolute bottom-3 left-1/2 z-10 m-0 -translate-x-1/2 rounded-full bg-[color-mix(in_srgb,var(--v2-background-bg-base)_88%,transparent)] px-3 py-1.5 text-[10px] text-[var(--text-weak)] shadow-[var(--v2-elevation-floating)] backdrop-blur-[10px]">
          Repeated captures fold into one screen · click an action to edit it
        </p>
      </Show>
    </section>
  );
}

function JourneyScreenCard(props: {
  node: JourneyTreeNode;
  step: RecipeStep;
  selected: boolean;
  src: () => string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      class={cn(
        "absolute grid h-[292px] w-[208px] grid-rows-[42px_minmax(0,1fr)_34px] overflow-hidden rounded-[18px] border bg-[var(--v2-background-bg-base)] text-left shadow-[0_10px_30px_rgb(0_0_0/20%)] transition-[border-color,box-shadow] duration-150",
        props.selected
          ? "border-[var(--text-interactive-base)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--v2-background-bg-accent)_22%,transparent),0_10px_30px_rgb(0_0_0/24%)]"
          : "border-[var(--v2-border-border-muted)] hover:border-[var(--v2-border-border-strong)]",
      )}
      style={{ transform: `translate3d(${props.node.x}px, ${props.node.y}px, 0)` }}
      onClick={props.onSelect}
    >
      <header class="flex min-w-0 items-center gap-2 border-b border-[var(--v2-border-border-muted)] px-3">
        <span
          class="grid size-5 shrink-0 place-items-center rounded-md text-white"
          style={{ background: accentForStep(props.step) }}
        >
          <Icon name={iconForStep(props.step)} size={11} />
        </span>
        <strong class="min-w-0 truncate text-[11.5px] font-semibold text-[var(--text-strong)]">
          {props.node.title}
        </strong>
        <Show when={props.node.stepIndexes.length > 1}>
          <span class="ml-auto shrink-0 rounded bg-[var(--v2-background-bg-layer-02)] px-1 py-0.5 font-mono text-[9px] text-[var(--text-weak)]">
            {props.node.stepIndexes.length}×
          </span>
        </Show>
      </header>
      <Show
        when={props.src()}
        fallback={
          <div class="grid place-items-center bg-[radial-gradient(circle_at_50%_35%,color-mix(in_srgb,var(--v2-background-bg-accent)_14%,transparent),transparent_44%),var(--v2-background-bg-deep)]">
            <span class="grid size-11 place-items-center rounded-[14px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] text-[var(--text-base)]">
              <Icon name={iconForStep(props.step)} size={20} />
            </span>
          </div>
        }
      >
        {(src) => (
          <div class="min-h-0 overflow-hidden bg-[#080a0f] p-2">
            <img
              src={src()}
              alt={`Recorded ${props.node.title} screen`}
              draggable={false}
              class="size-full rounded-[12px] object-contain object-top"
            />
          </div>
        )}
      </Show>
      <footer class="flex items-center justify-between gap-2 border-t border-[var(--v2-border-border-muted)] px-3 text-[10px] text-[var(--text-weak)]">
        <span>Step {String(props.node.representativeStepIndex + 1).padStart(2, "0")}</span>
        <Icon name="chevron-right" size={12} />
      </footer>
    </button>
  );
}

function screenshotUrl(server: ReturnType<typeof useServer>, step: RecipeStep | undefined): string {
  const screenshot = evidenceForStep(step)?.screenshot;
  return screenshot ? server.recordingEvidenceUrl(screenshot.recipeId, screenshot.id) : "";
}

function edgeGeometry(edge: JourneyTreeEdge, nodes: JourneyTreeNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const from = byId.get(edge.from)!;
  const to = byId.get(edge.to)!;
  if (edge.kind === "return") {
    const startX = from.x + CARD_W / 2;
    const startY = from.y;
    const endX = to.x + CARD_W / 2;
    const endY = to.y;
    const railY = Math.min(startY, endY) - 48;
    return {
      path: `M ${startX} ${startY} C ${startX} ${railY}, ${endX} ${railY}, ${endX} ${endY}`,
      labelX: (startX + endX) / 2,
      labelY: railY - 12,
    };
  }
  const startX = from.x + CARD_W;
  const startY = from.y + CARD_H / 2;
  const endX = to.x;
  const endY = to.y + CARD_H / 2;
  return {
    path: `M ${startX} ${startY} C ${startX + 56} ${startY}, ${endX - 56} ${endY}, ${endX} ${endY}`,
    labelX: (startX + endX) / 2,
    labelY: (startY + endY) / 2 - 14,
  };
}
