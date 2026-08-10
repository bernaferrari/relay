import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Button } from "@relay/ui/button";
import { useServer, type JobInfo, type PersistedRun } from "../context/server";
import type { RunMatrixReview as RunMatrixReviewModel } from "../lib/run-matrix-review";
import { Icon } from "./icon";
import {
  filterRunMatrixRows,
  matrixReviewPageSize,
  pageRunMatrixRows,
} from "../lib/run-matrix-review";
import { RunMatrixCaptureCard } from "./run-matrix-capture-card";

export function RunMatrixReview(props: {
  review: RunMatrixReviewModel;
  onOpen: (job: JobInfo, frameIndex: number) => void;
  onRetryProblems: () => void;
  onExport: () => void;
  exporting?: boolean;
}) {
  const server = useServer();
  const [query, setQuery] = createSignal("");
  const [problemsOnly, setProblemsOnly] = createSignal(false);
  const [selectedCaptureIndex, setSelectedCaptureIndex] = createSignal(0);
  const [visibleCount, setVisibleCount] = createSignal(matrixReviewPageSize);
  const visibleRows = createMemo(() =>
    filterRunMatrixRows(props.review, { query: query(), problemsOnly: problemsOnly() }),
  );
  const pagedRows = createMemo(() => pageRunMatrixRows(visibleRows(), visibleCount()));
  const total = () => props.review.rows.length;
  const progress = () => (total() ? (props.review.complete / total()) * 100 : 0);
  const selectedCaptureLabel = () =>
    props.review.captureLabels[selectedCaptureIndex()] ?? "Screenshot";
  createEffect(() => {
    if (selectedCaptureIndex() >= props.review.captureLabels.length) {
      setSelectedCaptureIndex(0);
    }
  });
  createEffect(() => {
    query();
    problemsOnly();
    selectedCaptureIndex();
    setVisibleCount(matrixReviewPageSize);
  });
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
              Review one screen across modifier values. Every screenshot remains in the export.
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
      <Show when={props.review.captureLabels.length > 0}>
        <div class="grid shrink-0 gap-2.5 border-b border-[var(--border-weak-base)] px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label class="grid min-w-0 gap-1">
            <span class="text-[10px] font-medium text-[var(--text-weak)]">Screen</span>
            <select
              aria-label="Screen to review"
              class="h-10 w-full rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 text-[12px] text-[var(--text-strong)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
              value={selectedCaptureIndex()}
              onChange={(event) => setSelectedCaptureIndex(Number(event.currentTarget.value))}
            >
              <For each={props.review.captureLabels}>
                {(label, index) => <option value={index()}>{label}</option>}
              </For>
            </select>
          </label>
          <span class="self-end pb-2 text-[10.5px] tabular-nums text-[var(--text-weak)]">
            {selectedCaptureIndex() + 1} of {props.review.captureLabels.length} screens
          </span>
          <label class="flex h-9 min-w-0 items-center gap-2 rounded-[8px] bg-[var(--surface-base)] px-2.5 shadow-[inset_0_0_0_1px_var(--border-weak-base)] focus-within:shadow-[inset_0_0_0_1px_var(--border-strong-base)]">
            <Icon name="search" size={12} class="text-[var(--text-weak)]" />
            <span class="sr-only">Filter modifier values</span>
            <input
              type="search"
              class="min-w-0 flex-1 border-0 bg-transparent text-[11px] text-[var(--text-strong)] outline-none placeholder:text-[var(--text-weak)]"
              value={query()}
              placeholder="Filter modifier values"
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <div class="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              aria-pressed={problemsOnly()}
              onClick={() => setProblemsOnly((value) => !value)}
            >
              Problems only
            </Button>
            <span class="text-[10px] tabular-nums text-[var(--text-weak)]">
              {visibleRows().length} values
            </span>
          </div>
        </div>
      </Show>
      <div class="min-h-0 flex-1 overflow-auto overscroll-contain p-4">
        <div class="mb-3 flex items-baseline justify-between gap-3">
          <h3 class="m-0 truncate text-[13px] font-semibold text-[var(--text-strong)]">
            {selectedCaptureLabel()}
          </h3>
          <span class="shrink-0 text-[10px] text-[var(--text-weak)]">
            Showing {pagedRows().length} of {visibleRows().length}
          </span>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          <For each={pagedRows()}>
            {(row) => {
              const capture = () => row.captures[selectedCaptureIndex()];
              return (
                <Show when={capture()}>
                  {(selectedCapture) => (
                    <RunMatrixCaptureCard
                      job={row.job}
                      world={row.world}
                      values={row.values}
                      capture={selectedCapture()}
                      missingCaptures={row.missingCaptures}
                      source={
                        selectedCapture().frame ? frameSrc(row.job, selectedCapture().frame!) : ""
                      }
                      onOpen={() => props.onOpen(row.job, selectedCapture().index)}
                    />
                  )}
                </Show>
              );
            }}
          </For>
        </div>
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
        <Show when={pagedRows().length < visibleRows().length}>
          <div class="grid place-items-center pt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setVisibleCount((count) => count + matrixReviewPageSize)}
            >
              Show {Math.min(matrixReviewPageSize, visibleRows().length - pagedRows().length)} more
            </Button>
          </div>
        </Show>
      </div>
    </section>
  );
}
