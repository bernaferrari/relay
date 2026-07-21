import { Show, createEffect, createMemo, createSignal } from "solid-js";
import { useServer } from "../../context/server";
import { cn } from "../../lib/cn";
import { nextRovingIndex } from "../../lib/roving-focus";
import { tabUnderline, tabUnderlineActive } from "../../lib/ui";
import { AtlasWorkspace } from "./atlas-workspace";
import { DiscoveryWorkspace } from "./discovery-workspace";
import { AtlasJourneys, deriveJourneys } from "./atlas-journeys";

/**
 * Atlas explains product coverage and discovered navigation. Reusable test
 * composition deliberately lives in the first-class Suites area; keeping it
 * here would give one concept two names and two incompatible editors.
 */
export function MapsWorkspace(props: {
  onOpenRecipe: (id: string) => void;
  onOpenTests?: () => void;
}) {
  const server = useServer();
  const [mode, setMode] = createSignal<"product" | "coverage" | "journeys">("product");
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

  // Journeys is the more useful landing tab once a run has produced one —
  // computed lazily since persisted runs load asynchronously after mount.
  const hasJourneys = createMemo(() => deriveJourneys(server.persistedRuns()).length > 0);
  let defaultTabChosen = false;
  createEffect(() => {
    if (defaultTabChosen) return;
    const runs = server.persistedRuns();
    if (runs.length === 0) return;
    defaultTabChosen = true;
    if (hasJourneys()) setMode("journeys");
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
      <header class="flex min-h-12 shrink-0 items-end border-b border-[var(--v2-border-border-muted)] px-3">
        <div class="flex h-full items-end gap-1" role="tablist" aria-label="Atlas view">
          {(
            [
              ["product", "Product"],
              ["coverage", "Coverage"],
              ["journeys", "Journeys"],
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
      <Show when={mode() === "product"}>
        <div class="min-h-0 flex-1">
          <DiscoveryWorkspace onOpenRecipe={props.onOpenRecipe} />
        </div>
      </Show>
      <Show when={mode() === "coverage"}>
        <div class="min-h-0 flex-1">
          <AtlasWorkspace atlas={atlas()} onOpen={props.onOpenRecipe} />
        </div>
      </Show>
      <Show when={mode() === "journeys"}>
        <div class="min-h-0 flex-1">
          <AtlasJourneys onOpenTests={props.onOpenTests} />
        </div>
      </Show>
    </section>
  );
}
