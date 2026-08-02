import { For, Show } from "solid-js";
import type { RecipeInfo } from "../context/server";
import { Icon } from "./icon";

export function AppMapHistoryPanel(props: {
  loading: boolean;
  entries: RecipeInfo[];
  onClose: () => void;
  onRestore: (updatedAt: number) => void;
}) {
  return (
    <aside class="absolute top-14 right-4 z-30 w-[min(320px,calc(100%-32px))] overflow-hidden rounded-[12px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)] shadow-[0_16px_40px_rgb(0_0_0/28%)]">
      <header class="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--v2-border-border-muted)] px-3 py-2.5">
        <div>
          <strong class="block text-[12px] text-[var(--text-strong)]">Journey history</strong>
          <span class="text-[10.5px]/[1.4] text-[var(--text-weak)]">
            Restore any prior save. Your current state stays recoverable.
          </span>
        </div>
        <button
          type="button"
          class="grid size-10 shrink-0 place-items-center rounded-[8px] text-[var(--text-base)] transition-colors duration-100 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
          aria-label="Close history"
          onClick={props.onClose}
        >
          <Icon name="x" size={13} />
        </button>
      </header>
      <div class="max-h-60 overflow-auto p-1.5">
        <Show
          when={!props.loading}
          fallback={
            <p class="m-0 px-2 py-3 text-[11px] text-[var(--text-weak)]">Loading saved versions…</p>
          }
        >
          <Show
            when={props.entries.length}
            fallback={
              <p class="m-0 px-2 py-3 text-[11px] text-[var(--text-weak)]">
                Your first meaningful edit will appear here.
              </p>
            }
          >
            <For each={props.entries}>
              {(entry) => (
                <button
                  type="button"
                  class="flex min-h-11 w-full items-center justify-between gap-3 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-[var(--v2-background-bg-layer-02)]"
                  onClick={() => props.onRestore(entry.updatedAt)}
                >
                  <span class="min-w-0">
                    <strong class="block truncate text-[11.5px] font-medium text-[var(--text-strong)]">
                      {entry.title}
                    </strong>
                    <span class="text-[10.5px] text-[var(--text-weak)]">
                      {entry.steps.length} {entry.steps.length === 1 ? "action" : "actions"}
                    </span>
                  </span>
                  <span class="shrink-0 text-[10.5px] text-[var(--text-weak)]">
                    {new Date(entry.updatedAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </aside>
  );
}
