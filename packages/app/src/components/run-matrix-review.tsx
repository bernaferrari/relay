import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
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
import { modalPanel, modalScrim } from "../lib/ui";

export function RunMatrixReview(props: {
  review: RunMatrixReviewModel;
  onOpen: (job: JobInfo, frameIndex: number) => void;
  onRetryProblems: () => void;
  onExport: () => void;
  onClose: () => void;
  exporting?: boolean;
}) {
  const server = useServer();
  const [query, setQuery] = createSignal("");
  const [problemsOnly, setProblemsOnly] = createSignal(false);
  const [selectedCaptureIndex, setSelectedCaptureIndex] = createSignal(0);
  const [visibleCount, setVisibleCount] = createSignal(matrixReviewPageSize);
  const [focusedRunId, setFocusedRunId] = createSignal<string | null>(null);
  const visibleRows = createMemo(() =>
    filterRunMatrixRows(props.review, { query: query(), problemsOnly: problemsOnly() }),
  );
  const pagedRows = createMemo(() => pageRunMatrixRows(visibleRows(), visibleCount()));
  const total = () => props.review.rows.length;
  const progress = () => (total() ? (props.review.complete / total()) * 100 : 0);
  const dimensionsLabel = () =>
    `${props.review.captureLabels.length} ${props.review.captureLabels.length === 1 ? "screen" : "screens"} × ${total()} ${total() === 1 ? "value" : "values"}`;
  const selectedCaptureLabel = () =>
    props.review.captureLabels[selectedCaptureIndex()] ?? "Screenshot";
  const focusedRowIndex = createMemo(() =>
    visibleRows().findIndex((row) => row.job.id === focusedRunId()),
  );
  const focusedRow = createMemo(() => visibleRows()[focusedRowIndex()] ?? null);
  const focusedPosition = createMemo(() => {
    if (focusedRowIndex() < 0) return -1;
    return selectedCaptureIndex() * visibleRows().length + focusedRowIndex();
  });
  const focusedTotal = createMemo(() => props.review.captureLabels.length * visibleRows().length);
  const moveFocusedScreenshot = (offset: -1 | 1) => {
    const rows = visibleRows();
    const nextPosition = focusedPosition() + offset;
    if (rows.length === 0 || nextPosition < 0 || nextPosition >= focusedTotal()) return;
    const nextCaptureIndex = Math.floor(nextPosition / rows.length);
    const nextRow = rows[nextPosition % rows.length];
    if (!nextRow) return;
    setSelectedCaptureIndex(nextCaptureIndex);
    setFocusedRunId(nextRow.job.id);
  };
  createEffect(() => {
    if (selectedCaptureIndex() >= props.review.captureLabels.length) {
      setSelectedCaptureIndex(0);
    }
  });
  createEffect(() => {
    query();
    problemsOnly();
    setVisibleCount(matrixReviewPageSize);
    setFocusedRunId(null);
  });
  createEffect(() => {
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
      <header class="grid shrink-0 gap-2.5 border-b border-[var(--border-weak-base)] px-5 py-3.5">
        <div class="flex items-center justify-between gap-4">
          <div class="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="sm" aria-label="Back to runs" onClick={props.onClose}>
              <Icon name="chevron-left" size={14} />
            </Button>
            <h2 class="m-0 text-[16px] font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
              Matrix results
            </h2>
            <span class="shrink-0 text-[11px] tabular-nums text-[var(--text-weak)]">
              {dimensionsLabel()}
            </span>
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
                {props.exporting ? "Exporting…" : "Export"}
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
          class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] tabular-nums text-[var(--text-weak)]"
          aria-live="polite"
        >
          <span>
            {props.review.complete}/{total()} complete
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
        <Show when={props.review.active > 0}>
          <div
            class="h-0.5 overflow-hidden rounded-full bg-[var(--surface-base)]"
            aria-hidden="true"
          >
            <div
              class="h-full origin-left rounded-full bg-[var(--text-interactive-base)] transition-transform duration-150 motion-reduce:transition-none"
              style={{ transform: `scaleX(${progress() / 100})` }}
            />
          </div>
        </Show>
      </header>
      <Show when={props.review.insights.length > 0}>
        <div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border-weak-base)] px-5 py-2 text-[10.5px]">
          <span class="mr-1 shrink-0 font-medium text-[var(--text-strong)]">Needs attention</span>
          <For each={props.review.insights}>
            {(insight) => (
              <span class="max-w-full rounded-[7px] bg-[var(--surface-base)] px-2 py-1 text-[var(--text-base)]">
                <strong class="font-medium">{insight.label}</strong>
                <span class="ml-1.5 text-[var(--text-weak)]">{insight.detail}</span>
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.review.captureLabels.length > 0}>
        <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-weak-base)] px-5 py-2.5">
          <label class="flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-[360px]">
            <span class="sr-only">Screen</span>
            <select
              aria-label="Screen to review"
              class="h-8 w-full rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 text-[11px] font-medium text-[var(--text-strong)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
              value={selectedCaptureIndex()}
              onChange={(event) => setSelectedCaptureIndex(Number(event.currentTarget.value))}
            >
              <For each={props.review.captureLabels}>
                {(label, index) => <option value={index()}>{label}</option>}
              </For>
            </select>
          </label>
          <span class="shrink-0 text-[10px] tabular-nums text-[var(--text-weak)]">
            {selectedCaptureIndex() + 1}/{props.review.captureLabels.length}
          </span>
          <label class="ml-auto flex h-8 min-w-[190px] flex-1 items-center gap-2 rounded-[8px] bg-[var(--surface-base)] px-2.5 shadow-[inset_0_0_0_1px_var(--border-weak-base)] focus-within:shadow-[inset_0_0_0_1px_var(--border-strong-base)] sm:max-w-[280px]">
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
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={problemsOnly()}
            onClick={() => setProblemsOnly((value) => !value)}
          >
            {problemsOnly() ? "Show all" : "Problems"}
          </Button>
          <span class="shrink-0 text-[10px] tabular-nums text-[var(--text-weak)]">
            {visibleRows().length} values
          </span>
        </div>
      </Show>
      <div class="min-h-0 flex-1 overflow-auto overscroll-contain px-5 py-4">
        <div class="mb-3 flex items-baseline gap-3">
          <h3 class="m-0 truncate text-[13px] font-semibold text-[var(--text-strong)]">
            {selectedCaptureLabel()}
          </h3>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <For each={pagedRows()}>
            {(row) => {
              const capture = () => row.captures[selectedCaptureIndex()];
              const source = () => (capture()?.frame ? frameSrc(row.job, capture()!.frame!) : "");
              return (
                <Show when={capture()}>
                  {(selectedCapture) => (
                    <RunMatrixCaptureCard
                      job={row.job}
                      world={row.world}
                      values={row.values}
                      capture={selectedCapture()}
                      missingCaptures={row.missingCaptures}
                      source={source()}
                      onOpen={() =>
                        source()
                          ? setFocusedRunId(row.job.id)
                          : props.onOpen(row.job, selectedCapture().index)
                      }
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
      <Show when={focusedRow()}>
        {(row) => {
          const capture = () => row().captures[selectedCaptureIndex()];
          const source = () => (capture()?.frame ? frameSrc(row().job, capture()!.frame!) : "");
          return (
            <RunMatrixScreenshotDialog
              title={selectedCaptureLabel()}
              source={source()}
              world={row().world}
              values={row().values}
              position={focusedPosition() + 1}
              total={focusedTotal()}
              onPrevious={focusedPosition() > 0 ? () => moveFocusedScreenshot(-1) : undefined}
              onNext={
                focusedPosition() < focusedTotal() - 1 ? () => moveFocusedScreenshot(1) : undefined
              }
              onOpenRun={() => {
                const selectedCapture = capture();
                if (selectedCapture) props.onOpen(row().job, selectedCapture.index);
                setFocusedRunId(null);
              }}
              onClose={() => setFocusedRunId(null)}
            />
          );
        }}
      </Show>
    </section>
  );
}

function RunMatrixScreenshotDialog(props: {
  title: string;
  source: string;
  world: string;
  values: Array<{ name: string; value: string }>;
  position: number;
  total: number;
  onPrevious?: () => void;
  onNext?: () => void;
  onOpenRun: () => void;
  onClose: () => void;
}) {
  let dialog: HTMLDivElement | undefined;
  onMount(() => dialog?.focus());
  const valueLabel = () =>
    props.values.length
      ? props.values.map((value) => `${value.name}: ${value.value}`).join(" · ")
      : props.world;

  return (
    <div
      class={`${modalScrim} z-[140] flex items-center justify-center p-4`}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
        if (event.key === "ArrowLeft" && props.onPrevious) {
          event.preventDefault();
          props.onPrevious();
        }
        if (event.key === "ArrowRight" && props.onNext) {
          event.preventDefault();
          props.onNext();
        }
      }}
    >
      <div
        ref={(element) => {
          dialog = element;
        }}
        class={`${modalPanel} grid h-[min(92vh,980px)] w-[min(1180px,calc(100vw-32px))] grid-rows-[auto_minmax(0,1fr)_auto]`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="matrix-screenshot-title"
        tabIndex={-1}
      >
        <header class="flex items-start justify-between gap-4 border-b border-[var(--border-weak-base)] px-4 py-3">
          <div class="min-w-0">
            <h2
              id="matrix-screenshot-title"
              class="truncate text-[14px] font-semibold text-[var(--text-strong)]"
            >
              {props.title}
            </h2>
            <p class="mt-0.5 truncate text-[11px] text-[var(--text-weak)]">
              {valueLabel()} · {props.position} of {props.total}
            </p>
          </div>
          <Button variant="ghost" size="sm" aria-label="Close screenshot" onClick={props.onClose}>
            <Icon name="x" size={14} />
          </Button>
        </header>

        <div class="relative grid min-h-0 place-items-center bg-[var(--background-deep)] p-4">
          <img
            src={props.source}
            alt={`${props.title} · ${valueLabel()}`}
            class="h-full w-full object-contain"
          />
        </div>

        <footer class="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-[var(--border-weak-base)] px-4 py-3">
          <span />
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={!props.onPrevious}
              aria-label="Previous screenshot"
              title="Previous screenshot (Left arrow)"
              onClick={() => props.onPrevious?.()}
            >
              <Icon name="chevron-left" size={14} />
            </Button>
            <span class="min-w-16 text-center text-[11px] tabular-nums text-[var(--text-weak)]">
              {props.position} / {props.total}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!props.onNext}
              aria-label="Next screenshot"
              title="Next screenshot (Right arrow)"
              onClick={() => props.onNext?.()}
            >
              <Icon name="chevron-right" size={14} />
            </Button>
          </div>
          <Button variant="secondary" size="sm" class="justify-self-end" onClick={props.onOpenRun}>
            Open run details
          </Button>
        </footer>
      </div>
    </div>
  );
}
