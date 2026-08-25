import { For, Show, createSignal, onCleanup } from "solid-js";
import type { CanvasBounds } from "../lib/app-map-canvas-layout";
import type { AppMapRunPresentationState } from "../lib/app-map-run-projection";
import {
  minimapBoxHeight,
  minimapMarkSize,
  type AppMapMinimapBounds,
} from "../lib/app-map-minimap";
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
  onZoomTo: (scale: number) => void;
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
  const boxHeight = () => minimapBoxHeight(props.bounds);
  const markSize = () => minimapMarkSize(props.bounds, boxHeight());

  return (
    <>
      <aside
        class={cn(
          "absolute right-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-20 hidden w-48 overflow-hidden rounded-xl bg-[color-mix(in_srgb,var(--background-base)_95%,transparent)] shadow-[var(--map-elevation-panel)] backdrop-blur-[16px] transition-transform duration-panel ease-drawer motion-reduce:transition-none min-[901px]:block",
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
            Overview
          </span>
          {/* A stepper reads minus, value, plus. Both controls sitting to the
              left of the number they change made the readout look like a
              separate fourth button. */}
          <div class="flex items-center gap-0.5">
            <button
              type="button"
              class={minimapControl}
              aria-label="Zoom out"
              data-tip="Zoom out · −"
              onClick={props.onZoomOut}
            >
              −
            </button>
            <ZoomMenu
              scale={props.scale}
              onFit={props.onFit}
              onZoomTo={props.onZoomTo}
            />
            <button
              type="button"
              class={minimapControl}
              aria-label="Zoom in"
              data-tip="Zoom in · +"
              onClick={props.onZoomIn}
            >
              +
            </button>
          </div>
        </header>
        <div
          class="relative m-2 cursor-crosshair touch-none overflow-hidden rounded bg-[color-mix(in_srgb,var(--map-canvas)_72%,var(--surface-base))] shadow-[inset_0_0_0_1px_var(--map-divider)] transition-[height] duration-panel ease-drawer motion-reduce:transition-none"
          style={{ height: `${boxHeight()}px` }}
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
                  stroke={
                    group.selected
                      ? "var(--text-interactive-base)"
                      : "var(--text-weak)"
                  }
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
                      edge.selected
                        ? 0.95
                        : !edge.state || edge.state === "idle"
                          ? 0.28
                          : 0.68
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
              {(node) => {
                // Notes and matrices are annotations, not screens, so they read
                // as a squatter mark at the same density as the cards near them.
                const size = () => ({
                  width: markSize().width * (node.kind === "screen" ? 1 : 1.1),
                  height:
                    markSize().height * (node.kind === "screen" ? 1 : 0.5),
                });
                return (
                  <rect
                    class={nodeColor(node)}
                    x={node.x - size().width / 2}
                    y={node.y - size().height / 2}
                    width={size().width}
                    height={size().height}
                    rx={Math.min(size().width, size().height) / 4}
                    fill="currentColor"
                    fill-opacity={
                      node.selected ? 1 : node.kind === "screen" ? 0.9 : 0.62
                    }
                    stroke={
                      node.selected
                        ? "var(--text-interactive-base)"
                        : "var(--map-canvas)"
                    }
                    stroke-width={node.selected ? 1.5 : 0.65}
                    vector-effect="non-scaling-stroke"
                  />
                );
              }}
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
        <button
          type="button"
          class={compactControl}
          aria-label="Zoom in"
          onClick={props.onZoomIn}
        >
          +
        </button>
        <button
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

/**
 * The zoom readout is the control, not a caption beside one. Tabular figures
 * keep the button from twitching between 55% and 100% while a person zooms.
 */
function ZoomMenu(props: {
  scale: number;
  onFit: () => void;
  onZoomTo: (scale: number) => void;
}) {
  const [open, setOpen] = createSignal(false);
  let anchor: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const dismiss = (event: PointerEvent) => {
    if (anchor && !anchor.contains(event.target as Node)) setOpen(false);
  };
  const escape = (event: KeyboardEvent) => {
    if (!open() || event.key !== "Escape") return;
    setOpen(false);
    trigger?.focus();
  };
  document.addEventListener("pointerdown", dismiss, true);
  document.addEventListener("keydown", escape);
  onCleanup(() => {
    document.removeEventListener("pointerdown", dismiss, true);
    document.removeEventListener("keydown", escape);
  });
  const choose = (run: () => void) => {
    run();
    setOpen(false);
    queueMicrotask(() => trigger?.focus());
  };
  const cycle = (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        "[role='menuitem'], [role='menuitemradio']",
      ),
    );
    const index = options.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = (index + step + options.length) % options.length;
    event.preventDefault();
    options[next]?.focus();
  };
  return (
    <div class="relative" ref={(element) => (anchor = element)}>
      <button
        type="button"
        ref={(element) => (trigger = element)}
        class={cn(
          minimapControl,
          "w-auto gap-0.5 px-1.5 font-mono tabular-nums",
          open() && "bg-[var(--surface-base-hover)] text-[var(--text-strong)]",
        )}
        aria-label="Zoom"
        aria-haspopup="menu"
        aria-expanded={open()}
        data-tip="Zoom · = / − keys or menu"
        onClick={() => setOpen((value) => !value)}
      >
        {Math.round(props.scale * 100)}%
      </button>
      <Show when={open()}>
        {(menu) => (
          <div
            // Focus moves into the menu on open so Arrow keys work immediately.
            ref={(element) =>
              queueMicrotask(() =>
                element
                  .querySelector<HTMLElement>("[role='menuitem']")
                  ?.focus(),
              )
            }
            role="menu"
            aria-label="Zoom"
            class="absolute top-[calc(100%+6px)] right-0 z-[var(--z-popover)] grid w-36 gap-px rounded-lg bg-[var(--map-control-surface)] p-1 shadow-[var(--map-elevation-panel)] backdrop-blur-[14px]"
            onKeyDown={cycle}
          >
            <button
              type="button"
              role="menuitem"
              class={zoomMenuItem}
              onClick={() => choose(props.onFit)}
            >
              Fit map
            </button>
            <span
              class="my-0.5 h-px bg-[var(--map-divider)]"
              aria-hidden="true"
            />
            <For each={[0.5, 1, 2]}>
              {(scale) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={Math.round(props.scale * 100) === scale * 100}
                  class={zoomMenuItem}
                  onClick={() => choose(() => props.onZoomTo(scale))}
                >
                  <span class="font-mono tabular-nums">{scale * 100}%</span>
                  <Show when={Math.round(props.scale * 100) === scale * 100}>
                    <span class="ml-auto text-[var(--text-interactive-base)]">
                      ✓
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  );
}

const zoomMenuItem =
  "flex min-h-8 items-center gap-2 rounded-md px-2 text-left text-caption text-[var(--text-base)] outline-none transition-colors duration-hover hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)]";

function nodeColor(node: AppMapMinimapNode): string {
  if (node.kind === "note") return "text-[var(--icon-warning-base)]";
  if (node.kind === "matrix") return "text-[var(--text-interactive-base)]";
  return stateColor(node.state, node.selected);
}

function edgeColor(
  state: AppMapRunPresentationState | undefined,
  selected: boolean,
): string {
  return stateColor(state, selected);
}

function stateColor(
  state: AppMapRunPresentationState | undefined,
  selected: boolean,
): string {
  // "blocked" is mostly the resting state of a map nobody has replayed yet, so it
  // shares the neutral ink. Painting it critical turned a freshly authored
  // 44-screen map into a solid red overview.
  if (state === "failed") return "text-[var(--icon-critical-base)]";
  if (state === "passed") return "text-[var(--icon-success-base)]";
  if (state === "running" || state === "healed")
    return "text-[var(--icon-warning-base)]";
  if (selected) return "text-[var(--text-interactive-base)]";
  return "text-[var(--text-weak)]";
}

const minimapControl =
  "relative grid size-7 place-items-center rounded-lg text-micro text-[var(--text-base)] outline-none before:absolute before:-inset-2 before:content-[''] transition-[background-color,color,transform] duration-hover hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] active:scale-[0.94] focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] motion-reduce:active:scale-100";

const compactControl =
  "relative grid h-10 min-w-10 place-items-center rounded-xl px-2 text-micro text-[var(--text-base)] outline-none before:absolute before:-inset-0.5 before:content-[''] transition-[background-color,color,transform] duration-hover hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] motion-reduce:active:scale-100";
