import { For, Show } from "solid-js";
import {
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  type CanvasPoint,
} from "../lib/app-map-canvas-layout";
import type { MapTreeNode } from "../lib/app-map-tree";
import type { AgentWorker } from "./app-map-agent-types";

const GAP = 48;

function originFor(nodes: readonly MapTreeNode[], positionFor: (node: MapTreeNode) => CanvasPoint) {
  if (!nodes.length) return { x: 80, y: 96 };
  let right = -Infinity;
  let top = Infinity;
  for (const node of nodes) {
    const point = positionFor(node);
    right = Math.max(right, point.x + SCREEN_CARD_WIDTH);
    top = Math.min(top, point.y);
  }
  return { x: right + GAP, y: Number.isFinite(top) ? top : 96 };
}

/**
 * Placeholder screen cards for agents currently mapping. They live in canvas
 * space so a human can watch work happen without opening the AI drawer.
 */
export function AppMapAgentGhosts(props: {
  workers: readonly AgentWorker[];
  nodes: readonly MapTreeNode[];
  positionFor: (node: MapTreeNode) => CanvasPoint;
}) {
  const active = () =>
    props.workers.filter((worker) => worker.status === "running" || worker.status === "queued");
  const origin = () => originFor(props.nodes, props.positionFor);

  return (
    <Show when={active().length}>
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <For each={active()}>
          {(worker, index) => (
            <article
              class="absolute overflow-hidden rounded-xl border border-dashed border-[color-mix(in_srgb,var(--text-interactive-base)_35%,transparent)] bg-[color-mix(in_srgb,var(--surface-base)_78%,transparent)] shadow-[var(--map-elevation-control)]"
              style={{
                width: `${SCREEN_CARD_WIDTH}px`,
                height: `${SCREEN_CARD_HEIGHT}px`,
                transform: `translate3d(${origin().x + index() * (SCREEN_CARD_WIDTH + GAP)}px, ${origin().y}px, 0)`,
              }}
            >
              <div class="h-8 border-b border-[color-mix(in_srgb,var(--border-weak-base)_80%,transparent)] px-2.5">
                <span class="flex h-full items-center truncate text-micro font-semibold text-[var(--text-interactive-base)]">
                  {worker.model.shortLabel}
                </span>
              </div>
              <div class="grid h-[calc(100%-32px)] place-items-center bg-[color-mix(in_srgb,var(--product-accent-soft)_55%,transparent)] motion-safe:animate-pulse">
                <span class="max-w-[18ch] px-3 text-center text-caption/[1.35] text-[var(--text-weak)]">
                  {worker.stage || "Exploring…"}
                </span>
              </div>
            </article>
          )}
        </For>
      </div>
    </Show>
  );
}
