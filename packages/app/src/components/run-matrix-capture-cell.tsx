import { Show, createEffect, createSignal, on } from "solid-js";
import type { JobInfo } from "../context/server";
import type { RunMatrixCapture } from "../lib/run-matrix-review";

export function RunMatrixCaptureCell(props: {
  job: JobInfo;
  world: string;
  capture: RunMatrixCapture;
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

  return (
    <td class="border-b border-[var(--border-weak-base)] p-1.5 align-top">
      <Show
        when={available()}
        fallback={
          <div class="grid aspect-[4/3] min-h-24 place-items-center rounded-[8px] border border-dashed border-[var(--border-weak-base)] text-[9.5px] text-[var(--text-weaker)]">
            {waiting() ? "Waiting…" : imageFailed() ? "Preview unavailable" : "Not captured"}
          </div>
        }
      >
        <button
          type="button"
          class="block w-full overflow-hidden rounded-[8px] bg-[var(--surface-base)] shadow-[var(--shadow-xs-border-base)] transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-sm-border-base)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
          aria-label={`Open ${props.capture.caption} in ${props.world}`}
          onClick={props.onOpen}
        >
          <img
            src={props.source}
            alt={`${props.capture.caption} · ${props.world}`}
            class="aspect-[4/3] w-full object-contain"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        </button>
      </Show>
    </td>
  );
}
