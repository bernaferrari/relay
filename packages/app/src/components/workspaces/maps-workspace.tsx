import { Show, createEffect, createSignal } from "solid-js";
import { useServer } from "../../context/server";
import { cn } from "../../lib/cn";
import { shellViewTab, shellViewTabActive, shellViewTabs } from "../../lib/shell-layout";
import { AtlasWorkspace } from "./atlas-workspace";
import { DiscoveryWorkspace } from "./discovery-workspace";

/**
 * Atlas explains product coverage and discovered navigation. Reusable test
 * composition deliberately lives in the first-class Suites area; keeping it
 * here would give one concept two names and two incompatible editors.
 */
export function MapsWorkspace(props: { onOpenRecipe: (id: string) => void }) {
  const server = useServer();
  const [mode, setMode] = createSignal<"product" | "coverage">("product");
  const [atlas, setAtlas] = createSignal<import("../../context/server").TestAtlas | null>(null);

  createEffect(() => {
    server.recipes();
    void server
      .loadAtlas()
      .then(setAtlas)
      .catch(() => setAtlas(null));
  });
  createEffect(() => {
    if (mode() === "product") void server.refreshDiscoverySessions();
  });

  return (
    <section class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header class="flex min-h-14 shrink-0 items-center border-b border-[var(--relay-line)] px-4">
        <div class={shellViewTabs} role="tablist" aria-label="Atlas view">
          {(
            [
              ["product", "Product"],
              ["coverage", "Coverage"],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={mode() === id}
              class={cn(shellViewTab, mode() === id && shellViewTabActive)}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <Show
        when={mode() === "product"}
        fallback={
          <div class="min-h-0 flex-1">
            <AtlasWorkspace atlas={atlas()} onOpen={props.onOpenRecipe} />
          </div>
        }
      >
        <div class="min-h-0 flex-1">
          <DiscoveryWorkspace onOpenRecipe={props.onOpenRecipe} />
        </div>
      </Show>
    </section>
  );
}
