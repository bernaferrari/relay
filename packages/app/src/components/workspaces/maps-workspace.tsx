import { Show, createEffect, createSignal } from "solid-js";
import { useServer } from "../../context/server";
import { cn } from "../../lib/cn";
import { nextRovingIndex } from "../../lib/roving-focus";
import { tabUnderline, tabUnderlineActive } from "../../lib/ui";
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

  const onTabKeyDown = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const currentTarget = event.currentTarget as HTMLButtonElement;
    const tabs = [
      ...(currentTarget
        .closest<HTMLElement>("[role='tablist']")
        ?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? []),
    ];
    const next = nextRovingIndex(event.key, tabs.indexOf(currentTarget), tabs.length, "horizontal");
    if (next === null) return;
    event.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  };

  return (
    <section class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header class="flex min-h-12 shrink-0 items-end border-b border-[var(--relay-line)] px-3">
        <div class="flex h-full items-end gap-1" role="tablist" aria-label="Atlas view">
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
              tabindex={mode() === id ? 0 : -1}
              class={cn(tabUnderline, mode() === id && tabUnderlineActive)}
              onKeyDown={onTabKeyDown}
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
