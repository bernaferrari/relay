import { For, Show } from "solid-js";
import { Button } from "@relay/ui/button";
import { useServer, type JobInfo, type PersistedRun } from "../context/server";
import type { RunMatrixReview as RunMatrixReviewModel } from "../lib/run-matrix-review";
import { cn } from "../lib/cn";
import { runOutcomeChip } from "./status-chip";
import { Icon } from "./icon";

export function RunMatrixReview(props: {
  review: RunMatrixReviewModel;
  selectedId: string;
  onOpen: (job: JobInfo, frameIndex: number) => void;
  onRetryFailed: () => void;
}) {
  const server = useServer();
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
          <Show when={props.review.failed > 0}>
            <Button variant="secondary" size="sm" onClick={props.onRetryFailed}>
              <Icon name="refresh" size={12} /> Retry {props.review.failed} failed
            </Button>
          </Show>
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
            <For each={props.review.rows}>
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
                      </button>
                    </th>
                    <For each={row.captures}>
                      {(capture) => (
                        <td class="border-b border-[var(--border-weak-base)] p-1.5 align-top">
                          <Show
                            when={capture.frame ? frameSrc(row.job, capture.frame) : ""}
                            fallback={
                              <div class="grid aspect-[4/3] min-h-24 place-items-center rounded-[8px] border border-dashed border-[var(--border-weak-base)] text-[9.5px] text-[var(--text-weaker)]">
                                {row.job.status === "running" || row.job.status === "queued"
                                  ? "Waiting…"
                                  : "Not captured"}
                              </div>
                            }
                          >
                            {(src) => (
                              <button
                                type="button"
                                class="block w-full overflow-hidden rounded-[8px] bg-[var(--surface-base)] shadow-[var(--shadow-xs-border-base)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-sm-border-base)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
                                aria-label={`Open ${capture.caption} in ${row.world}`}
                                onClick={() => props.onOpen(row.job, capture.index)}
                              >
                                <img
                                  src={src()}
                                  alt={`${capture.caption} · ${row.world}`}
                                  class="aspect-[4/3] w-full object-contain"
                                  loading="lazy"
                                />
                              </button>
                            )}
                          </Show>
                        </td>
                      )}
                    </For>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
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
