import { For, Show, type Accessor, type Setter } from "solid-js";
import type { JobInfo } from "../context/server";
import { EmptyState } from "./empty-state";
import { RunRow } from "./run-list-surfaces";
import { cn } from "../lib/cn";
import {
  RUN_FILTER_TABS,
  summarizeRunBatch,
  type RunFilterId,
} from "../lib/runs-workspace-helpers";

export function RunsHistoryList(props: {
  rows: Accessor<JobInfo[]>;
  visibleRows: Accessor<JobInfo[]>;
  selectedId: Accessor<string | null>;
  runFilter: Accessor<RunFilterId>;
  setRunFilter: Setter<RunFilterId>;
  historyExpanded: Accessor<boolean>;
  setHistoryExpanded: Setter<boolean>;
  onOpenRun: (job: JobInfo) => void;
  onOpenTests: () => void;
}) {
  return (
    <div class={cn("w-full max-w-none", props.rows().length === 0 && "max-w-[680px] rounded-3xl")}>
      <Show when={props.rows().length > 0}>
        <div class="mb-2.5 flex min-h-10 items-center justify-between gap-3">
          <div
            class="flex items-center gap-1 rounded-xl border border-border-weak-base bg-background-stronger p-1"
            role="tablist"
            aria-label="Filter runs"
          >
            {RUN_FILTER_TABS.map(([id, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={props.runFilter() === id}
                class={cn(
                  "min-h-7 rounded-md px-3 text-caption font-medium text-text-weaker transition-[background-color,color,transform] duration-hover active:scale-[0.97]",
                  props.runFilter() === id
                    ? "bg-surface-base-active text-text-strong"
                    : "hover:bg-surface-base-hover hover:text-text-base",
                )}
                onClick={() => props.setRunFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div class="flex items-center gap-2">
            <Show
              when={props.runFilter() === "all" && props.rows().length > props.visibleRows().length}
            >
              <button
                type="button"
                class="rounded-md px-2 py-1 text-micro font-medium text-text-weak transition-colors hover:bg-surface-base-hover hover:text-text-base"
                onClick={() => props.setHistoryExpanded((expanded) => !expanded)}
              >
                {props.historyExpanded() ? "Latest only" : `All ${props.rows().length}`}
              </button>
            </Show>
            <span class="font-mono text-micro tabular-nums text-text-weaker">
              {props.visibleRows().length}{" "}
              {props.historyExpanded()
                ? "runs"
                : props.visibleRows().length === 1
                  ? "path run"
                  : "path runs"}
            </span>
          </div>
        </div>
      </Show>
      <For
        each={props.visibleRows()}
        fallback={
          <Show
            when={props.rows().length === 0}
            fallback={
              <EmptyState
                size="sm"
                icon="search"
                title={`No ${props.runFilter()} runs`}
                secondaryLabel="Show all runs"
                onSecondary={() => props.setRunFilter("all")}
                class="py-14"
              />
            }
          >
            <EmptyState
              size="lg"
              icon="wave"
              title="No runs yet"
              description="Run a Test or Repeat it across values. Checkpoint evidence stays attached to the Run that created it."
              actionLabel="Open maps"
              onAction={props.onOpenTests}
              class="py-14"
            />
          </Show>
        }
      >
        {(job) => (
          <RunRow
            job={job}
            selected={props.selectedId() === job.id}
            batch={summarizeRunBatch(job, props.rows())}
            onOpen={() => props.onOpenRun(job)}
          />
        )}
      </For>
    </div>
  );
}
