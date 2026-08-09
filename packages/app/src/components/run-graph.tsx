import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import {
  executionStateLabel,
  type ExecutionMoment,
  type ExecutionMomentState,
} from "../lib/execution-moments";
import type { FrameCanvasItem } from "../lib/frame-canvas-presentation";
import { cn } from "../lib/cn";
import { zoomViewportAtPoint } from "../lib/viewport-zoom";
import { GLYPH_META, Icon } from "./icon";

type Viewport = { x: number; y: number; scale: number };
type EdgeStyle = "flow" | "failure";

const RUN_GRAPH_NODE_WIDTH = 220;
const RUN_GRAPH_NODE_PORT_Y = 200;
const RUN_GRAPH_NODE_GAP = 96;

// Same chrome recipe as app-map-workspace.tsx's Map — duplicated locally
// (not imported) so this read-only run-report view stays decoupled from the
// planning editor's state and interactions.
const boardChrome =
  "absolute top-3.5 z-[5] flex min-h-[38px] items-center rounded-[10px] border border-[var(--border-weak-base)] bg-[color-mix(in_srgb,var(--background-base)_92%,transparent)] shadow-[var(--shadow-lg)] backdrop-blur-[12px]";

const controlBtn =
  "inline-flex h-[30px] min-w-[30px] items-center justify-center rounded-[7px] text-[10px] text-[var(--text-base)] hover:bg-surface-raised-base-hover hover:text-[var(--text-strong)]";

