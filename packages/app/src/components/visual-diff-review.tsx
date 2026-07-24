import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";
import type { PersistedRun, TraceFrameRef, TraceStep, VisualComparison } from "../context/server";
import { useServer } from "../context/server";
import { Icon } from "./icon";
import { cn } from "../lib/cn";
import { diffRgba } from "../lib/visual-diff";

type VisualPair = {
  index: number;
  title: string;
  baseline: TraceFrameRef;
  current: TraceFrameRef;
  ratio: number | null;
};

const CHANGE_THRESHOLD = 0.0035;

function afterFrame(step: TraceStep): TraceFrameRef | null {
  for (let index = step.frames.length - 1; index >= 0; index -= 1) {
    const frame = step.frames[index]!;
    if (frame.caption.startsWith("after ·")) return frame;
  }
  return step.frames.at(-1) ?? null;
}

function pairsFor(baseline: PersistedRun, current: PersistedRun): VisualPair[] {
  return current.steps.flatMap((currentStep, index) => {
    const baselineStep = baseline.steps[index];
    if (!baselineStep) return [];
    const before = afterFrame(baselineStep);
    const after = afterFrame(currentStep);
    if (!before || !after) return [];
    return [{ index, title: currentStep.title, baseline: before, current: after, ratio: null }];
  });
}

