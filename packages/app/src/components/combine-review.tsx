import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js";
import { Button } from "@relay/ui/button";
import { EmptyState } from "./empty-state";
import type { CombineEvidenceAnalysisReport } from "@relay/protocol";
import { useServer, type JobInfo, type PersistedRun } from "../context/server";
import type { CombineReview as CombineReviewModel, CombineRow } from "../lib/combine-review";
import { Icon } from "./icon";
import {
  combineProblemRetryLabel,
  combineReviewPageSize,
  filterCombineRows,
  pageCombineRows,
} from "../lib/combine-review";
import { CombineCell, CombineCellSkeleton, CombineVerdictLegend } from "./combine-cell";
import {
  type CombineCellVerdict,
  combineCellVerdict,
  combineVerdictPresentation,
  summarizeCombineVerdicts,
} from "../lib/combine-verdict";
import { combineCellAnalysisIndex } from "../lib/combine-evidence-findings";
import { plural } from "../lib/plural";
import { RepeatResultDialog } from "./repeat-result-dialog";

export function CombineReview(props: {
  review: CombineReviewModel;
  history: readonly JobInfo[];
  onOpen: (job: JobInfo, frameIndex: number) => void;
  onRetryProblems: () => void;
  onExport: () => void;
  exporting?: boolean;
}) {
  const server = useServer();
  const [query, setQuery] = createSignal("");
  const [problemsOnly, setProblemsOnly] = createSignal(false);
  const [selectedCaptureIndex, setSelectedCaptureIndex] = createSignal(0);
  const [visibleCount, setVisibleCount] = createSignal(combineReviewPageSize);
  const [focusedRunId, setFocusedRunId] = createSignal<string | null>(null);
  const [retrying, setRetrying] = createSignal(false);
  const [verdictFilter, setVerdictFilter] = createSignal<CombineCellVerdict | null>(null);
  // Findings are read from the batch itself, so the grid can be judged while
  // the sweep is still running. It re-reads as cases land, and a cell the
  // report does not cover keeps reporting "Not checked" rather than a pass.
  const [analysisReport] = createResource(
    () =>
      props.review.batchId
        ? { batchId: props.review.batchId, complete: props.review.complete }
        : null,
    (source: { batchId: string }): Promise<CombineEvidenceAnalysisReport | null> =>
      server.combineEvidence.analyze(source.batchId),
  );
  // `latest` so a refetch mid-sweep does not blank every verdict on screen.
  const cellAnalysis = createMemo(() => combineCellAnalysisIndex(analysisReport.latest));
  const analysisFor = (row: CombineRow, captureIndex: number) =>
    cellAnalysis()(row.job.id, row.captures[captureIndex]?.frame?.path);
  const verdictOf = (row: CombineRow) =>
    combineCellVerdict({
      status: row.job.status,
      capture: row.captures[selectedCaptureIndex()],
      analysis: analysisFor(row, selectedCaptureIndex()),
    });
  const matchedRows = createMemo(() =>
    filterCombineRows(props.review, { query: query(), problemsOnly: problemsOnly() }),
  );
  const tallies = createMemo(() =>
    summarizeCombineVerdicts(matchedRows(), selectedCaptureIndex(), analysisFor),
  );
  const visibleRows = createMemo(() => {
    const verdict = verdictFilter();
    if (!verdict) return matchedRows();
    return matchedRows().filter((row) => verdictOf(row) === verdict);
  });
  const pagedRows = createMemo(() => pageCombineRows(visibleRows(), visibleCount()));
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
  const retryProblems = async () => {
    if (retrying()) return;
    setRetrying(true);
    try {
      await props.onRetryProblems();
    } finally {
      setRetrying(false);
    }
  };
  createEffect(() => {
    if (selectedCaptureIndex() >= props.review.captureLabels.length) {
      setSelectedCaptureIndex(0);
    }
  });
  createEffect(() => {
    query();
    problemsOnly();
    setVisibleCount(combineReviewPageSize);
    setFocusedRunId(null);
  });
  createEffect(() => {
    selectedCaptureIndex();
    setVisibleCount(combineReviewPageSize);
    // A verdict that exists on one screen may not exist on the next, and an
    // empty grid behind a stale chip reads as lost data.
    setVerdictFilter(null);
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
      aria-label="Repeat results"
    >
      <header class="grid shrink-0 gap-2.5 border-b border-[var(--border-weak-base)] px-5 py-3.5">
        <div class="flex items-center justify-between gap-4">
          <div class="flex min-w-0 items-center gap-2">
            <h2 class="m-0 text-title font-semibold tracking-[-0.02em] text-[var(--text-strong)]">
              Repeat results
            </h2>
            <span class="shrink-0 text-caption tabular-nums text-[var(--text-weak)]">
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
              <Button
                variant="secondary"
                size="sm"
                disabled={retrying()}
                aria-busy={retrying()}
                data-tip="Keeps passing results and retries only failed or incomplete values"
                aria-label={`${combineProblemRetryLabel(props.review)}; keep passing results`}
                onClick={() => void retryProblems()}
              >
                <Icon name="refresh" size={12} />
                {retrying() ? "Queuing…" : combineProblemRetryLabel(props.review)}
              </Button>
            </Show>
          </div>
        </div>
        <div
          class="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro tabular-nums text-[var(--text-weak)]"
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
      <Show when={tallies().length > 0}>
        <CombineVerdictLegend
          tallies={tallies()}
          active={verdictFilter()}
          onSelect={setVerdictFilter}
        />
      </Show>
      <Show when={props.review.insights.length > 0}>
        <div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border-weak-base)] px-5 py-2 text-micro">
          <span class="mr-1 shrink-0 font-medium text-[var(--text-strong)]">Needs attention</span>
          <For each={props.review.insights}>
            {(insight) => (
              <span class="max-w-full rounded-lg bg-[var(--surface-base)] px-2 py-1 text-[var(--text-base)]">
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
            <span class="sr-only">Checkpoint</span>
            <select
              aria-label="Checkpoint to review"
              class="h-11 w-full rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 text-caption font-medium text-[var(--text-strong)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)]"
              value={selectedCaptureIndex()}
              onChange={(event) => setSelectedCaptureIndex(Number(event.currentTarget.value))}
            >
              <For each={props.review.captureLabels}>
                {(label, index) => <option value={index()}>{label}</option>}
              </For>
            </select>
          </label>
          <span class="shrink-0 text-micro tabular-nums text-[var(--text-weak)]">
            <span class="tabular-nums">
              {selectedCaptureIndex() + 1}/{props.review.captureLabels.length}
            </span>
          </span>
          <label class="ml-auto flex h-11 min-w-[190px] flex-1 items-center gap-2 rounded-lg bg-[var(--surface-base)] px-2.5 shadow-[inset_0_0_0_1px_var(--border-weak-base)] focus-within:shadow-[inset_0_0_0_1px_var(--border-strong-base)] sm:max-w-[280px]">
            <Icon name="search" size={12} class="text-[var(--text-weak)]" />
            <span class="sr-only">Filter Repeat values</span>
            <input
              type="search"
              class="min-w-0 flex-1 border-0 bg-transparent text-caption text-[var(--text-strong)] outline-none placeholder:text-[var(--text-weak)]"
              value={query()}
              placeholder="Filter Repeat values"
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <Button
            variant="secondary"
            size="sm"
            class="min-h-11"
            aria-pressed={problemsOnly()}
            onClick={() => setProblemsOnly((value) => !value)}
          >
            {problemsOnly() ? "Show all" : "Problems"}
          </Button>
          <span class="shrink-0 text-micro tabular-nums text-[var(--text-weak)]">
            {plural(visibleRows().length, "value")}
          </span>
        </div>
      </Show>
      <div class="min-h-0 flex-1 overflow-auto overscroll-contain px-5 py-4">
        <div class="mb-3 flex items-baseline gap-3">
          <h3 class="m-0 truncate text-body font-semibold text-[var(--text-strong)]">
            {selectedCaptureLabel()}
          </h3>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <For each={pagedRows()}>
            {(row) => {
              const capture = () => row.captures[selectedCaptureIndex()];
              const source = () => (capture()?.frame ? frameSrc(row.job, capture()!.frame!) : "");
              const label = () =>
                row.values.length ? row.values.map((value) => value.value).join(" · ") : row.world;
              return (
                <Show when={capture()}>
                  {(selectedCapture) => (
                    <CombineCell
                      label={label()}
                      secondaryLabel={row.world !== label() ? row.world : undefined}
                      screenLabel={selectedCapture().caption}
                      source={source()}
                      verdict={verdictOf(row)}
                      analysis={analysisFor(row, selectedCaptureIndex())}
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
          {/* Cells still on device keep their slot so arriving screenshots do not
              shuffle everything a person is mid-scan through. */}
          <Show when={pagedRows().length === 0 && props.review.active > 0}>
            <For each={Array.from({ length: Math.min(props.review.active, 8) })}>
              {() => <CombineCellSkeleton />}
            </For>
          </Show>
        </div>
        <Show
          when={
            props.review.captureLabels.length > 0 &&
            visibleRows().length === 0 &&
            props.review.active === 0
          }
        >
          <div class="grid min-h-48 place-items-center text-center">
            <div class="max-w-[42ch]">
              <strong class="block text-caption text-[var(--text-strong)]">
                {verdictFilter()
                  ? `Nothing on this screen is ${combineVerdictPresentation(verdictFilter()!).label.toLocaleLowerCase()}`
                  : "No matching values"}
              </strong>
              <p class="m-0 mt-1 text-micro/[1.45] text-[var(--text-weak)]">
                {verdictFilter()
                  ? "Try another verdict, or another screen from this Test."
                  : "Clear the filter to see every Repeat value."}
              </p>
              <Show when={verdictFilter() || query() || problemsOnly()}>
                <Button
                  variant="secondary"
                  size="sm"
                  class="mt-3"
                  onClick={() => {
                    setVerdictFilter(null);
                    setQuery("");
                    setProblemsOnly(false);
                  }}
                >
                  Show all results
                </Button>
              </Show>
            </div>
          </div>
        </Show>
        <Show when={props.review.captureLabels.length === 0}>
          <EmptyState
            appearance="quiet"
            size="sm"
            class="min-h-48 rounded-xl border border-dashed border-[var(--border-weak-base)]"
            title="No screenshots requested"
            description="This Repeat still records pass, failure, timing, and diagnostic evidence."
          />
        </Show>
        <Show when={pagedRows().length < visibleRows().length}>
          <div class="grid place-items-center gap-1 pt-4" role="status" aria-live="polite">
            <span class="text-micro tabular-nums text-text-weak">
              Showing {pagedRows().length} of {visibleRows().length} results
            </span>
            <Button
              variant="secondary"
              size="sm"
              class="min-h-11"
              onClick={() => setVisibleCount((count) => count + combineReviewPageSize)}
            >
              Show {Math.min(combineReviewPageSize, visibleRows().length - pagedRows().length)} more
            </Button>
          </div>
        </Show>
      </div>
      <Show when={focusedRow()}>
        {(row) => {
          const capture = () => row().captures[selectedCaptureIndex()];
          const source = () => (capture()?.frame ? frameSrc(row().job, capture()!.frame!) : "");
          return (
            <RepeatResultDialog
              row={row()}
              capture={capture()!}
              source={source()}
              verdict={verdictOf(row())}
              analysis={analysisFor(row(), selectedCaptureIndex())}
              history={props.history}
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