function formatStepDuration(durationMs: number): string {
  return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

function runStateDot(state: ExecutionMomentState): string {
  if (state === "failed" || state === "cancelled") return "bg-[var(--icon-critical-base)]";
  if (state === "planned") return "bg-[var(--border-strong-base)]";
  if (state === "running")
    return "bg-[var(--text-interactive-base)] shadow-[0_0_8px_var(--text-interactive-base)]";
  return "bg-[var(--icon-success-base)]";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Read-only run-report counterpart to app-map-workspace.tsx's screen tree.
 * Same node-graph grammar (curved bezier edges, phone-card nodes, pan/zoom)
 * but fed by real execution moments instead of the plan — real screenshots,
 * real pass/fail state, real per-step timing. No editing affordances.
 */
export function RunGraph(props: {
  moments: ExecutionMoment[];
  items: FrameCanvasItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  let board: HTMLElement | undefined;
  let drag: { x: number; y: number; vx: number; vy: number } | null = null;
  let lastCenteredIndex: number | null = null;

  const nodes = createMemo(() =>
    props.moments.map((moment, index) => ({
      moment,
      index,
      x: index * (RUN_GRAPH_NODE_WIDTH + RUN_GRAPH_NODE_GAP),
      y: 0,
    })),
  );
  const width = () =>
    Math.max(
      620,
      nodes().length * (RUN_GRAPH_NODE_WIDTH + RUN_GRAPH_NODE_GAP) + RUN_GRAPH_NODE_WIDTH,
    );

  // Fit measures the actual board and a rendered node instead of guessing
  // from window size — mirrors app-map-workspace's fittedView() exactly.
  const fittedView = (): Viewport => {
    const count = Math.max(1, nodes().length);
    const contentWidth = count * (RUN_GRAPH_NODE_WIDTH + RUN_GRAPH_NODE_GAP) - RUN_GRAPH_NODE_GAP;
    const boardWidth = board?.clientWidth ?? Math.max(560, window.innerWidth - 700);
    const boardHeight = board?.clientHeight ?? 560;
    const contentHeight =
      board?.querySelector<HTMLElement>("[data-run-graph-node]")?.offsetHeight ?? 400;
    const pad = 56;
    const scale = Math.min(
      1,
      Math.max(
        0.3,
        Math.min((boardWidth - pad * 2) / contentWidth, (boardHeight - pad * 2) / contentHeight),
      ),
    );
    return {
      x: Math.max(pad, (boardWidth - contentWidth * scale) / 2),
      y: Math.max(32, (boardHeight - contentHeight * scale) / 2),
      scale,
    };
  };
  const [view, setView] = createSignal<Viewport>({ x: 48, y: 48, scale: 0.9 });
  onMount(() => queueMicrotask(() => setView(fittedView())));

  function zoom(delta: number, clientPoint?: { x: number; y: number }): void {
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const current = view();
    const anchor = clientPoint
      ? { x: clientPoint.x - rect.left, y: clientPoint.y - rect.top }
      : { x: rect.width / 2, y: rect.height / 2 };
    setView(zoomViewportAtPoint(current, clamp(current.scale + delta, 0.42, 1.15), anchor));
  }

  // Selecting a step elsewhere (Steps tab, replay scrubber) should bring its
  // node into view rather than leaving the user hunting for it off-canvas.
  createEffect(() => {
    const selected = props.selectedIndex;
    if (selected === lastCenteredIndex || !board) return;
    const target = nodes()[selected];
    if (!target) return;
    lastCenteredIndex = selected;
    setView((current) => ({
      ...current,
      x: board!.clientWidth / 2 - (target.x + RUN_GRAPH_NODE_WIDTH / 2) * current.scale,
      y: Math.max(40, Math.min(current.y, 80)),
    }));
  });

  const resultCounts = createMemo(() => {
    const states = nodes().map((item) => item.moment.state);
    return {
      passed: states.filter((state) => state === "passed").length,
      failed: states.filter((state) => state === "failed" || state === "cancelled").length,
      running: states.filter((state) => state === "running").length,
    };
  });

  return (
    <section
      ref={(element) => {
        board = element;
      }}
      class="!absolute inset-0 cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing [background-image:radial-gradient(circle_at_1px_1px,color-mix(in_srgb,var(--text-strong)_10%,transparent)_1px,transparent_0)] [background-size:20px_20px]"
      aria-label="Run screen path"
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) return;
        event.preventDefault();
        zoom(event.deltaY > 0 ? -0.08 : 0.08, { x: event.clientX, y: event.clientY });
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, select"))
          return;
        event.preventDefault();
        const current = view();
        drag = { x: event.clientX, y: event.clientY, vx: current.x, vy: current.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        setView((current) => ({
          ...current,
          x: drag!.vx + event.clientX - drag!.x,
          y: drag!.vy + event.clientY - drag!.y,
        }));
      }}
      onPointerUp={() => {
        drag = null;
      }}
      onPointerCancel={() => {
        drag = null;
      }}
      onLostPointerCapture={() => {
        drag = null;
      }}
    >
      <div class={cn(boardChrome, "left-3.5 gap-2.5 px-2.5 text-[10px] text-[var(--text-base)]")}>
        <span class="inline-flex items-center gap-1.5 font-semibold">
          <i class="size-1.5 rounded-full bg-[var(--text-interactive-base)] shadow-[0_0_9px_color-mix(in_srgb,var(--text-interactive-base)_65%,transparent)]" />
          {nodes().length} {nodes().length === 1 ? "step" : "steps"}
        </span>
        <b class="border-l border-[var(--border-weak-base)] pl-2.5 font-mono text-[9px] font-normal text-[var(--text-weak)]">
          {resultCounts().running > 0
            ? `Running step ${resultCounts().passed + resultCounts().failed + 1}`
            : resultCounts().failed > 0
              ? `${resultCounts().failed} failed · ${resultCounts().passed} passed`
              : `${resultCounts().passed} passed`}
        </b>
      </div>
      <div class={cn(boardChrome, "right-3.5 gap-0.5 border-0 p-1")}>
        <button type="button" class={controlBtn} onClick={() => zoom(-0.1)} aria-label="Zoom out">
          −
        </button>
        <span class="inline-flex h-[30px] min-w-10 items-center justify-center font-mono text-[10px] text-[var(--text-weak)]">
          {Math.round(view().scale * 100)}%
        </span>
        <button type="button" class={controlBtn} onClick={() => zoom(0.1)} aria-label="Zoom in">
          +
        </button>
        <button type="button" class={controlBtn} onClick={() => setView(fittedView())}>
          Fit
        </button>
      </div>

      <div
        class="absolute top-16 left-0 h-[620px] origin-top-left will-change-transform"
        style={{
          transform: `translate3d(${view().x}px, ${view().y}px, 0) scale(${view().scale})`,
          width: `${width()}px`,
        }}
      >
        <svg
          class="pointer-events-auto absolute inset-0 overflow-visible"
          width={width()}
          height="620"
          aria-label="Run step path"
        >
          <defs>
            <marker
              id="run-graph-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                class="fill-[var(--text-interactive-base)] stroke-none"
              />
            </marker>
          </defs>
          <For each={nodes().slice(0, -1)}>
            {(item) => {
              const next = () => nodes()[item.index + 1]!;
              const x1 = () => item.x + RUN_GRAPH_NODE_WIDTH + 7;
              const y1 = () => item.y + RUN_GRAPH_NODE_PORT_Y;
              const x2 = () => next().x - 13;
              const y2 = () => next().y + RUN_GRAPH_NODE_PORT_Y;
              const style = (): EdgeStyle =>
                next().moment.state === "failed" ? "failure" : "flow";
              const lineClass = () =>
                cn(
                  "pointer-events-none fill-none stroke-2",
                  style() === "failure"
                    ? "stroke-[var(--icon-critical-base)] [stroke-dasharray:8_5]"
                    : "stroke-[color-mix(in_srgb,var(--text-interactive-base)_62%,var(--border-weak-base))] [stroke-dasharray:6_7]",
                );
              // Real elapsed time between two captured/attempted steps — no
              // placeholder text when the run never reached one of them.
              const label = () => {
                const from = item.moment;
                const to = next().moment;
                const start = to.startedAt;
                const end = from.finishedAt ?? from.startedAt;
                if (typeof start !== "number" || typeof end !== "number") return "";
                const gap = start - end;
                return gap >= 0 ? formatStepDuration(gap) : "";
              };
              return (
                <g>
                  <path
                    class="pointer-events-none fill-none stroke-transparent [stroke-width:18]"
                    d={`M ${x1()} ${y1()} C ${x1() + 56} ${y1()}, ${x2() - 56} ${y2()}, ${x2()} ${y2()}`}
                  />
                  <path
                    class={lineClass()}
                    marker-end="url(#run-graph-arrow)"
                    d={`M ${x1()} ${y1()} C ${x1() + 56} ${y1()}, ${x2() - 56} ${y2()}, ${x2()} ${y2()}`}
                  />
                  <Show when={label()}>
                    <text
                      class="pointer-events-none fill-[var(--text-weak)] font-mono text-[9px]"
                      x={(x1() + x2()) / 2}
                      y={(y1() + y2()) / 2 - 10}
                      text-anchor="middle"
                    >
                      {label()}
                    </text>
                  </Show>
                </g>
              );
            }}
          </For>
        </svg>
        <For each={nodes()}>
          {(item) => {
            const active = () => props.selectedIndex === item.index;
            const src = () => props.items[item.index]?.src || "";
            return (
              <div
                role="button"
                tabIndex={0}
                data-run-graph-node
                aria-label={`Step ${item.index + 1}: ${item.moment.title}. ${executionStateLabel(item.moment.state, "step")}`}
                aria-current={active() ? "step" : undefined}
                class="group absolute top-0 left-0 w-[220px] origin-top-left cursor-pointer select-none rounded-[18px] p-0 text-left outline-none"
                style={{ transform: `translate3d(${item.x}px, ${item.y}px, 0)` }}
                onClick={() => props.onSelect(item.index)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  props.onSelect(item.index);
                }}
              >
                <RunGraphNode
                  moment={item.moment}
                  index={item.index}
                  src={src()}
                  active={active()}
                />
                <Show when={item.index > 0}>
                  <div
                    class="absolute top-[195px] left-[-5px] size-2.5 rounded-full border-2 border-[var(--background-base)] bg-[var(--text-interactive-base)]"
                    aria-hidden="true"
                  />
                </Show>
                <Show when={item.index < nodes().length - 1}>
                  <div
                    class="absolute top-[195px] right-[-5px] size-2.5 rounded-full border-2 border-[var(--background-base)] bg-[var(--text-interactive-base)]"
                    aria-hidden="true"
                  />
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </section>
  );
}

/** Node card — visual twin of app-map-workspace's FlowPlanCard, fed by an
 * execution moment instead of a planned step. Read-only: no add-step
 * affordance, no draggable repositioning, no edge-click editor. */
function RunGraphNode(props: {
  moment: ExecutionMoment;
  index: number;
  src: string;
  active: boolean;
}) {
  // ExecutionMoment does not carry the planned step's `kind` — the header
  // label instead comes from the moment's own first recorded action glyph,
  // real data captured during the run rather than a re-derived plan detail.
  const glyph = () => GLYPH_META[props.moment.actions[0] ?? ""];
  const failed = () => props.moment.state === "failed";
  return (
    <div
      class={cn(
        "relative grid h-[400px] grid-rows-[34px_minmax(0,1fr)_36px] overflow-hidden rounded-[18px] border shadow-[0_2px_10px_rgb(0_0_0/12%)] transition-[border-color,box-shadow] duration-150",
        "bg-surface-raised-stronger-non-alpha",
        "before:absolute before:top-0 before:right-5 before:left-5 before:h-px before:bg-[linear-gradient(90deg,transparent,var(--run-graph-node-accent),transparent)] before:opacity-70 before:content-['']",
        props.active &&
          "shadow-[0_0_0_2px_color-mix(in_srgb,var(--text-interactive-base)_24%,transparent),0_6px_18px_rgb(0_0_0/18%)]",
        // Exactly one border-color utility, chosen by priority — two classes
        // both setting border-color have equal specificity, so which one
        // "wins" depends on generated stylesheet order, not on which is
        // listed last here. Keeping this to a single ternary is the only
        // reliable way to guarantee failed beats active beats default.
        failed()
          ? "border-[color-mix(in_srgb,var(--icon-critical-base)_65%,var(--border-weak-base))]"
          : props.active
            ? "border-[var(--text-interactive-base)]"
            : "border-[var(--border-strong-base)]",
      )}
      style={{
        "--run-graph-node-accent": failed()
          ? "var(--icon-critical-base)"
          : "var(--text-interactive-base)",
      }}
    >
      <header class="grid grid-cols-[auto_1fr] items-center gap-2 border-b border-[color-mix(in_srgb,var(--border-weak-base)_72%,transparent)] px-3 text-[var(--text-weak)]">
        <span class="font-mono text-[11px] leading-none text-[var(--text-base)]">
          {String(props.index + 1).padStart(2, "0")}
        </span>
        <span class="truncate text-[10px] font-semibold tracking-[0.09em] uppercase">
          {glyph()?.label ?? "Step"}
        </span>
      </header>
      <Show
        when={props.src}
        fallback={
          <div class="grid min-w-0 place-items-center bg-[radial-gradient(circle_at_50%_38%,color-mix(in_srgb,var(--run-graph-node-accent)_13%,transparent),transparent_42%),var(--background-deep)] p-5 text-center">
            <span class="grid size-[46px] place-items-center rounded-[14px] border border-[color-mix(in_srgb,var(--run-graph-node-accent)_28%,var(--border-weak-base))] bg-[color-mix(in_srgb,var(--run-graph-node-accent)_11%,var(--surface-base))] text-[color-mix(in_srgb,var(--run-graph-node-accent)_78%,white)]">
              <Icon name={failed() ? "alert" : (glyph()?.icon ?? "bolt")} size={22} />
            </span>
            <div class="mt-4 min-w-0">
              <strong class="line-clamp-3 block text-[14px]/[1.4] font-semibold tracking-[-0.012em] text-[var(--text-strong)]">
                {props.moment.title}
              </strong>
            </div>
          </div>
        }
      >
        <div class="relative min-h-0 overflow-hidden bg-[var(--background-deep)]">
          <img
            src={props.src}
            alt={`Device evidence for step ${props.index + 1}`}
            draggable={false}
            class="size-full select-none object-contain object-top"
          />
          <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pt-8 pb-2.5">
            <Show when={glyph()}>
              {(g) => (
                <small class="mb-0.5 block text-[9px] font-semibold tracking-[0.08em] text-[color-mix(in_srgb,var(--text-invert-strong)_65%,transparent)] uppercase">
                  {g().label}
                </small>
              )}
            </Show>
            <strong class="line-clamp-1 block text-[13px] font-semibold text-[var(--text-invert-strong)]">
              {props.moment.title}
            </strong>
          </div>
        </div>
      </Show>
      <footer class="flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-weak-base)_72%,transparent)] px-3 text-[var(--text-weak)]">
        <span class="inline-flex items-center gap-1.5 text-[10px]">
          <i class={cn("size-1.5 rounded-full", runStateDot(props.moment.state))} />
          {executionStateLabel(props.moment.state, "step")}
          <Show when={props.moment.durationMs}>
            <b class="font-mono font-normal">· {formatStepDuration(props.moment.durationMs!)}</b>
          </Show>
        </span>
        <Icon name="chevron-right" size={13} />
      </footer>
    </div>
  );
}