async function rgbaFromUrl(url: string): Promise<{
  width: number;
  height: number;
  data: Uint8ClampedArray;
}> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load frame (${response.status})`);
  const bitmap = await createImageBitmap(await response.blob());
  const scale = Math.min(1, 280 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Visual review could not create a drawing surface");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

function videoFile(run: PersistedRun): string | null {
  const video = run.artifacts?.find((artifact) => artifact.kind === "video");
  const files = (video?.data as { files?: Array<{ path?: unknown }> } | undefined)?.files;
  const path = files?.find((file) => typeof file.path === "string")?.path;
  return typeof path === "string" ? path : null;
}

function changeLabel(ratio: number | null): string {
  if (ratio === null) return "Checking";
  if (ratio < CHANGE_THRESHOLD) return "No change";
  return `${Math.max(0.1, ratio * 100).toFixed(1)}% changed`;
}

function approvedAt(value: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value);
}

function targetLabel(run: PersistedRun): string {
  return run.targetProfile?.name ?? run.serial ?? "this device";
}

export function VisualDiffReview(props: {
  comparison: VisualComparison | null;
  loading: boolean;
  onApprove: () => void;
  approving?: boolean;
}) {
  const server = useServer();
  const [pairs, setPairs] = createSignal<VisualPair[]>([]);
  const [selected, setSelected] = createSignal(0);
  const [split, setSplit] = createSignal(50);
  const [checking, setChecking] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const comparisonKey = createMemo(() => {
    const comparison = props.comparison;
    return comparison
      ? `${comparison.baseline?.runId ?? "none"}:${comparison.current.id}:${comparison.current.writtenAt}`
      : "";
  });

  createEffect(
    on(comparisonKey, async () => {
      const comparison = props.comparison;
      if (!comparison?.baseline) {
        setPairs([]);
        setError(null);
        return;
      }
      const next = pairsFor(comparison.baseline.run, comparison.current);
      setPairs(next);
      setSelected(0);
      setError(null);
      if (next.length === 0) return;
      setChecking(true);
      let firstChanged: number | null = null;
      try {
        for (const pair of next) {
          const [baseline, current] = await Promise.all([
            rgbaFromUrl(server.frameUrlForPersisted(comparison.baseline!.run, pair.baseline)),
            rgbaFromUrl(server.frameUrlForPersisted(comparison.current, pair.current)),
          ]);
          const difference = diffRgba(baseline, current);
          if (difference.ratio >= CHANGE_THRESHOLD && firstChanged === null) {
            firstChanged = pair.index;
          }
          setPairs((items) =>
            items.map((item) =>
              item.index === pair.index ? { ...item, ratio: difference.ratio } : item,
            ),
          );
        }
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Could not compare the captured screens",
        );
      } finally {
        setChecking(false);
        if (firstChanged !== null) setSelected(firstChanged);
      }
    }),
  );

  const changed = createMemo(() => pairs().filter((pair) => (pair.ratio ?? 0) >= CHANGE_THRESHOLD));
  const selectedPair = createMemo(() => pairs().find((pair) => pair.index === selected()) ?? null);
  createEffect(on(selected, () => setSplit(50)));
  const baselineVideo = createMemo(() =>
    props.comparison?.baseline ? videoFile(props.comparison.baseline.run) : null,
  );
  const currentVideo = createMemo(() =>
    props.comparison ? videoFile(props.comparison.current) : null,
  );

  return (
    <section class="grid gap-4">
      <Show
        when={!props.loading}
        fallback={
          <div class="flex min-h-24 items-center gap-2.5 rounded-xl border border-border-weak-base px-3.5 text-[11px] text-text-weak">
            <Icon name="refresh" size={13} class="animate-spin motion-reduce:animate-none" />
            Loading visual review…
          </div>
        }
      >
        <Show
          when={props.comparison?.baseline}
          fallback={
            <div class="grid gap-3 rounded-xl border border-border-weak-base bg-surface-base px-3.5 py-3.5">
              <div class="flex items-start gap-2.5">
                <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-surface-interactive-weak text-text-interactive-base">
                  <Icon name="scan" size={14} />
                </span>
                <div class="min-w-0">
                  <strong class="block text-[13px] font-semibold text-text-strong">
                    No approved baseline
                  </strong>
                  <p class="m-0 mt-0.5 text-[11px]/[1.45] text-text-weak">
                    Approve this completed run once. Future runs of this test on this device will
                    show only their changed step screens.
                  </p>
                </div>
              </div>
              <button
                type="button"
                class="inline-flex min-h-9 w-fit items-center gap-1.5 self-start rounded-lg bg-surface-interactive-base px-3 text-[12px] font-semibold text-text-on-interactive transition-colors hover:bg-surface-interactive-hover disabled:opacity-50"
                disabled={props.loading || props.approving}
                onClick={props.onApprove}
              >
                <Icon name="check" size={13} /> Use this run as baseline
              </button>
            </div>
          }
        >
          {(baseline) => (
            <>
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <strong class="block text-[13px] font-semibold text-text-strong">
                    Changes to review
                  </strong>
                  <p class="m-0 mt-0.5 text-[11px]/[1.45] text-text-weak">
                    {checking()
                      ? `Scanning ${pairs().length} captured step screens…`
                      : changed().length > 0
                        ? `${changed().length} changed step${changed().length === 1 ? "" : "s"} from the approved run.`
                        : "This run matches the approved screens."}
                  </p>
                </div>
              </div>
              <p class="-mt-2 m-0 text-[10px] text-text-weaker">
                Baseline approved {approvedAt(baseline().approvedAt)} on{" "}
                {targetLabel(baseline().run)}.
              </p>

              <Show when={error()}>
                <p class="m-0 rounded-lg border border-[color-mix(in_srgb,var(--icon-critical-base)_28%,var(--v2-border-border-muted))] px-2.5 py-2 text-[11px] text-[var(--icon-critical-base)]">
                  {error()}
                </p>
              </Show>

              <Show
                when={checking()}
                fallback={
                  <Show
                    when={changed().length > 0}
                    fallback={
                      <div class="grid gap-2 rounded-xl border border-border-weak-base bg-surface-base px-3.5 py-3.5">
                        <div class="flex items-center gap-2 text-[12px] font-medium text-text-strong">
                          <span class="size-1.5 rounded-full bg-[var(--icon-positive-base)]" />
                          No visual changes detected
                        </div>
                        <p class="m-0 text-[11px]/[1.45] text-text-weak">
                          {pairs().length > 0
                            ? "No review is needed. Keep the approved baseline for the next run."
                            : "These runs do not have matching step screenshots yet."}
                        </p>
                      </div>
                    }
                  >
                    <div class="grid gap-3">
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-weaker">
                          Changed steps
                        </span>
                        <span class="text-[10px] text-text-weaker">
                          {changed().length} to review
                        </span>
                      </div>
                      <div
                        class="flex max-h-36 flex-col gap-1 overflow-y-auto pr-1"
                        aria-label="Changed steps"
                      >
                        <For each={changed()}>
                          {(pair) => (
                            <button
                              type="button"
                              class={cn(
                                "grid min-h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2.5 text-left transition-colors",
                                selected() === pair.index
                                  ? "bg-surface-interactive-weak text-text-strong"
                                  : "hover:bg-surface-base-hover text-text-base",
                              )}
                              onClick={() => setSelected(pair.index)}
                            >
                              <span class="size-1.5 rounded-full bg-[var(--icon-warning-base)]" />
                              <span class="truncate text-[11.5px] font-medium">
                                {pair.index + 1}. {pair.title}
                              </span>
                              <span class="text-[10px] text-text-weaker">
                                {changeLabel(pair.ratio)}
                              </span>
                            </button>
                          )}
                        </For>
                      </div>
                      <Show when={selectedPair()}>
                        {(pair) => (
                          <DiffCanvas
                            baselineSrc={server.frameUrlForPersisted(
                              baseline().run,
                              pair().baseline,
                            )}
                            currentSrc={server.frameUrlForPersisted(
                              props.comparison!.current,
                              pair().current,
                            )}
                            split={split()}
                            onSplit={setSplit}
                            title={`Step ${pair().index + 1}: ${pair().title}`}
                          />
                        )}
                      </Show>
                      <div class="flex items-center justify-between gap-3 rounded-lg bg-surface-base px-2.5 py-2">
                        <span class="text-[10.5px]/[1.35] text-text-weak">
                          Keep baseline if any change is unexpected.
                        </span>
                        <button
                          type="button"
                          class="shrink-0 rounded-lg bg-surface-interactive-base px-2.5 py-2 text-[11px] font-semibold text-text-on-interactive transition-colors hover:bg-surface-interactive-hover disabled:opacity-50"
                          disabled={props.approving}
                          onClick={props.onApprove}
                        >
                          <Show
                            when={props.approving}
                            fallback={`Accept ${changed().length} change${changed().length === 1 ? "" : "s"}`}
                          >
                            Saving…
                          </Show>
                        </button>
                      </div>
                    </div>
                  </Show>
                }
              >
                <div class="flex min-h-24 items-center gap-2.5 rounded-xl border border-border-weak-base px-3.5 text-[11px] text-text-weak">
                  <Icon name="refresh" size={13} class="animate-spin motion-reduce:animate-none" />
                  Comparing the captured screens…
                </div>
              </Show>

              <Show when={baselineVideo() || currentVideo()}>
                <details class="group border-t border-border-weak-base pt-1">
                  <summary class="flex min-h-9 cursor-pointer list-none items-center justify-between text-[11px] font-medium text-text-base [&::-webkit-details-marker]:hidden">
                    Run video context
                    <Icon
                      name="chevron-down"
                      size={13}
                      class="transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <div
                    class={cn(
                      "grid gap-2 pb-2",
                      baselineVideo() && currentVideo() ? "grid-cols-2" : "grid-cols-1",
                    )}
                  >
                    <Show when={baselineVideo()}>
                      {(path) => (
                        <video
                          class="aspect-[9/16] w-full rounded-lg bg-surface-base"
                          controls
                          preload="metadata"
                          src={server.videoUrlForRun(baseline().run.id, path())}
                        />
                      )}
                    </Show>
                    <Show when={currentVideo()}>
                      {(path) => (
                        <video
                          class="aspect-[9/16] w-full rounded-lg bg-surface-base"
                          controls
                          preload="metadata"
                          src={server.videoUrlForRun(props.comparison!.current.id, path())}
                        />
                      )}
                    </Show>
                  </div>
                </details>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </section>
  );
}

function DiffCanvas(props: {
  title: string;
  baselineSrc: string;
  currentSrc: string;
  split: number;
  onSplit: (value: number) => void;
}) {
  return (
    <figure class="m-0 overflow-hidden rounded-xl border border-border-weak-base bg-surface-base">
      <figcaption class="flex items-center justify-between gap-2 border-b border-border-weak-base px-2.5 py-2">
        <span class="truncate text-[11px] font-medium text-text-strong">{props.title}</span>
        <span class="shrink-0 text-[10px] text-text-weaker">Drag to compare</span>
      </figcaption>
      <div class="relative isolate h-72 overflow-hidden bg-background-deep">
        <img
          class="absolute inset-0 h-full w-full object-contain"
          src={props.currentSrc}
          alt="Current captured screen"
        />
        <div
          class="pointer-events-none absolute inset-0 overflow-hidden"
          style={{ "clip-path": `inset(0 ${100 - props.split}% 0 0)` }}
        >
          <img
            class="absolute inset-0 h-full w-full object-contain"
            src={props.baselineSrc}
            alt="Approved baseline screen"
          />
        </div>
        <span class="pointer-events-none absolute left-2 top-2 rounded bg-background-deep/80 px-1.5 py-1 text-[10px] font-medium text-text-strong">
          Approved
        </span>
        <span class="pointer-events-none absolute right-2 top-2 rounded bg-background-deep/80 px-1.5 py-1 text-[10px] font-medium text-text-strong">
          Current
        </span>
        <span
          class="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{ left: `${props.split}%` }}
        >
          <span class="absolute top-1/2 left-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-background-deep text-text-strong shadow-lg">
            <Icon name="move" size={12} />
          </span>
        </span>
        <input
          class="absolute inset-0 z-20 h-full w-full cursor-ew-resize opacity-0"
          type="range"
          min="0"
          max="100"
          value={props.split}
          aria-label="Reveal approved baseline or current screen"
          onInput={(event) => props.onSplit(Number(event.currentTarget.value))}
        />
      </div>
    </figure>
  );
}
