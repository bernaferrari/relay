import { For, Show } from "solid-js";
import type { CanvasBounds } from "../lib/app-map-canvas-layout";
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
  path: string;
  arrowPath: string | null;
  selected: boolean;
  state?: AppMapRunPresentationState;
};

export type AppMapMinimapGroup = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
};

export function AppMapMinimap(props: {
  scale: number;
  groups: AppMapMinimapGroup[];
  nodes: AppMapMinimapNode[];
  edges: AppMapMinimapEdge[];
  bounds: CanvasBounds;
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
  const edgeProjection = () => {
    const scaleX = 100 / Math.max(1, props.bounds.width);
    const scaleY = 100 / Math.max(1, props.bounds.height);
    return `matrix(${scaleX} 0 0 ${scaleY} ${-props.bounds.left * scaleX} ${-props.bounds.top * scaleY})`;
  };

  return (
    <>
      <aside
        class={cn(
          "absolute right-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-20 hidden w-48 overflow-hidden rounded-xl bg-[color-mix(in_srgb,var(--background-base)_95%,transparent)] shadow-[var(--map-elevation-panel)] backdrop-blur-[16px] transition-transform duration-250 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none min-[901px]:block",
        )}
        style={{
          transform: props.shiftForSidePanel
            ? "translateX(calc(-1 * (var(--app-map-side-panel-reserve) - 16px)))"
            : "translateX(0)",
        }}
        aria-label="Map overview"
      >
        <header class="flex h-10 items-center justify-between border-b border-[var(--map-divider)] px-2 pl-3">
          <span class="text-micro font-semibold tracking-[0.06em] text-[var(--text-weak)] uppercase">
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
            <span class="min-w-9 text-center font-mono text-micro tabular-nums text-[var(--text-weak)]">
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
              class={cn(minimapControl, "w-auto px-1.5 text-micro font-medium")}
              aria-label="Fit map"
              data-tip="Fit map"
              onClick={props.onFit}
            >
              Fit
            </button>
          </div>
        </header>
        <div
          class="relative m-2 h-24 cursor-crosshair touch-none overflow-hidden rounded bg-[color-mix(in_srgb,var(--map-canvas)_72%,var(--surface-base))] shadow-[inset_0_0_0_1px_var(--map-divider)]"
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
            <For each={props.groups}>
              {(group) => (
                <rect
                  x={group.x}
                  y={group.y}
                  width={group.width}
                  height={group.height}
                  rx="2.2"
                  fill="var(--text-interactive-base)"
                  fill-opacity={group.selected ? 0.13 : 0.055}
                  stroke={group.selected ? "var(--text-interactive-base)" : "var(--text-weak)"}
                  stroke-opacity={group.selected ? 0.55 : 0.24}
                  stroke-width={group.selected ? 1.15 : 0.65}
                  vector-effect="non-scaling-stroke"
                />
              )}
            </For>
            <g transform={edgeProjection()}>
              <For each={props.edges}>
                {(edge) => (
                  <g
                    class={edgeColor(edge.state, edge.selected)}
                    stroke="currentColor"
                    stroke-opacity={
                      edge.selected ? 0.95 : !edge.state || edge.state === "idle" ? 0.28 : 0.68
                    }
                    stroke-width={edge.selected ? 1.2 : 0.6}
                    fill="none"
                  >
                    <path d={edge.path} vector-effect="non-scaling-stroke" />
                    <Show when={edge.arrowPath}>
                      {(arrowPath) => (
                        <path
                          d={arrowPath()}
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          vector-effect="non-scaling-stroke"
                        />
                      )}
                    </Show>
                  </g>
                )}
              </For>
            </g>
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
                class="pointer-events-none absolute z-10 rounded border border-[var(--border-focus)] bg-[color-mix(in_srgb,var(--text-interactive-base)_10%,transparent)] shadow-[0_0_0_999px_color-mix(in_srgb,var(--text-strong)_10%,transparent),inset_0_0_0_1px_color-mix(in_srgb,var(--background-base)_46%,transparent)]"
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
      <div class="absolute right-2 bottom-[calc(68px+env(safe-area-inset-bottom))] z-20 flex items-center gap-0.5 rounded-xl bg-[color-mix(in_srgb,var(--background-base)_94%,transparent)] p-1 shadow-[var(--map-elevation-control)] backdrop-blur-[12px] min-[901px]:hidden">
        <button
          type="button"
          class={compactControl}
          aria-label="Zoom out"
          onClick={props.onZoomOut}
        >
          −
        </button>
        <span class="min-w-9 text-center font-mono text-micro tabular-nums text-[var(--text-weak)]">
          {Math.round(props.scale * 100)}%
        </span>
        <button type="button" class={compactControl} aria-label="Zoom in" onClick={props.onZoomIn}>
          +
        </button>
        <button
          type="button"
          class={`${compactControl} w-auto px-2 text-micro`}
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
  "relative grid size-7 place-items-center rounded-lg text-micro text-[var(--text-base)] outline-none before:absolute before:-inset-2 before:content-[''] transition-[background-color,color,transform] duration-150 hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] active:scale-[0.94] focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] motion-reduce:active:scale-100";

const compactControl =
  "relative grid h-10 min-w-10 place-items-center rounded-xl px-2 text-micro text-[var(--text-base)] outline-none before:absolute before:-inset-0.5 before:content-[''] transition-[background-color,color,transform] duration-150 hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] motion-reduce:active:scale-100";
