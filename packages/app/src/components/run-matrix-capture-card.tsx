import { Show, createEffect, createSignal, on } from "solid-js";
import type { JobInfo } from "../context/server";
import type { RunMatrixCapture, RunMatrixValue } from "../lib/run-matrix-review";
import { cn } from "../lib/cn";
import { runOutcomeChip } from "./status-chip";

export function RunMatrixCaptureCard(props: {
  job: JobInfo;
  world: string;
  values: RunMatrixValue[];
  capture: RunMatrixCapture;
  missingCaptures: number;
  source: string;
  onOpen: () => void;
}) {
  const [imageFailed, setImageFailed] = createSignal(false);
  createEffect(
    on(
      () => props.source,
      () => setImageFailed(false),
    ),
  );
  const available = () => Boolean(props.source) && !imageFailed();
  const waiting = () => props.job.status === "running" || props.job.status === "queued";
  const status = () => runOutcomeChip(props.job);
  const valueLabel = () =>
    props.values.length ? props.values.map((value) => value.value).join(" · ") : props.world;
  const worldLabel = () => (props.values.length && props.world !== valueLabel() ? props.world : "");

  return (
    <article class="min-w-0 overflow-hidden rounded-[12px] border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)]">
      <button
        type="button"
        class="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--border-focus)]"
        aria-label={`Open ${props.capture.caption} for ${valueLabel()}`}
        onClick={props.onOpen}
      >
        <Show
          when={available()}
          fallback={
            <div class="grid aspect-[4/3] min-h-32 place-items-center bg-[var(--surface-base)] px-4 text-center text-[10.5px] text-[var(--text-weaker)]">
              {waiting()
                ? "Waiting for capture…"
                : imageFailed()
                  ? "Preview unavailable"
                  : "Not captured"}
            </div>
          }
        >
          <img
            src={props.source}
            alt={`${props.capture.caption} · ${props.world}`}
            class="aspect-[4/3] w-full bg-[var(--surface-base)] object-contain"
            loading="lazy"
            width="640"
            height="480"
            onError={() => setImageFailed(true)}
          />
        </Show>
        <span class="flex min-w-0 items-center gap-2 border-t border-[var(--border-weak-base)] px-3 py-2.5">
          <span class="flex min-w-0 flex-1 items-baseline gap-2">
            <strong class="truncate text-[11.5px] font-medium text-[var(--text-strong)]">
              {valueLabel()}
            </strong>
            <Show when={worldLabel()}>
              <span class="shrink-0 text-[9.5px] text-[var(--text-weak)]">{worldLabel()}</span>
            </Show>
          </span>
          <Show
            when={props.missingCaptures > 0 && !props.capture.frame}
            fallback={
              <span
                class={cn(
                  "shrink-0 text-[9.5px]",
                  status().tone === "fail"
                    ? "text-[var(--icon-critical-base)]"
                    : "text-[var(--text-weak)]",
                )}
              >
                {status().label}
              </span>
            }
          >
            <span class="shrink-0 text-[9.5px] text-[var(--icon-warning-base)]">Missing</span>
          </Show>
        </span>
      </button>
    </article>
  );
}
