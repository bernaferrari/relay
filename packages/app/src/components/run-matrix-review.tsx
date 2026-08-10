import { For, Show, createMemo, createSignal } from "solid-js";
import { Button } from "@relay/ui/button";
import { useServer, type JobInfo, type PersistedRun } from "../context/server";
import type { RunMatrixReview as RunMatrixReviewModel } from "../lib/run-matrix-review";
import { cn } from "../lib/cn";
import { runOutcomeChip } from "./status-chip";
import { Icon } from "./icon";
import { filterRunMatrixRows } from "../lib/run-matrix-review";
import { RunMatrixCaptureCell } from "./run-matrix-capture-cell";

export function RunMatrixReview(props: {
  review: RunMatrixReviewModel;
  selectedId: string;
  onOpen: (job: JobInfo, frameIndex: number) => void;
  onRetryProblems: () => void;
  onExport: () => void;
  exporting?: boolean;
}) {
  const server = useServer();
  const [query, setQuery] = createSignal("");
  const [problemsOnly, setProblemsOnly] = createSignal(false);
  const visibleRows = createMemo(() =>
    filterRunMatrixRows(props.review, { query: query(), problemsOnly: problemsOnly() }),
  );
  const total = () => props.review.rows.length;
  const progress = () => (total() ? (props.review.complete / total()) * 100 : 0);
  const frameSrc = (job: JobInfo, frame: NonNullable<JobInfo["frames"]>[number]) => {
    if (frame.base64) return `data:${frame.mime || "image/png"};base64,${frame.base64}`;
    if (job.persisted || job.runDir) {
      return server.frameUrlForPersisted(job as unknown as PersistedRun, frame);
    }
    return "";
  };

  return (
    <section
      class="flex min-h-0 flex-1 flex-col bg-[var(--background-base)]"
      aria-label="Run matrix results"
    >
      <header class="grid shrink-0 gap-2 border-b border-[var(--border-weak-base)] px-5 py-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h2 class="m-0 text-[16px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
              Matrix results
            </h2>
            <p class="m-0 mt-0.5 text-[11px] text-[var(--text-weak)]">
              Modifier values are rows. Captured screens are columns.
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Show when={props.review.batchId}>
              <Button
                variant="secondary"
                size="sm"
                disabled={props.exporting || props.review.active > 0}
                aria-busy={props.exporting}
                data-tip={props.review.active > 0 ? "Export after every run finishes" : undefined}
                onClick={props.onExport}
              >
                <Icon name="download" size={12} />
                {props.exporting ? "Exporting…" : "Export screenshots"}
              </Button>
            </Show>
            <Show when={props.review.problemRuns > 0}>
              <Button variant="secondary" size="sm" onClick={props.onRetryProblems}>
                <Icon name="refresh" size={12} /> Retry {props.review.problemRuns}
              </Button>
            </Show>
          </div>
        </div>
        <div
          class="flex items-center gap-3 text-[10.5px] tabular-nums text-[var(--text-weak)]"
          aria-live="polite"
        >
          <span>
            {props.review.complete} of {total()} runs complete
          </span>
          <span class="text-[var(--text-success-base,var(--text-weak))]">
            {props.review.passed} passed
          </span>
          <Show when={props.review.failed}>
            <span class="text-[var(--text-critical-base,var(--icon-critical-base))]">
              {props.review.failed} failed
            </span>
          </Show>
          <Show when={props.review.missingCaptures}>
            <span class="text-[var(--icon-warning-base)]">
              {props.review.missingCaptures} missing screenshots
            </span>
          </Show>
          <Show when={props.review.active}>
            <span>{props.review.active} active</span>
          </Show>
        </div>
        <div class="h-1 overflow-hidden rounded-full bg-[var(--surface-base)]" aria-hidden="true">
          <div
            class="h-full origin-left rounded-full bg-[var(--text-interactive-base)] transition-transform duration-150 motion-reduce:transition-none"
            style={{ transform: `scaleX(${progress() / 100})` }}
          />
        </div>
      </header>
      <Show when={props.review.insights.length > 0}>
        <div class="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-[var(--border-weak-base)] px-4 py-2 text-[10.5px]">
          <span class="shrink-0 font-medium text-[var(--text-strong)]">Needs attention</span>
          <For each={props.review.insights}>
            {(insight) => (
              <span class="shrink-0 rounded-[7px] bg-[var(--surface-base)] px-2 py-1 text-[var(--text-base)]">
                <strong class="font-medium">{insight.label}</strong>
                <span class="ml-1.5 text-[var(--text-weak)]">{insight.detail}</span>
              </span>
            )}
          </For>
        </div>
      </Show>
      <div class="flex shrink-0 items-center gap-2 border-b border-[var(--border-weak-base)] px-4 py-2">
        <label class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[8px] bg-[var(--surface-base)] px-2.5 shadow-[inset_0_0_0_1px_var(--border-weak-base)] focus-within:shadow-[inset_0_0_0_1px_var(--border-strong-base)]">
          <Icon name="search" size={12} class="text-[var(--text-weak)]" />
          <span class="sr-only">Filter matrix results</span>
          <input
            type="search"
            class="min-w-0 flex-1 border-0 bg-transparent text-[11px] text-[var(--text-strong)] outline-none placeholder:text-[var(--text-weak)]"
            value={query()}
            placeholder="Filter locale or screen"
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={problemsOnly()}
          onClick={() => setProblemsOnly((value) => !value)}
        >
          Problems only
        </Button>
        <span class="text-[10px] tabular-nums text-[var(--text-weak)]">
          {visibleRows().length} of {props.review.rows.length}
        </span>
      </div>
      <div class="min-h-0 flex-1 overflow-auto overscroll-contain p-4">
        <table class="w-full min-w-[640px] border-separate border-spacing-0 text-left">
          <thead class="sticky top-0 z-[3] bg-[var(--background-base)]">
            <tr>
              <th class="sticky left-0 z-[4] w-48 border-b border-[var(--border-weak-base)] bg-[var(--background-base)] px-3 py-2 text-[10px] font-medium text-[var(--text-weak)]">
                Modifier values
              </th>
              <For each={props.review.captureLabels}>
                {(label) => (
                  <th class="min-w-36 border-b border-[var(--border-weak-base)] px-2 py-2 text-[10px] font-medium text-[var(--text-weak)]">
                    <span class="block max-w-40 truncate" title={label}>
                      {label}
                    </span>
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={visibleRows()}>
              {(row) => {
                const status = () => runOutcomeChip(row.job);
                return (
                  <tr
                    class={cn(
                      "group",
                      row.job.id === props.selectedId &&
                        "bg-[color-mix(in_srgb,var(--product-accent-soft)_40%,transparent)]",
                    )}
                  >
                    <th
                      class={cn(
                        "sticky left-0 z-[2] border-b border-[var(--border-weak-base)] bg-[var(--background-base)] px-3 py-3 align-top group-hover:bg-[var(--surface-base)]",
                        row.job.id === props.selectedId &&
                          "shadow-[inset_2px_0_var(--text-interactive-base)]",
                      )}
                    >
                      <button
                        type="button"
                        class="grid w-full gap-1 text-left focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                        onClick={() => props.onOpen(row.job, 0)}
                      >
                        <strong class="truncate text-[11.5px] font-medium text-[var(--text-strong)]">
                          {row.world}
                        </strong>
                        <span class="flex flex-wrap gap-x-2 gap-y-0.5 text-[9.5px] text-[var(--text-weak)]">
                          <For each={row.values}>
                            {(value) => (
                              <span>
                                {value.name}: {value.value}
                              </span>
                            )}
                          </For>
                        </span>
                        <span
                          class={cn(
                            "text-[9.5px]",
                            status().tone === "fail"
                              ? "text-[var(--icon-critical-base)]"
                              : "text-[var(--text-weak)]",
                          )}
                        >
                          {status().label}
                        </span>
                        <Show when={row.missingCaptures > 0}>
                          <span class="text-[9.5px] text-[var(--icon-warning-base)]">
                            {row.missingCaptures} missing
                          </span>
                        </Show>
                      </button>
                    </th>
                    <For each={row.captures}>
                      {(capture) => (
                        <RunMatrixCaptureCell
                          job={row.job}
                          world={row.world}
                          capture={capture}
                          source={capture.frame ? frameSrc(row.job, capture.frame) : ""}
                          onOpen={() => props.onOpen(row.job, capture.index)}
                        />
                      )}
                    </For>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
        <Show when={props.review.captureLabels.length > 0 && visibleRows().length === 0}>
          <div class="grid min-h-48 place-items-center text-center">
            <div>
              <strong class="block text-[12px] text-[var(--text-strong)]">No matching runs</strong>
              <p class="m-0 mt-1 text-[10.5px] text-[var(--text-weak)]">
                Clear the filter or show all results.
              </p>
            </div>
          </div>
        </Show>
        <Show when={props.review.captureLabels.length === 0}>
          <div class="grid min-h-48 place-items-center rounded-xl border border-dashed border-[var(--border-weak-base)] text-center">
            <div>
              <strong class="block text-[12px] text-[var(--text-strong)]">
                No screenshots requested
              </strong>
              <p class="m-0 mt-1 text-[10.5px] text-[var(--text-weak)]">
                This matrix still records pass, failure, timing, and diagnostic evidence.
              </p>
            </div>
          </div>
        </Show>
      </div>
    </section>
  );
}
