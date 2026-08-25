import { For, Show, createMemo } from "solid-js";
import { useServer, type JobInfo, type PersistedRun } from "../context/server";
import { cn } from "../lib/cn";
import { executionMoments, stepGlyph, type ExecutionMoment } from "../lib/execution-moments";
import { fmtAgo, fmtDur, titleize } from "../lib/job";
import { presentTarget } from "../lib/target-presentation";
import { formatStepDuration, runStateDot } from "../lib/run-review-presentation";
import type { RunBatchSummary } from "../lib/runs-workspace-helpers";
import { mono } from "../lib/ui";
import { ActionIconTrail } from "./action-icon-trail";
import { Icon } from "./icon";
import { kindIcon, kindLabel } from "./step-list-metadata";
import { runOutcomeChip } from "./status-chip";

/** Supporting action list for a run report. Playback remains the primary
 * review surface; this list explains and jumps to an exact moment. */
export function RunStepList(props: {
  job: JobInfo;
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const server = useServer();
  const snapshot = () => props.job.recipeSnapshot;
  const persisted = Boolean(props.job.persisted || props.job.runDir);
  const stepThumbSrc = (frame: NonNullable<ExecutionMoment["frame"]>): string | null => {
    if (frame.base64) return `data:${frame.mime || "image/png"};base64,${frame.base64}`;
    return persisted
      ? server.frameUrlForPersisted(props.job as unknown as PersistedRun, frame)
      : null;
  };
  const nodes = createMemo(() =>
    executionMoments({
      recipe: snapshot(),
      job: props.job,
      recipes: snapshot() ? [snapshot()!] : [],
    }),
  );
  return (
    <div class="grid content-start">
      <div class="relative grid content-start before:absolute before:top-8 before:bottom-8 before:left-6 before:w-px before:bg-[var(--border-strong-base)]">
        <For
          each={nodes()}
          fallback={
            <div class="rounded-xl border border-dashed border-[var(--border-weak-base)] px-3 py-5 text-center text-caption text-[var(--text-weak)]">
              No steps were recorded for this run.
            </div>
          }
        >
          {(node) => {
            const active = () => props.selectedIndex === node.index;
            const kind = () => snapshot()?.steps[node.index]?.kind;
            return (
              <button
                type="button"
                class={cn(
                  "relative grid min-h-16 w-full grid-cols-[32px_32px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-3 text-left transition-[background-color,transform] duration-hover active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus",
                  active()
                    ? "bg-[color-mix(in_srgb,var(--text-interactive-base)_11%,var(--background-base))]"
                    : "hover:bg-[var(--surface-base)]",
                  node.state === "planned" && !active() && "opacity-55",
                )}
                aria-current={active() ? "step" : undefined}
                onClick={() => props.onSelect(node.index)}
              >
                <span
                  class={cn(
                    "relative z-[1] grid size-8 place-items-center rounded-xl border bg-[var(--background-base)] font-mono text-caption font-semibold tabular-nums",
                    active()
                      ? "border-[var(--text-interactive-base)] text-[var(--text-interactive-base)]"
                      : node.state === "failed"
                        ? "border-[var(--icon-critical-base)] text-[var(--icon-critical-base)]"
                        : "border-[var(--border-strong-base)] text-[var(--text-weak)]",
                  )}
                >
                  {node.index + 1}
                </span>
                <Show
                  when={node.frame}
                  fallback={
                    <span class="grid size-8 place-items-center rounded-lg bg-surface-base" aria-hidden="true">
                      <Icon name="camera" size={13} class="text-text-weaker/50" />
                    </span>
                  }
                >
                  {(frame) => (
                    <img
                      src={stepThumbSrc(frame()) ?? undefined}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                      decoding="async"
                      class={cn(
                        "size-8 rounded-lg border border-border-weak-base object-cover",
                        node.state === "failed" && "opacity-55",
                        node.state === "planned" && !active() && "opacity-30",
                      )}
                    />
                  )}
                </Show>
                <span class="min-w-0 pr-2">
                  <span class="flex min-w-0 items-center gap-1.5 text-micro font-medium text-text-weaker">
                    <Icon name={kind() ? kindIcon(kind()!) : "bolt"} size={11} class="shrink-0" />
                    <span class="shrink-0 tracking-[0.02em]">
                      {kind() ? kindLabel(kind()!) : "Step"}
                    </span>
                    <Show when={node.durationMs}>
                      <span class="shrink-0 text-text-weaker/70">·</span>
                      <span class={cn(mono, "shrink-0 text-micro")}>
                        {formatStepDuration(node.durationMs!)}
                      </span>
                    </Show>
                    <Show when={node.actions.length > 0 ? node.actions : undefined}>
                      {(actions) => (
                        <>
                          <span class="shrink-0 text-text-weaker/70">·</span>
                          <ActionIconTrail glyphs={actions()} max={8} />
                        </>
                      )}
                    </Show>
                  </span>
                  <strong class="mt-1 block truncate text-body/[1.35] font-medium tracking-[-0.005em] text-text-strong">
                    {node.title}
                  </strong>
                </span>
                <span class="grid shrink-0 justify-items-end gap-1 text-text-weaker">
                  <i class={cn("size-1.5 rounded-full", runStateDot(node.state))} />
                </span>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export function RunRow(props: {
  job: JobInfo;
  selected: boolean;
  batch?: RunBatchSummary | null;
  onOpen: () => void;
}) {
  const server = useServer();
  const targetName = () => {
    if (props.job.targetProfile?.name) return props.job.targetProfile.name;
    const target = server.devices().find((device) => device.serial === props.job.serial);
    return target ? presentTarget(target).displayName : (props.job.serial ?? null);
  };
  const outcome = () => runOutcomeChip(props.job);
  const status = () => props.batch?.status ?? outcome().label;
  const title = () =>
    props.batch?.title ?? props.job.title ?? props.job.recipeSnapshot?.title ?? titleize(props.job.action);
  const glyphSteps = () => props.job.recipeSnapshot?.steps ?? [];
  const passed = () => props.batch?.tone === "pass" || (!props.batch && outcome().tone === "pass");
  const active = () =>
    props.batch?.tone === "active" ||
    (!props.batch && ["queued", "running", "paused"].includes(props.job.status));
  const attention = () =>
    props.batch?.tone === "attention" || (!props.batch && outcome().tone === "attention");
  const duration = () =>
    props.batch
      ? fmtDur({ ...props.job, durationMs: props.batch.durationMs }, server.clock())
      : fmtDur(props.job, server.clock());
  const frameThumbs = createMemo(() => {
    const job = props.job;
    const raw = [...(job.frames ?? []), ...(job.steps?.flatMap((step) => step.frames ?? []) ?? [])];
    if (raw.length === 0) return [];
    const seen = new Set<string>();
    const persisted = Boolean(job.persisted || job.runDir);
    const urls: string[] = [];
    for (const frame of raw) {
      const key = `${frame.path}|${frame.capturedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const src = frame.base64
        ? `data:${frame.mime || "image/png"};base64,${frame.base64}`
        : persisted
          ? server.frameUrlForPersisted(job as unknown as PersistedRun, frame)
          : null;
      if (src) urls.push(src);
      if (urls.length >= 3) break;
    }
    return urls;
  });
  const rowLabel = () =>
    [
      title(),
      status(),
      duration(),
      fmtAgo(props.job.startedAt ?? props.job.queuedAt, server.clock()) || "just now",
    ]
      .filter(Boolean)
      .join(", ");
  return (
    <button
      type="button"
      class={cn(
        "group mb-2 grid min-h-[76px] w-full grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border-weak-base bg-background-stronger px-3.5 text-left text-caption/[1.35] text-text-weak shadow-[0_5px_16px_rgb(0_0_0/6%)] transition-[background-color,border-color] duration-hover last:mb-0 hover:border-[var(--border-strong-base)] hover:bg-[var(--surface-base)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus",
        props.selected && "border-border-interactive-base bg-surface-base-active",
      )}
      aria-current={props.selected ? "true" : undefined}
      aria-label={rowLabel()}
      onClick={props.onOpen}
    >
      <span
        class={cn(
          "grid size-9 place-items-center rounded-xl",
          passed() && "bg-surface-success-weak text-icon-success-base",
          attention() && "bg-surface-warning-weak text-icon-warning-base",
          active() && "bg-surface-info-weak text-icon-info-base",
          !passed() &&
            !active() &&
            !attention() &&
            "bg-surface-critical-weak text-icon-critical-base",
        )}
        aria-hidden="true"
      >
        <Show
          when={attention()}
          fallback={<Icon name={passed() ? "check" : active() ? "play" : "alert"} size={16} />}
        >
          <Show
            when={props.batch}
            fallback={
              <span class="text-title font-semibold leading-none" aria-hidden="true">
                ?
              </span>
            }
          >
            <Icon name="alert" size={16} />
          </Show>
        </Show>
      </span>
      <span class="min-w-0">
        <strong class="block truncate text-body/[1.3] font-[550] text-text-base">{title()}</strong>
        <span class="mt-1.5 flex min-w-0 items-center gap-1.5 text-text-weaker">
          <span
            class={cn(
              "font-medium",
              passed() && "text-text-success-base",
              attention() && "text-text-warning-base",
              !passed() && !active() && !attention() && "text-text-critical-base",
            )}
          >
            {status()}
          </span>
          <Show when={glyphSteps().length > 0}>
            <span class="opacity-50">·</span>
            <span class="text-caption">
              {glyphSteps().length} step{glyphSteps().length === 1 ? "" : "s"}
            </span>
            <span class="opacity-50">·</span>
            <ActionIconTrail glyphs={glyphSteps().map((step) => stepGlyph(step.kind))} max={8} />
          </Show>
          <Show when={targetName()}>
            <span class="opacity-50">·</span>
            <span class="max-w-[220px] truncate">{targetName()}</span>
          </Show>
          <Show when={props.job.appVersion}>
            <i class="font-mono text-caption not-italic">· build {props.job.appVersion}</i>
          </Show>
          <Show when={props.job.failureCategory}>
            <i class="truncate text-caption not-italic text-icon-critical-base">
              · {titleize(props.job.failureCategory!)}
            </i>
          </Show>
        </span>
        <Show when={frameThumbs().length > 0}>
          <span class="mt-1.5 flex items-center gap-1" aria-hidden="true">
            <For each={frameThumbs()}>
              {(src) => (
                <img
                  src={src}
                  alt=""
                  class="h-8 w-[18px] shrink-0 rounded border border-border-weak-base object-cover opacity-90"
                />
              )}
            </For>
          </span>
        </Show>
      </span>
      <span class="grid justify-items-end gap-1.5">
        <span class="font-mono text-caption tabular-nums text-text-base">{duration() || "—"}</span>
        <span class="inline-flex items-center gap-1.5 text-micro text-text-weaker">
          <span class={cn(mono, "text-micro")}>
            {fmtAgo(props.job.startedAt ?? props.job.queuedAt, server.clock()) || "now"}
          </span>
          <Icon name="chevron-right" size={13} />
        </span>
      </span>
    </button>
  );
}
