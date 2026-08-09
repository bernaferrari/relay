import { For, Show } from "solid-js";
import type { AppMapRunPresentationState } from "../lib/app-map-run-projection";
import type { AppMapMinimapBounds } from "../lib/app-map-minimap";
import { cn } from "../lib/cn";

export type AppMapMinimapNode = {
  id: string;
  kind: "screen" | "note" | "matrix";
  x: number;
  y: number;
  selected: boolean;
  state?: AppMapRunPresentationState;
};

export type AppMapMinimapEdge = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  selected: boolean;
  state?: AppMapRunPresentationState;
};

export function AppMapMinimap(props: {
  scale: number;
  nodes: AppMapMinimapNode[];
  edges: AppMapMinimapEdge[];
  viewport: AppMapMinimapBounds;
  shiftForSidePanel: boolean;
  wideDevice: boolean;
  onFit: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onNavigate: (ratio: { x: number; y: number }) => void;
}) {
  let dragging = false;

  const navigate = (event: PointerEvent, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    props.onNavigate({
      x: (event.clientX - rect.left) / Math.max(1, rect.width),
      y: (event.clientY - rect.top) / Math.max(1, rect.height),
    });
  };
  const stopDragging = () => {
    dragging = false;
  };

  return (
    <>
      <aside
        class={cn(
          "absolute bottom-[calc(16px+env(safe-area-inset-bottom))] z-20 hidden w-48 overflow-hidden rounded-[12px] bg-[color-mix(in_srgb,var(--background-base)_95%,transparent)] shadow-[var(--map-elevation-panel)] backdrop-blur-[16px] min-[901px]:block",
          props.shiftForSidePanel
            ? props.wideDevice
              ? "right-[652px]"
              : "right-[512px]"
            : "right-4",
        )}
        aria-label="Map overview"
      >
        <header class="flex h-10 items-center justify-between border-b border-[var(--map-divider)] px-2 pl-3">
          <span class="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-weak)] uppercase">
            Map
          </span>
          <div class="flex items-center gap-0.5">
            <button
              type="button"
              class={minimapControl}
              aria-label="Zoom out"
              data-tip="Zoom out"
              onClick={props.onZoomOut}
            >
              −
            </button>
            <span class="min-w-9 text-center font-mono text-[9.5px] tabular-nums text-[var(--text-weak)]">
              {Math.round(props.scale * 100)}%
            </span>
            <button
              type="button"
              class={minimapControl}
              aria-label="Zoom in"
              data-tip="Zoom in"
              onClick={props.onZoomIn}
            >
              +
            </button>
            <button
              type="button"
              class={cn(minimapControl, "w-auto px-1.5 text-[9.5px] font-medium")}
              aria-label="Fit map"
              data-tip="Fit map"
              onClick={props.onFit}
            >
              Fit
            </button>
          </div>
        </header>
        <div
          class="relative m-2 h-24 cursor-crosshair touch-none overflow-hidden rounded-[4px] bg-[color-mix(in_srgb,var(--map-canvas)_72%,var(--surface-base))] shadow-[inset_0_0_0_1px_var(--map-divider)]"
          onPointerDown={(event) => {
            event.stopPropagation();
            dragging = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            navigate(event, event.currentTarget);
          }}
          onPointerMove={(event) => {
            if (!dragging) return;
            event.stopPropagation();
            navigate(event, event.currentTarget);
          }}
          onPointerUp={(event) => {
            event.stopPropagation();
            stopDragging();
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={stopDragging}
          onWheel={(event) => event.stopPropagation()}
          aria-hidden="true"
        >
          <svg
            class="pointer-events-none absolute inset-0 size-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <For each={props.edges}>
              {(edge) => (
                <line
                  class={edgeColor(edge.state, edge.selected)}
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  stroke="currentColor"
                  stroke-opacity={
                    edge.selected ? 0.95 : !edge.state || edge.state === "idle" ? 0.38 : 0.68
                  }
                  stroke-width={edge.selected ? 1.2 : 0.7}
                  vector-effect="non-scaling-stroke"
                />
              )}
            </For>
            <For each={props.nodes}>
              {(node) => (
                <rect
                  class={nodeColor(node)}
                  x={node.x - (node.kind === "screen" ? 2.2 : 2.6)}
                  y={node.y - (node.kind === "screen" ? 3.4 : 1.6)}
                  width={node.kind === "screen" ? 4.4 : 5.2}
                  height={node.kind === "screen" ? 6.8 : 3.2}
                  rx={node.kind === "screen" ? 1.1 : 0.7}
                  fill="currentColor"
                  fill-opacity={node.selected ? 1 : node.kind === "screen" ? 0.9 : 0.62}
                  stroke={node.selected ? "var(--text-interactive-base)" : "var(--map-canvas)"}
                  stroke-width={node.selected ? 1.5 : 0.65}
                  vector-effect="non-scaling-stroke"
                />
              )}
            </For>
          </svg>
          <Show when={props.viewport}>
            {(viewport) => (
              <div
                class="pointer-events-none absolute z-10 rounded-[4px] border border-[var(--border-focus)] bg-[color-mix(in_srgb,var(--text-interactive-base)_10%,transparent)] shadow-[0_0_0_999px_color-mix(in_srgb,var(--text-strong)_10%,transparent),inset_0_0_0_1px_color-mix(in_srgb,var(--background-base)_46%,transparent)]"
                style={{
                  left: `${viewport().left}%`,
                  top: `${viewport().top}%`,
                  width: `${viewport().width}%`,
                  height: `${viewport().height}%`,
                }}
              />
            )}
          </Show>
        </div>
      </aside>
      <div class="absolute right-2 bottom-[calc(68px+env(safe-area-inset-bottom))] z-20 flex items-center gap-0.5 rounded-[10px] bg-[color-mix(in_srgb,var(--background-base)_94%,transparent)] p-1 shadow-[var(--map-elevation-control)] backdrop-blur-[12px] min-[901px]:hidden">
        <button
          type="button"
          class={compactControl}
          aria-label="Zoom out"
          onClick={props.onZoomOut}
        >
          −
        </button>
        <span class="min-w-9 text-center font-mono text-[10px] tabular-nums text-[var(--text-weak)]">
          {Math.round(props.scale * 100)}%
        </span>
        <button type="button" class={compactControl} aria-label="Zoom in" onClick={props.onZoomIn}>
          +
        </button>
        <button
          type="button"
          class={`${compactControl} w-auto px-2 text-[10px]`}
          aria-label="Fit map"
          onClick={props.onFit}
        >
          Fit
        </button>
      </div>
    </>
  );
}

function nodeColor(node: AppMapMinimapNode): string {
  if (node.kind === "note") return "text-[var(--icon-warning-base)]";
  if (node.kind === "matrix") return "text-[var(--text-interactive-base)]";
  return stateColor(node.state, node.selected);
}

function edgeColor(state: AppMapRunPresentationState | undefined, selected: boolean): string {
  return stateColor(state, selected);
}

function stateColor(state: AppMapRunPresentationState | undefined, selected: boolean): string {
  if (state === "failed" || state === "blocked") return "text-[var(--icon-critical-base)]";
  if (state === "passed") return "text-[var(--icon-success-base)]";
  if (state === "running" || state === "healed") return "text-[var(--icon-warning-base)]";
  if (selected) return "text-[var(--text-interactive-base)]";
  return "text-[var(--text-weak)]";
}

const minimapControl =
  "relative grid size-7 place-items-center rounded-[7px] text-[10px] text-[var(--text-base)] outline-none before:absolute before:-inset-2 before:content-[''] transition-[background-color,color,transform] duration-150 hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] active:scale-[0.94] focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] motion-reduce:active:scale-100";

const compactControl =
  "relative grid h-10 min-w-10 place-items-center rounded-[9px] px-2 text-[10.5px] text-[var(--text-base)] outline-none before:absolute before:-inset-0.5 before:content-[''] transition-[background-color,color,transform] duration-150 hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] motion-reduce:active:scale-100";
