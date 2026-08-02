import { For } from "solid-js";
import { useServer, type JobInfo } from "../context/server";
import { cn } from "../lib/cn";
import { fmtAgo, fmtDur, titleize } from "../lib/job";
import { Icon } from "./icon";
import { jobStatusChip } from "./status-chip";

export function RunBrowser(props: {
  rows: JobInfo[];
  selectedId: string | null;
  onSelect: (job: JobInfo) => void;
}) {
  const server = useServer();
  return (
    <aside
      class="flex min-h-0 flex-col border-r border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)] max-[1180px]:hidden"
      aria-label="Run browser"
    >
      <header class="flex min-h-14 shrink-0 items-center justify-between border-b border-[var(--v2-border-border-muted)] px-3.5">
        <div>
          <strong class="block text-[12.5px] font-semibold text-[var(--text-strong)]">Runs</strong>
          <small class="text-[10px] text-[var(--text-weak)]">{props.rows.length} saved</small>
        </div>
        <span class="grid size-7 place-items-center rounded-lg bg-[var(--v2-background-bg-layer-01)] text-[var(--text-weak)]">
          <Icon name="wave" size={14} />
        </span>
      </header>
      <nav class="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Saved runs">
        <For each={props.rows}>
          {(job) => {
            const recipe = () => server.recipes().find((item) => item.id === job.action);
            const status = () => jobStatusChip(job.status);
            return (
              <button
                type="button"
                class={cn(
                  "mb-0.5 grid min-h-[58px] w-full grid-cols-[8px_minmax(0,1fr)] items-center gap-2 rounded-[9px] px-2.5 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-border-strong-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background-base",
                  props.selectedId === job.id
                    ? "bg-[var(--v2-background-bg-layer-02)]"
                    : "hover:bg-[var(--v2-background-bg-layer-01)]",
                )}
                aria-current={props.selectedId === job.id ? "page" : undefined}
                onClick={() => props.onSelect(job)}
              >
                <span
                  class={cn(
                    "size-1.5 rounded-full",
                    status().tone === "pass"
                      ? "bg-[var(--icon-success-base)]"
                      : status().tone === "fail"
                        ? "bg-[var(--icon-critical-base)]"
                        : "bg-[var(--v2-background-bg-accent)]",
                  )}
                  aria-hidden="true"
                />
                <span class="min-w-0">
                  <strong class="block truncate text-[11.5px] font-medium text-[var(--text-strong)]">
                    {job.title ?? recipe()?.title ?? titleize(job.action)}
                  </strong>
                  <small class="mt-1 flex items-center gap-1.5 text-[9.5px] text-[var(--text-weak)]">
                    <span>{status().label}</span>
                    <span aria-hidden="true">·</span>
                    <span class="font-mono tabular-nums">{fmtDur(job, server.clock()) || "—"}</span>
                    <span aria-hidden="true">·</span>
                    <span class="truncate">
                      {fmtAgo(job.finishedAt ?? job.startedAt ?? job.queuedAt, server.clock()) ||
                        "now"}
                    </span>
                  </small>
                </span>
              </button>
            );
          }}
        </For>
      </nav>
    </aside>
  );
}
