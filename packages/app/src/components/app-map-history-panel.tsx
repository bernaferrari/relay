import { For, Show, createMemo } from "solid-js";
import type { ActivityEvent } from "@relay/protocol";
import { activitySummary, collapseActivity } from "../lib/app-map-activity";
import type { IconName } from "./icon";
import { Icon } from "./icon";

function eventIcon(event: ActivityEvent): IconName {
  if (event.actorKind === "agent" || event.eventType.startsWith("proposal.")) return "sparkle";
  if (event.eventType.startsWith("screen.") || event.eventType === "recording.committed") {
    return "smartphone";
  }
  if (event.eventType.startsWith("connection.")) return "arrow-right";
  if (event.eventType === "run.finished") return "play";
  if (event.eventType.startsWith("group.")) return "group";
  return "edit";
}
function actorLabel(event: ActivityEvent): string {
  if (event.actorKind === "agent") return "Agent";
  if (event.actorKind === "system") return "Relay";
  return "You";
}

function timeLabel(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return time;
  }
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

/** Canonical App Map activity. Recipe history is deliberately not an authoring surface. */
export function AppMapHistoryPanel(props: {
  activity: ActivityEvent[];
  onClose: () => void;
}) {
  const activityRows = createMemo(() => collapseActivity(props.activity).slice(0, 40));

  return (
    <aside
      class="ui-panel-in absolute top-14 right-4 z-30 grid h-[min(480px,calc(100%-112px))] w-[min(328px,calc(100%-32px))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--border-strong-base)_48%,transparent)] bg-[color-mix(in_srgb,var(--background-base)_98%,transparent)] shadow-[var(--map-elevation-panel)] backdrop-blur-[14px]"
      aria-label="Map activity"
      data-app-map-native-scroll
      onWheel={(event) => event.stopPropagation()}
    >
      <header class="flex min-h-[52px] items-center justify-between gap-3 border-b border-[var(--border-weak-base)] px-3">
        <div class="min-w-0">
          <strong class="block text-body font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
            Activity
          </strong>
          <span class="mt-0.5 block truncate text-micro text-[var(--text-weak)]">
            Canonical map changes
          </span>
        </div>
        <button
          type="button"
          class="relative grid size-9 shrink-0 place-items-center rounded-lg text-[var(--text-weak)] before:absolute before:-inset-1 transition-[background-color,color,transform] duration-hover hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-strong)]"
          aria-label="Close activity"
          onClick={props.onClose}
        >
          <Icon name="x" size={13} />
        </button>
      </header>

      <div
        tabIndex={0}
        class="app-map-panel-scroll min-h-0 touch-pan-y overflow-y-auto overscroll-contain p-2 outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--border-strong-base)]"
      >
        <Show
          when={activityRows().length}
          fallback={
            <div class="grid min-h-40 place-items-center px-6 text-center">
              <div>
                <strong class="text-caption font-medium text-[var(--text-strong)]">
                  No changes yet
                </strong>
                <p class="m-0 mt-1 text-micro/[1.45] text-[var(--text-weak)]">
                  Screen captures and map edits will appear here.
                </p>
              </div>
            </div>
          }
        >
          <For each={activityRows()}>
            {(row) => (
              <div class="grid min-h-12 grid-cols-[28px_minmax(0,1fr)] items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-base-hover)]">
                <span class="grid size-7 place-items-center rounded-lg bg-[var(--surface-base-hover)] text-[var(--text-weak)]">
                  <Icon name={eventIcon(row.event)} size={12} />
                </span>
                <span class="min-w-0">
                  <span class="flex min-w-0 items-baseline gap-1.5">
                    <span class="min-w-0 truncate text-caption font-medium text-[var(--text-strong)]">
                      {activitySummary(row.event)}
                    </span>
                    <Show when={row.count > 1}>
                      <span class="shrink-0 text-micro tabular-nums text-[var(--text-weak)]">
                        ×{row.count}
                      </span>
                    </Show>
                  </span>
                  <span class="mt-0.5 block text-micro tabular-nums text-[var(--text-weak)]">
                    {actorLabel(row.event)} · {timeLabel(row.event.at)}
                  </span>
                </span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </aside>
  );
}
