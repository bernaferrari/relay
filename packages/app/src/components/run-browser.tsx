import { For, Show, createMemo, createSignal } from "solid-js";
import { useServer, type JobInfo } from "../context/server";
import { cn } from "../lib/cn";
import { fmtAgo, fmtDur, titleize } from "../lib/job";
import { Icon } from "./icon";
import { runOutcomeChip } from "./status-chip";

export function RunBrowser(props: {
  rows: JobInfo[];
  selectedId: string | null;
  onSelect: (job: JobInfo) => void;
}) {
  const server = useServer();
  const [query, setQuery] = createSignal("");
  const filteredRows = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    if (!needle) return props.rows;
    return props.rows.filter((job) => {
      const recipe = server.recipes().find((item) => item.id === job.action);
      const status = runOutcomeChip(job);
      return [job.title, recipe?.title, titleize(job.action), status.label]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(needle));
    });
  });
  return (
    <aside
      class="flex min-h-0 flex-col border-r border-[var(--border-weak-base)] bg-[var(--background-base)] max-[1180px]:hidden"
      aria-label="Run browser"
    >
      <header class="flex min-h-14 shrink-0 items-center justify-between border-b border-[var(--border-weak-base)] px-3.5">
        <div>
          <strong class="block text-body font-semibold text-[var(--text-strong)]">Runs</strong>
          <small class="text-micro text-[var(--text-weak)]">
            {query().trim()
              ? `${filteredRows().length} of ${props.rows.length}`
              : props.rows.length}{" "}
            {props.rows.length === 1 ? "run" : "runs"}
          </small>
        </div>
        <span class="grid size-7 place-items-center rounded-lg bg-[var(--surface-base)] text-[var(--text-weak)]">
          <Icon name="wave" size={14} />
        </span>
      </header>
      <label class="relative mx-2 mt-2 block shrink-0">
        <span class="pointer-events-none absolute inset-y-0 left-2.5 grid place-items-center text-[var(--text-weak)]">
          <Icon name="search" size={13} />
        </span>
        <span class="sr-only">Search runs</span>
        <input
          class="h-8 w-full rounded-lg border border-transparent bg-[var(--surface-base)] pr-2.5 pl-8 text-body text-[var(--text-strong)] outline-none transition-[background-color,border-color] duration-150 placeholder:text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] focus:border-[var(--border-strong-base)] focus:bg-[var(--background-base)]"
          value={query()}
          placeholder="Search runs"
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <nav class="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Saved runs">
        <For each={filteredRows()}>
          {(job) => {
            const recipe = () => server.recipes().find((item) => item.id === job.action);
            const status = () => runOutcomeChip(job);
            return (
              <button
                type="button"
                class={cn(
                  "mb-0.5 grid min-h-[58px] w-full grid-cols-[8px_minmax(0,1fr)] items-center gap-2 rounded-xl px-2.5 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-border-strong-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background-base",
                  props.selectedId === job.id
                    ? "bg-[var(--surface-base-hover)]"
                    : "hover:bg-[var(--surface-base)]",
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
                        : "bg-[var(--text-interactive-base)]",
                  )}
                  aria-hidden="true"
                />
                <span class="min-w-0">
                  <strong class="block truncate text-caption font-medium text-[var(--text-strong)]">
                    {job.title ?? recipe()?.title ?? titleize(job.action)}
                  </strong>
                  <small class="mt-1 flex items-center gap-1.5 text-micro text-[var(--text-weak)]">
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
        <Show when={filteredRows().length === 0}>
          <div class="px-3 py-8 text-center">
            <p class="m-0 text-caption font-medium text-[var(--text-base)]">No matching runs</p>
            <button
              type="button"
              class="mt-2 min-h-8 rounded-md px-2.5 text-caption font-medium text-[var(--text-accent-base)] outline-none hover:bg-[var(--surface-base)] focus-visible:ring-2 focus-visible:ring-border-strong-focus"
              onClick={() => setQuery("")}
            >
              Clear search
            </button>
          </div>
        </Show>
      </nav>
    </aside>
  );
}
