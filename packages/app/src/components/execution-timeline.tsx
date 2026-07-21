import { For, Show, createMemo } from "solid-js";
import {
  executionStateForMoments,
  executionStateLabel,
  type ExecutionMoment,
  type ExecutionMomentState,
} from "../lib/execution-moments";
import { cn } from "../lib/cn";
import { formatReviewTime } from "../lib/run-review-model";
import { Icon } from "./icon";

export type ExecutionTimelineMode = "plan" | "live" | "replay";

function stateDot(state: ExecutionMomentState): string {
  if (state === "failed" || state === "cancelled") return "bg-[var(--icon-critical-base)]";
  if (state === "passed") return "bg-[var(--icon-success-base)]";
  if (state === "paused") return "bg-[var(--icon-warning-base)]";
  if (state === "running") return "bg-[var(--v2-background-bg-accent)]";
  return "bg-[var(--text-weak)]";
}

export function ExecutionTimeline(props: {
  moments: ExecutionMoment[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  mode: ExecutionTimelineMode;
  playing?: boolean;
  onTogglePlayback?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  elapsedMs?: number;
  totalDurationMs?: number;
  /** Current replay speed multiplier (1, 2, 4, 8...). Defaults to 1x. */
  speed?: number;
  /** Cycles the replay speed; the caller owns the multiplier's progression. */
  onCycleSpeed?: () => void;
  /** Replay-only: fraction (0..1) of totalDurationMs from a scrub track click/drag. */
  onScrub?: (fraction: number) => void;
  class?: string;
}) {
  let trackEl: HTMLDivElement | undefined;
  let scrubbing = false;
  const safeIndex = createMemo(() =>
    Math.max(0, Math.min(props.selectedIndex, Math.max(0, props.moments.length - 1))),
  );
  const selected = createMemo(() => props.moments[safeIndex()]);
  const runState = createMemo(() => executionStateForMoments(props.moments));

  const move = (delta: number) =>
    props.onSelect(Math.max(0, Math.min(safeIndex() + delta, props.moments.length - 1)));

  // Replay-only scrub track math. Mirrors runs-workspace.tsx's stepOffsetsMs
  // (offset = startedAt - first known startedAt, else cumulative durationMs)
  // but generically over whatever moments this instance was handed.
  const stepOffsetsMs = createMemo(() => {
    const start = props.moments.find((moment) => moment.startedAt != null)?.startedAt ?? 0;
    let cumulative = 0;
    return props.moments.map((moment) => {
      const offset = moment.startedAt != null ? Math.max(0, moment.startedAt - start) : cumulative;
      cumulative += Math.max(0, moment.durationMs ?? 0);
      return offset;
    });
  });
  const totalMs = createMemo(() => Math.max(0, props.totalDurationMs ?? 0));
  const fillPercent = createMemo(() => {
    const total = totalMs();
    return total <= 0 ? 0 : Math.max(0, Math.min(100, ((props.elapsedMs ?? 0) / total) * 100));
  });
  const overviewPercent = createMemo(() => {
    if (totalMs() > 0) return fillPercent();
    return props.moments.length > 0 ? ((safeIndex() + 1) / props.moments.length) * 100 : 0;
  });
  const offsetPercent = (moment: ExecutionMoment) => {
    const total = totalMs();
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, ((stepOffsetsMs()[moment.index] ?? 0) / total) * 100));
  };
  const nearestStepForFraction = (fraction: number) => {
    const target = fraction * totalMs();
    const offsets = stepOffsetsMs();
    let best = 0;
    let bestDelta = Infinity;
    offsets.forEach((offset, i) => {
      const delta = Math.abs(offset - target);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = i;
      }
    });
    return best;
  };
  const scrubToFraction = (fraction: number) => {
    if (props.onScrub) props.onScrub(fraction);
    else props.onSelect(nearestStepForFraction(fraction));
  };
  const fractionFromPointer = (clientX: number) => {
    if (!trackEl) return 0;
    const rect = trackEl.getBoundingClientRect();
    return rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
  };

  return (
    <section
      class={cn(
        "relative z-[3] shrink-0 border-t border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)] px-3 py-2.5",
        props.class,
      )}
      aria-label={props.mode === "replay" ? "Run timeline" : "Execution timeline"}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          move(-1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          move(1);
        } else if (event.key === "Home") {
          event.preventDefault();
          event.stopPropagation();
          props.onSelect(0);
        } else if (event.key === "End") {
          event.preventDefault();
          event.stopPropagation();
          props.onSelect(Math.max(0, props.moments.length - 1));
        } else if (event.key === " ") {
          // Replay's parent stage also owns Space. Keep a focused control from
          // toggling playback twice (keydown on the stage, click on the button).
          event.stopPropagation();
        }
      }}
    >
      <Show
        when={props.mode === "replay"}
        fallback={
          <div class="flex min-w-0 items-center gap-3">
            <div class="flex min-w-[104px] shrink-0 items-center gap-2">
              <i
                class={cn(
                  "size-2 rounded-full",
                  stateDot(runState()),
                  runState() === "running" && "animate-pulse",
                )}
              />
              <span class="text-[11px] font-medium text-[var(--text-base)]">
                {props.mode === "plan" ? "Ready" : executionStateLabel(runState())}
              </span>
            </div>

            <div class="min-w-0 flex-1">
              <div class="mb-1.5 flex min-w-0 items-baseline justify-between gap-3">
                <strong class="truncate text-[11px] font-medium text-[var(--text-strong)]">
                  {selected()?.title ?? "No step selected"}
                </strong>
                <small class="shrink-0 font-mono text-[9.5px] tabular-nums text-[var(--text-weak)]">
                  Step {props.moments.length ? safeIndex() + 1 : 0} of {props.moments.length}
                </small>
              </div>
              <div class="h-1 overflow-hidden rounded-full bg-[var(--v2-background-bg-layer-02)]">
                <div
                  class="h-full rounded-full bg-[var(--v2-background-bg-accent)] transition-[width] duration-150 ease-out"
                  style={{ width: `${overviewPercent()}%` }}
                />
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-1">
              <button
                type="button"
                class="grid size-7 place-items-center rounded-lg text-[var(--text-base)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-strong)] disabled:opacity-25"
                aria-label="Previous step"
                disabled={safeIndex() === 0}
                onClick={() => (props.onPrevious ? props.onPrevious() : move(-1))}
              >
                <Icon name="chevron-left" size={13} />
              </button>
              <button
                type="button"
                class="grid size-7 place-items-center rounded-lg text-[var(--text-base)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-strong)] disabled:opacity-25"
                aria-label="Next step"
                disabled={safeIndex() >= props.moments.length - 1}
                onClick={() => (props.onNext ? props.onNext() : move(1))}
              >
                <Icon name="chevron-right" size={13} />
              </button>
            </div>
          </div>
        }
      >
        {/* Replay: one continuous scrubber replaces the chip row + label block +
            prev/next + counter — play/pause, speed, track, time readout. */}
        <div class="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            class="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--v2-background-bg-layer-02)] text-[var(--text-strong)] transition-transform duration-150 active:scale-[0.96]"
            aria-label={props.playing ? "Pause run playback" : "Play run playback"}
            aria-pressed={props.playing}
            onClick={() => props.onTogglePlayback?.()}
          >
            <Icon name={props.playing ? "pause" : "play"} size={11} />
          </button>
          <Show when={props.onCycleSpeed}>
            <button
              type="button"
              class="grid h-7 min-w-7 shrink-0 place-items-center rounded-lg bg-[var(--v2-background-bg-layer-02)] px-1.5 font-mono text-[10px] font-semibold tabular-nums text-[var(--text-strong)] transition-transform duration-150 active:scale-[0.96]"
              aria-label="Playback speed"
              onClick={() => props.onCycleSpeed?.()}
            >
              {props.speed ?? 1}x
            </button>
          </Show>

          <div
            ref={(element) => {
              trackEl = element;
            }}
            class="group relative h-7 min-w-0 flex-1 cursor-pointer touch-none select-none"
            role="group"
            aria-label="Scrub run playback"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              scrubbing = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              if (props.playing) props.onTogglePlayback?.();
              scrubToFraction(fractionFromPointer(event.clientX));
            }}
            onPointerMove={(event) => {
              if (!scrubbing) return;
              scrubToFraction(fractionFromPointer(event.clientX));
            }}
            onPointerUp={() => {
              scrubbing = false;
            }}
            onPointerCancel={() => {
              scrubbing = false;
            }}
            onLostPointerCapture={() => {
              scrubbing = false;
            }}
          >
            {/* Full-height div is the drag hit area; the visible rail is a thin
                centered bar so the track reads as one line, not a fat slab. */}
            <div class="pointer-events-none absolute top-1/2 left-0 h-1.5 w-full -translate-y-1/2 overflow-hidden rounded-full bg-[var(--v2-background-bg-layer-01)]">
              <div
                class="h-full rounded-full bg-[var(--v2-background-bg-accent)] transition-[width] duration-150 ease-linear"
                style={{ width: `${fillPercent()}%` }}
              />
            </div>
            <For each={props.moments}>
              {(moment) => (
                <button
                  type="button"
                  class="absolute top-1/2 z-[1] flex h-full w-2.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--v2-background-bg-accent)]"
                  style={{ left: `${offsetPercent(moment)}%` }}
                  aria-label={`Jump to step ${moment.index + 1}: ${moment.title}. ${executionStateLabel(moment.state, "step")}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onSelect(moment.index);
                  }}
                >
                  <i
                    class={cn(
                      "size-1.5 rounded-full ring-2 ring-[var(--v2-background-bg-layer-01)]",
                      stateDot(moment.state),
                    )}
                  />
                </button>
              )}
            </For>
            {/* Thumb — only appears on hover/focus so the rail stays calm at rest. */}
            <div
              class="pointer-events-none absolute top-1/2 z-[2] size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-strong)] opacity-0 shadow-[0_1px_4px_rgb(0_0_0/40%)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
              style={{ left: `${fillPercent()}%` }}
            />
          </div>

          <span class="shrink-0 font-mono text-[9.5px] tabular-nums text-[var(--text-weak)]">
            {formatReviewTime(props.elapsedMs ?? 0)} /{" "}
            {formatReviewTime(props.totalDurationMs ?? 0)}
          </span>
        </div>
      </Show>
      <Show when={selected()}>
        {(moment) => (
          <span class="sr-only" aria-live="polite">
            Selected step {moment().index + 1}: {moment().title}
          </span>
        )}
      </Show>
    </section>
  );
}
