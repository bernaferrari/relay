import { For, Show, createEffect, createMemo } from "solid-js";
import type { ExecutionMoment, ExecutionMomentState } from "../lib/execution-moments";
import { cn } from "../lib/cn";
import { formatReviewTime } from "../lib/run-review-model";
import { GLYPH_ICON, GLYPH_META, Icon } from "./icon";

export type ExecutionTimelineMode = "plan" | "live" | "replay";

function stateLabel(state: ExecutionMomentState): string {
  switch (state) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "paused":
      return "Waiting for you";
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Planned";
  }
}

function stateDot(state: ExecutionMomentState): string {
  if (state === "failed" || state === "cancelled") return "bg-[var(--relay-red)]";
  if (state === "passed") return "bg-[var(--relay-green)]";
  if (state === "paused") return "bg-[var(--relay-orange)]";
  if (state === "running") return "bg-[var(--relay-accent)]";
  return "bg-[var(--relay-text-tertiary)]";
}

function segmentSurface(state: ExecutionMomentState, selected: boolean): string {
  if (selected)
    return "bg-[color-mix(in_srgb,var(--relay-accent)_16%,var(--relay-surface-raised))] ring-1 ring-inset ring-[color-mix(in_srgb,var(--relay-accent)_54%,transparent)]";
  if (state === "failed" || state === "cancelled")
    return "bg-[color-mix(in_srgb,var(--relay-red)_10%,var(--relay-surface-raised))]";
  if (state === "running")
    return "bg-[color-mix(in_srgb,var(--relay-accent)_10%,var(--relay-surface-raised))]";
  return "bg-[var(--relay-surface-raised)]";
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
  class?: string;
}) {
  let scrollEl: HTMLDivElement | undefined;
  const safeIndex = createMemo(() =>
    Math.max(0, Math.min(props.selectedIndex, Math.max(0, props.moments.length - 1))),
  );
  const selected = createMemo(() => props.moments[safeIndex()]);
  const runState = createMemo(() => {
    if (props.moments.some((moment) => moment.state === "running")) return "running";
    if (props.moments.some((moment) => moment.state === "paused")) return "paused";
    if (props.moments.some((moment) => moment.state === "failed")) return "failed";
    if (props.moments.length > 0 && props.moments.every((moment) => moment.state === "passed"))
      return "passed";
    return "planned";
  });

  createEffect(() => {
    safeIndex();
    queueMicrotask(() => {
      const item = scrollEl?.querySelector<HTMLElement>("[data-timeline-selected='true']");
      item?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  });

  const move = (delta: number) =>
    props.onSelect(Math.max(0, Math.min(safeIndex() + delta, props.moments.length - 1)));

  return (
    <section
      class={cn(
        "relative z-[3] shrink-0 border-t border-[var(--relay-line)] bg-[var(--relay-panel)] px-3 py-2.5",
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
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex min-w-[104px] shrink-0 items-center gap-2">
          <Show
            when={props.mode === "replay" && props.onTogglePlayback}
            fallback={
              <span class="grid size-7 place-items-center rounded-lg bg-[var(--relay-surface-raised)]">
                <i
                  class={cn(
                    "size-2 rounded-full",
                    stateDot(runState()),
                    runState() === "running" && "animate-pulse",
                  )}
                />
              </span>
            }
          >
            <button
              type="button"
              class="grid size-7 place-items-center rounded-lg bg-[var(--relay-surface-strong)] text-[var(--relay-text)] transition-transform duration-150 active:scale-[0.96]"
              aria-label={props.playing ? "Pause run playback" : "Play run playback"}
              aria-pressed={props.playing}
              onClick={() => props.onTogglePlayback?.()}
            >
              <Icon name={props.playing ? "pause" : "play"} size={11} />
            </button>
          </Show>
          <div class="min-w-0">
            <strong class="block truncate text-[11px] font-medium text-[var(--relay-text)]">
              {props.mode === "plan"
                ? "Ready to run"
                : props.mode === "live"
                  ? stateLabel(runState())
                  : props.playing
                    ? "Playing"
                    : "Replay"}
            </strong>
            <small class="block truncate font-mono text-[9.5px] tabular-nums text-[var(--relay-text-tertiary)]">
              <Show
                when={(props.totalDurationMs ?? 0) > 0}
                fallback={`${props.moments.length} ${props.moments.length === 1 ? "step" : "steps"}`}
              >
                {formatReviewTime(props.elapsedMs ?? 0)} /{" "}
                {formatReviewTime(props.totalDurationMs ?? 0)}
              </Show>
            </small>
          </div>
        </div>

        <div
          ref={(element) => {
            scrollEl = element;
          }}
          class="flex min-w-0 flex-1 gap-1 overflow-x-auto py-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Actions in this execution"
        >
          <For each={props.moments}>
            {(moment) => {
              const isSelected = () => moment.index === safeIndex();
              return (
                <button
                  type="button"
                  role="tab"
                  data-timeline-selected={isSelected() ? "true" : undefined}
                  aria-selected={isSelected()}
                  aria-label={`Step ${moment.index + 1}: ${moment.title}. ${moment.actions
                    .map((action) => GLYPH_META[action]?.label ?? action)
                    .join(", ")}. ${stateLabel(moment.state)}`}
                  class={cn(
                    "group relative flex h-11 min-w-[88px] flex-1 items-center gap-2 rounded-lg px-2.5 text-left outline-none",
                    "transition-[background-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
                    "focus-visible:ring-2 focus-visible:ring-[var(--relay-accent)] active:scale-[0.985]",
                    segmentSurface(moment.state, isSelected()),
                  )}
                  style={{
                    "flex-grow": String(
                      Math.max(1, Math.min(4, (moment.durationMs ?? 1000) / 1000)),
                    ),
                    "min-width": `${Math.max(88, 58 + moment.actions.length * 15)}px`,
                  }}
                  onClick={() => props.onSelect(moment.index)}
                >
                  <span class="relative grid size-6 shrink-0 place-items-center">
                    <span class="font-mono text-[10px] tabular-nums text-[var(--relay-text-secondary)]">
                      {moment.index + 1}
                    </span>
                    <i
                      class={cn(
                        "absolute right-0 bottom-0 size-1.5 rounded-full ring-2 ring-[var(--relay-surface-raised)]",
                        stateDot(moment.state),
                      )}
                    />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[10.5px] font-medium text-[var(--relay-text)]">
                      {moment.title}
                    </span>
                    <span class="mt-0.5 flex h-3 items-center gap-0.5" aria-hidden="true">
                      <For each={moment.actions}>
                        {(glyph) => (
                          <span
                            class="grid size-3.5 place-items-center text-[var(--relay-text-tertiary)]"
                            data-tip={GLYPH_META[glyph]?.label ?? glyph}
                          >
                            <Show
                              when={GLYPH_ICON[glyph]}
                              fallback={<i class="size-1 rounded-full bg-current" />}
                            >
                              {(name) => <Icon name={name()} size={9} />}
                            </Show>
                          </span>
                        )}
                      </For>
                    </span>
                  </span>
                </button>
              );
            }}
          </For>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="grid size-7 place-items-center rounded-lg text-[var(--relay-text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--relay-text)] disabled:opacity-25"
            aria-label="Previous step"
            disabled={safeIndex() === 0}
            onClick={() => (props.onPrevious ? props.onPrevious() : move(-1))}
          >
            <Icon name="chevron-left" size={13} />
          </button>
          <span class="min-w-9 text-center font-mono text-[9.5px] tabular-nums text-[var(--relay-text-tertiary)]">
            {props.moments.length ? safeIndex() + 1 : 0}/{props.moments.length}
          </span>
          <button
            type="button"
            class="grid size-7 place-items-center rounded-lg text-[var(--relay-text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--relay-text)] disabled:opacity-25"
            aria-label="Next step"
            disabled={safeIndex() >= props.moments.length - 1}
            onClick={() => (props.onNext ? props.onNext() : move(1))}
          >
            <Icon name="chevron-right" size={13} />
          </button>
        </div>
      </div>
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
