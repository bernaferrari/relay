import { For, Show, createEffect, createSignal } from "solid-js";
import type { LogicalScrollSurface } from "@relay/protocol";
import { cn } from "../lib/cn";

export function LogicalScrollSurfaceViewer(props: {
  surface: LogicalScrollSurface;
  evidenceUrl: (uri: string, mime: "image/png" | "application/json") => string;
  regenerating?: boolean;
  onRegenerate?: () => void;
}) {
  const [view, setView] = createSignal<"composite" | "viewports">(
    props.surface.composite ? "composite" : "viewports",
  );
  createEffect(() => {
    if (!props.surface.composite) setView("viewports");
  });
  const statusLabel = () =>
    props.surface.status === "completed" ? "Complete" : `Partial · ${props.surface.reason}`;

  return (
    <section class="grid gap-2.5 border-t border-[var(--border-weak-base)] px-3 py-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="m-0 text-[10.5px] font-semibold text-[var(--text-strong)]">
            Logical test surface
          </h3>
          <p class="m-0 mt-0.5 text-[9.5px]/[1.4] text-[var(--text-weak)]">
            {props.surface.viewports.length} raw viewport
            {props.surface.viewports.length === 1 ? "" : "s"} · {statusLabel()}
          </p>
          <p class="m-0 mt-0.5 text-[9px]/[1.4] text-[var(--text-weaker)]">
            Raw viewports are canonical; composite and merged tree are regenerable views.
          </p>
        </div>
        <div
          class="inline-flex shrink-0 rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--background-deep)] p-0.5"
          role="group"
          aria-label="Scroll surface view"
        >
          <button
            type="button"
            class={cn(
              "min-h-11 rounded-[6px] px-2 text-[9.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]",
              view() === "composite"
                ? "bg-[var(--surface-base)] text-[var(--text-strong)]"
                : "text-[var(--text-weak)]",
            )}
            disabled={!props.surface.composite}
            aria-pressed={view() === "composite"}
            onClick={() => setView("composite")}
          >
            Composite
          </button>
          <button
            type="button"
            class={cn(
              "min-h-11 rounded-[6px] px-2 text-[9.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]",
              view() === "viewports"
                ? "bg-[var(--surface-base)] text-[var(--text-strong)]"
                : "text-[var(--text-weak)]",
            )}
            aria-pressed={view() === "viewports"}
            onClick={() => setView("viewports")}
          >
            Raw
          </button>
        </div>
      </div>

      <Show when={view() === "composite" && props.surface.composite}>
        {(composite) => (
          <div
            class="max-h-[360px] overflow-y-auto overscroll-contain rounded-[9px] border border-[var(--border-weak-base)] bg-[var(--background-deep)]"
            data-scroll-surface-composite
          >
            <div class="relative w-full">
              <img
                src={props.evidenceUrl(composite().uri, "image/png")}
                alt="Stitched full scrollable screen"
                class="block h-auto w-full"
              />
              <For each={props.surface.viewports.slice(1)}>
                {(viewport) => (
                  <span
                    class="pointer-events-none absolute right-0 left-0 border-t border-dashed border-[var(--border-focus)]"
                    style={{ top: `${(viewport.offsetY / composite().height) * 100}%` }}
                    aria-hidden="true"
                    data-scroll-surface-boundary={viewport.index}
                  >
                    <span class="absolute top-0 right-1 -translate-y-full rounded-t-[4px] bg-[var(--text-interactive-base)] px-1 py-0.5 font-mono text-[8px] text-[var(--background-base)] tabular-nums">
                      {viewport.index + 1}
                    </span>
                  </span>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>

      <Show when={view() === "viewports"}>
        <ol class="m-0 grid list-none gap-2 p-0" data-scroll-surface-viewports>
          <For each={props.surface.viewports}>
            {(viewport) => (
              <li class="grid gap-1.5 rounded-[9px] border border-[var(--border-weak-base)] bg-[var(--background-deep)] p-1.5">
                <div class="flex items-center justify-between gap-2 px-0.5 text-[9px] text-[var(--text-weak)]">
                  <span class="font-medium text-[var(--text-base)]">
                    Viewport {viewport.index + 1}
                  </span>
                  <span class="font-mono tabular-nums">y {viewport.offsetY}</span>
                </div>
                <img
                  src={props.evidenceUrl(viewport.screenshot.uri, "image/png")}
                  alt={`Raw viewport ${viewport.index + 1}`}
                  class="block h-auto w-full rounded-[6px]"
                />
                <a
                  href={props.evidenceUrl(viewport.accessibilityTree.uri, "application/json")}
                  target="_blank"
                  rel="noreferrer"
                  class="flex min-h-11 items-center rounded-[6px] px-2 text-[9.5px] font-medium text-[var(--text-interactive-base)] underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                >
                  View accessibility tree
                </a>
              </li>
            )}
          </For>
        </ol>
      </Show>

      <div class="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-[var(--text-weak)]">
        <a
          href={props.evidenceUrl(props.surface.mergedTree.uri, "application/json")}
          target="_blank"
          rel="noreferrer"
          class="min-h-11 content-center font-medium text-[var(--text-interactive-base)] underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
        >
          Merged tree ({props.surface.mergedTree.nodeCount})
        </a>
        <a
          href={props.evidenceUrl(props.surface.manifest.uri, "application/json")}
          target="_blank"
          rel="noreferrer"
          class="min-h-11 content-center font-medium text-[var(--text-interactive-base)] underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
        >
          Regeneration manifest
        </a>
      </div>
      <Show when={props.onRegenerate}>
        <button
          type="button"
          class="min-h-11 rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-3 text-[9.5px] font-medium text-[var(--text-strong)] outline-none transition-[background-color,border-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-[0.99] disabled:cursor-not-allowed disabled:text-[var(--text-weaker)] motion-reduce:active:scale-100"
          disabled={props.regenerating}
          aria-busy={props.regenerating}
          onClick={props.onRegenerate}
        >
          {props.regenerating ? "Rebuilding derived views…" : "Rebuild from raw viewports"}
        </button>
      </Show>
    </section>
  );
}
