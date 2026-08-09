import { For, Show } from "solid-js";
import type { ActivityEvent } from "@relay/protocol";
import type { RecipeInfo } from "../context/server";
import { Icon } from "./icon";

export function AppMapHistoryPanel(props: {
  loading: boolean;
  entries: RecipeInfo[];
  activity: ActivityEvent[];
  onClose: () => void;
  onRestore: (updatedAt: number) => void;
}) {
  return (
    <aside class="absolute top-14 right-4 z-30 w-[min(320px,calc(100%-32px))] overflow-hidden rounded-[12px] border border-[var(--border-weak-base)] bg-[var(--background-base)] shadow-[0_16px_40px_rgb(0_0_0/28%)]">
      <header class="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--border-weak-base)] px-3 py-2.5">
        <div>
          <strong class="block text-[12px] text-[var(--text-strong)]">Activity</strong>
          <span class="text-[10.5px]/[1.4] text-[var(--text-weak)]">
            Human and agent changes, with recoverable saved versions.
          </span>
        </div>
        <button
          type="button"
          class="grid size-10 shrink-0 place-items-center rounded-[8px] text-[var(--text-base)] transition-colors duration-100 hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)]"
          aria-label="Close history"
          onClick={props.onClose}
        >
          <Icon name="x" size={13} />
        </button>
      </header>
      <div class="max-h-[min(520px,calc(100vh-120px))] overflow-auto p-1.5">
        <Show when={props.activity.length > 0}>
          <section aria-labelledby="map-activity-heading">
            <h3
              id="map-activity-heading"
              class="m-0 px-2 pt-2 pb-1 text-[10px] font-medium tracking-[0.08em] text-[var(--text-weak)] uppercase"
            >
              Recent changes
            </h3>
            <For each={props.activity.slice(0, 40)}>
              {(event) => (
                <div class="flex min-h-11 items-start gap-2.5 rounded-[8px] px-2 py-2">
                  <span
                    class="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--text-weak)]"
                    classList={{
                      "bg-[var(--text-interactive-base)]": event.actorKind === "agent",
                      "bg-[var(--icon-success-base)]": event.actorKind === "human",
                    }}
                    aria-hidden="true"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block text-[11.5px]/[1.35] text-[var(--text-strong)]">
                      {event.summary}
                    </span>
                    <span class="mt-0.5 block text-[10.5px] text-[var(--text-weak)]">
                      {event.actorKind === "agent"
                        ? "Agent"
                        : event.actorKind === "system"
                          ? "Relay"
                          : "You"}
                      {" · "}
                      {new Date(event.at).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </span>
                </div>
              )}
            </For>
          </section>
          <div class="mx-2 my-1 border-t border-[var(--border-weak-base)]" />
        </Show>
        <h3 class="m-0 px-2 pt-2 pb-1 text-[10px] font-medium tracking-[0.08em] text-[var(--text-weak)] uppercase">
          Saved versions
        </h3>
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
                Versions appear after you keep a path or edit the map. Restore any earlier point
                from here.
              </p>
            }
          >
            <For each={props.entries}>
              {(entry) => (
                <button
                  type="button"
                  class="flex min-h-11 w-full items-center justify-between gap-3 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-[var(--surface-base-hover)]"
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
