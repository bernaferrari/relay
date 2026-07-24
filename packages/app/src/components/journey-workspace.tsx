import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import { useRecipeDraft } from "../context/recipe-draft";
import { useServer, type RecipeStep } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { buildJourneyTree, type JourneyTreeNode } from "../lib/journey-tree";
import { zoomViewportAtPoint } from "../lib/viewport-zoom";
import { Icon } from "./icon";
import { accentForStep, evidenceForStep, iconForStep } from "./journey-step-presentation";

type Viewport = { x: number; y: number; scale: number };

const CARD_W = 208;
const CARD_H = 292;
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.15;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The Map is a read-only explanation of what Relay captured: durable screens
 * and the paths between them. It deliberately does not contain the composer,
 * the device picker, or the action inspector — those belong to Device.
 */
export function JourneyWorkspace(props: { onLive: () => void }) {
  const server = useServer();
  const draft = useRecipeDraft();
  const workbench = useWorkbench();
  const tree = createMemo(() => buildJourneyTree(draft.steps()));
  const hasMap = () => tree().hasScreenIdentity && tree().nodes.length > 0;
  const [view, setView] = createSignal<Viewport>({ x: 56, y: 72, scale: 0.78 });
  let canvas: HTMLElement | undefined;
  let pan: { x: number; y: number; view: Viewport } | undefined;
  let fittedSignature = "";

  const bounds = createMemo(() => {
    const nodes = tree().nodes;
    if (!nodes.length) return { width: 720, height: 520 };
    return {
      width: Math.max(720, Math.max(...nodes.map((node) => node.x + CARD_W)) + 96),
      height: Math.max(520, Math.max(...nodes.map((node) => node.y + CARD_H)) + 96),
    };
  });

  const returnCount = createMemo(
    () => tree().edges.filter((edge) => edge.kind === "return").length,
  );
  const summary = createMemo(() => {
    const screens = tree().nodes.length;
    const returns = returnCount();
    return `${screens} ${screens === 1 ? "screen" : "screens"}${
      returns ? ` · ${returns} return ${returns === 1 ? "path" : "paths"}` : ""
    }`;
  });

  const fit = () => {
    const element = canvas;
    if (!element || !hasMap()) return;
    const content = bounds();
    const padding = 64;
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
    const signature = hasMap()
      ? tree()
          .nodes.map((node) => node.id)
          .join("|")
      : "";
    if (!signature || signature === fittedSignature) return;
    fittedSignature = signature;
    requestAnimationFrame(fit);
  });

  const selectStep = (index: number) => {
    workbench.focusStep(index);
    draft.setExpandedStep(index);
  };

  const zoom = (delta: number, clientPoint?: { x: number; y: number }) => {
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

  return (
    <section
      ref={(element) => {
        canvas = element;
      }}
      class="relative isolate flex min-h-0 flex-1 select-none overflow-hidden bg-[var(--v2-background-bg-deep)]"
      aria-label="Journey map"
      onWheel={(event) => {
        if (!hasMap() || (!event.ctrlKey && !event.metaKey && !event.altKey)) return;
        event.preventDefault();
        zoom(event.deltaY > 0 ? -0.08 : 0.08, { x: event.clientX, y: event.clientY });
      }}
      onPointerDown={(event) => {
        if (!hasMap() || event.button !== 0 || (event.target as HTMLElement).closest("button"))
          return;
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
      onLostPointerCapture={() => {
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

      <Show
        when={hasMap()}
        fallback={<MapEmptyState onOpenDevice={props.onLive} hasSteps={draft.steps().length > 0} />}
      >
        <>
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
                  id="journey-map-forward"
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
                  id="journey-map-return"
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
                  const geometry = () => edgeGeometry(edge, tree().nodes);
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
                      marker-end={`url(#journey-map-${edge.kind})`}
                    />
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

          <div class="absolute right-4 bottom-4 z-10 flex items-center gap-1 rounded-[10px] border border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_92%,transparent)] p-1 shadow-[var(--v2-elevation-floating)] backdrop-blur-[12px]">
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
          <p class="pointer-events-none absolute bottom-5 left-5 z-10 m-0 text-[11px] text-[var(--text-weak)]">
            {summary()}
          </p>
        </>
      </Show>
    </section>
  );
}

const mapControlButton =
  "grid h-7 min-w-7 place-items-center rounded-[7px] px-1.5 text-[10px] text-[var(--text-base)] transition-colors duration-100 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-border-strong-focus";

function MapEmptyState(props: { onOpenDevice: () => void; hasSteps: boolean }) {
  return (
    <div class="relative z-[1] flex flex-1 flex-col items-center justify-center px-5 text-center">
      <span class="mb-3 grid size-8 place-items-center text-[var(--text-base)]">
        <Icon name="move" size={16} />
      </span>
      <h2 class="m-0 text-[18px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
        {props.hasSteps ? "No captured screens yet" : "Your journey map will appear here"}
      </h2>
      <p class="m-0 mt-1.5 max-w-[34ch] text-[12px]/[1.5] text-[var(--text-weak)]">
        {props.hasSteps
          ? "Record it once to map its screens and return paths."
          : "Record a path in Device to map its screens and return paths."}
      </p>
      <button
        type="button"
        class="mt-4 inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium text-[var(--text-base)] transition-colors duration-100 hover:bg-[var(--v2-background-bg-layer-01)] hover:text-[var(--text-strong)] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus"
        onClick={props.onOpenDevice}
      >
        <Icon name="grid" size={13} /> Open Device
      </button>
    </div>
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
        "absolute grid h-[292px] w-[208px] grid-rows-[38px_minmax(0,1fr)_28px] overflow-hidden rounded-[16px] border bg-[var(--v2-background-bg-base)] text-left shadow-[0_10px_30px_rgb(0_0_0/20%)] transition-[border-color,box-shadow] duration-150",
        props.selected
          ? "border-[var(--text-interactive-base)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--v2-background-bg-accent)_22%,transparent),0_10px_30px_rgb(0_0_0/24%)]"
          : "border-[var(--v2-border-border-muted)] hover:border-[var(--v2-border-border-strong)]",
      )}
      style={{ transform: `translate3d(${props.node.x}px, ${props.node.y}px, 0)` }}
      onClick={props.onSelect}
    >
      <header class="flex min-w-0 items-center gap-2 border-b border-[var(--v2-border-border-muted)] px-2.5">
        <span
          class="grid size-[18px] shrink-0 place-items-center rounded-[6px] text-white"
          style={{ background: accentForStep(props.step) }}
        >
          <Icon name={iconForStep(props.step)} size={10} />
        </span>
        <strong class="min-w-0 truncate text-[11.5px] font-semibold text-[var(--text-strong)]">
          {props.node.title}
        </strong>
        <Show when={props.node.stepIndexes.length > 1}>
          <span class="ml-auto shrink-0 font-mono text-[9px] text-[var(--text-weak)]">
            {props.node.stepIndexes.length}×
          </span>
        </Show>
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
              class="size-full rounded-[10px] object-contain object-top"
            />
          </div>
        )}
      </Show>
      <footer class="flex items-center justify-between px-2.5 text-[9.5px] text-[var(--text-weak)]">
        <span>Step {String(props.node.representativeStepIndex + 1).padStart(2, "0")}</span>
        <Icon name="chevron-right" size={11} />
      </footer>
    </button>
  );
}

function screenshotUrl(server: ReturnType<typeof useServer>, step: RecipeStep | undefined): string {
  const screenshot = evidenceForStep(step)?.screenshot;
  return screenshot ? server.recordingEvidenceUrl(screenshot.recipeId, screenshot.id) : "";
}

function edgeGeometry(
  edge: { from: string; to: string; kind: "forward" | "return" },
  nodes: JourneyTreeNode[],
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const from = byId.get(edge.from)!;
  const to = byId.get(edge.to)!;
  if (edge.kind === "return") {
    const startX = from.x + CARD_W / 2;
    const startY = from.y;
    const endX = to.x + CARD_W / 2;
    const endY = to.y;
    const railY = Math.min(startY, endY) - 42;
    return {
      path: `M ${startX} ${startY} C ${startX} ${railY}, ${endX} ${railY}, ${endX} ${endY}`,
    };
  }
  const startX = from.x + CARD_W;
  const startY = from.y + CARD_H / 2;
  const endX = to.x;
  const endY = to.y + CARD_H / 2;
  return {
    path: `M ${startX} ${startY} C ${startX + 52} ${startY}, ${endX - 52} ${endY}, ${endX} ${endY}`,
  };
}
