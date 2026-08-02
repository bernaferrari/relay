import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type {
  VisualComparison,
  VisualFrameDiff,
  VisualRegion,
  VisualReviewAction,
  VisualReviewDecision,
} from "@relay/protocol";
import type { PersistedRun } from "../context/server";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

function approvedAt(value: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value);
}

function targetLabel(run: PersistedRun): string {
  return run.targetProfile?.name ?? run.serial ?? "this device";
}

function changeLabel(frame: VisualFrameDiff): string {
  if (frame.changeRatio === undefined) return frame.code.replace("FRAME_", "").toLowerCase();
  if (frame.changeRatio === 0) return "No change";
  return `${Math.max(0.1, frame.changeRatio * 100).toFixed(1)}% changed`;
}

function pairedFrames(comparison: VisualComparison | null): VisualFrameDiff[] {
  return comparison?.diff.frames.filter((frame) => frame.approved && frame.latest) ?? [];
}

export function VisualDiffReview(props: {
  comparison: VisualComparison | null;
  current: PersistedRun;
  decision: VisualReviewDecision | null;
  loading: boolean;
  onReview: (action: VisualReviewAction) => void;
  onPolicyChange: (regions: VisualRegion[]) => void;
  approving?: boolean;
  policyBusy?: boolean;
}) {
  const server = useServer();
  const [selected, setSelected] = createSignal(0);
  const frames = createMemo(() => pairedFrames(props.comparison));
  const changed = createMemo(() => frames().filter((frame) => frame.code === "FRAME_CHANGED"));
  const selectedFrame = createMemo(
    () =>
      frames().find((frame) => frame.index === selected()) ?? changed()[0] ?? frames()[0] ?? null,
  );
  createEffect(() => {
    const comparisonId = props.comparison?.id;
    if (!comparisonId) return;
    setSelected(changed()[0]?.index ?? frames()[0]?.index ?? 0);
  });

  return (
    <section class="grid gap-4">
      <Show
        when={!props.loading}
        fallback={
          <div class="flex min-h-24 items-center gap-2.5 rounded-xl border border-border-weak-base px-3.5 text-[11px] text-text-weak">
            <Icon name="refresh" size={13} class="animate-spin motion-reduce:animate-none" />
            Comparing approved and current screens…
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
                    Set the first approved version
                  </strong>
                  <p class="m-0 mt-0.5 text-[11px]/[1.45] text-text-weak">
                    Approve this completed run once. Relay will compare future runs only with this
                    target and keep the approval author and evidence.
                  </p>
                </div>
              </div>
              <button
                type="button"
                class="inline-flex min-h-10 w-fit items-center gap-1.5 self-start rounded-lg bg-surface-interactive-base px-3 text-[12px] font-semibold text-text-on-interactive transition-colors hover:bg-surface-interactive-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)] disabled:opacity-50"
                disabled={props.loading || props.approving}
                onClick={() => props.onReview("approve-new-baseline")}
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
                    {changed().length > 0 ? "Changes to review" : "Screens match"}
                  </strong>
                  <p class="m-0 mt-0.5 text-[11px]/[1.45] text-text-weak">
                    {changed().length > 0
                      ? `${changed().length} captured screen${changed().length === 1 ? " is" : "s are"} outside the approved tolerance.`
                      : "No reviewed area changed enough to require attention."}
                  </p>
                </div>
                <span
                  class={cn(
                    "rounded-full px-2 py-1 text-[10px] font-semibold",
                    changed().length > 0
                      ? "bg-[color-mix(in_srgb,var(--icon-warning-base)_13%,transparent)] text-[var(--icon-warning-base)]"
                      : "bg-[color-mix(in_srgb,var(--icon-success-base)_13%,transparent)] text-[var(--icon-success-base)]",
                  )}
                >
                  {changed().length > 0 ? `${changed().length} changed` : "Matched"}
                </span>
              </div>
              <p class="-mt-2 m-0 text-[10px] text-text-weaker">
                Approved {approvedAt(baseline().approvedAt)} on {targetLabel(props.current)} ·
                policy revision {props.comparison?.policy.revision ?? 0}
              </p>

              <Show
                when={frames().length > 0}
                fallback={
                  <div class="rounded-xl border border-border-weak-base bg-surface-base px-3.5 py-3 text-[11px]/[1.45] text-text-weak">
                    These runs do not yet contain matching captured screens.
                  </div>
                }
              >
                <div class="grid gap-3">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-weaker">
                      Captured screens
                    </span>
                    <span class="text-[10px] text-text-weaker">
                      {changed().length} to review · {frames().length} total
                    </span>
                  </div>
                  <div
                    class="flex max-h-36 flex-col gap-1 overflow-y-auto pr-1"
                    aria-label="Captured screens"
                  >
                    <For each={frames()}>
                      {(frame) => (
                        <button
                          type="button"
                          class={cn(
                            "grid min-h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--border-focus)]",
                            selectedFrame()?.index === frame.index
                              ? "bg-surface-interactive-weak text-text-strong"
                              : "text-text-base hover:bg-surface-base-hover",
                          )}
                          onClick={() => setSelected(frame.index)}
                        >
                          <span
                            class={cn(
                              "size-1.5 rounded-full",
                              frame.code === "FRAME_CHANGED"
                                ? "bg-[var(--icon-warning-base)]"
                                : "bg-[var(--icon-success-base)]",
                            )}
                          />
                          <span class="truncate text-[11.5px] font-medium">
                            {frame.index + 1}. {frame.latest?.caption ?? "Captured screen"}
                          </span>
                          <span class="text-[10px] text-text-weaker">{changeLabel(frame)}</span>
                        </button>
                      )}
                    </For>
                  </div>
                  <Show when={selectedFrame()}>
                    {(frame) => {
                      const currentFrame = () => props.current.frames[frame().index];
                      return (
                        <Show when={currentFrame()}>
                          {(current) => (
                            <DiffCanvas
                              baselineSrc={server.visualBaselineFrameUrl(
                                props.current.id,
                                frame().index,
                              )}
                              currentSrc={server.frameUrlForPersisted(props.current, current())}
                              frame={frame()}
                              regions={
                                props.comparison?.policy.regions.filter(
                                  (region) => region.frameIndex === frame().index,
                                ) ?? []
                              }
                              busy={props.policyBusy}
                              onRegionsChange={(next) =>
                                props.onPolicyChange([
                                  ...(props.comparison?.policy.regions.filter(
                                    (region) => region.frameIndex !== frame().index,
                                  ) ?? []),
                                  ...next,
                                ])
                              }
                            />
                          )}
                        </Show>
                      );
                    }}
                  </Show>
                  <VisualReviewActions
                    comparison={props.comparison}
                    decision={props.decision}
                    busy={props.approving}
                    onReview={props.onReview}
                  />
                </div>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </section>
  );
}

function VisualReviewActions(props: {
  comparison: VisualComparison | null;
  decision: VisualReviewDecision | null;
  busy?: boolean;
  onReview: (action: VisualReviewAction) => void;
}) {
  const actions: Array<{ action: VisualReviewAction; label: string; primary?: boolean }> = [
    { action: "keep-baseline", label: "Keep baseline" },
    { action: "fix-connection", label: "Fix connection" },
    { action: "retry", label: "Retry" },
    { action: "mark-expected-variation", label: "Expected variation" },
    { action: "approve-new-baseline", label: "Approve new baseline", primary: true },
  ];
  return (
    <div class="grid gap-2 rounded-xl border border-border-weak-base bg-surface-base p-2.5">
      <div class="flex items-center justify-between gap-3 px-0.5">
        <span class="text-[10.5px]/[1.35] text-text-weak">
          Choose what this change means. Relay records the decision and its author.
        </span>
        <Show when={props.comparison}>
          {(comparison) => (
            <code class="shrink-0 text-[9px] text-text-weaker">
              {comparison().code.replace("VISUAL_", "").toLowerCase()}
            </code>
          )}
        </Show>
      </div>
      <div
        class="flex flex-wrap justify-end gap-1.5"
        role="group"
        aria-label="Visual review decision"
      >
        <For each={actions}>
          {(item) => (
            <button
              type="button"
              class={cn(
                "min-h-10 rounded-lg px-2.5 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)] disabled:cursor-wait disabled:opacity-50",
                item.primary
                  ? "bg-surface-interactive-base text-text-on-interactive hover:bg-surface-interactive-hover"
                  : "border border-border-weak-base bg-background-base text-text-base hover:bg-surface-base-hover",
              )}
              disabled={props.busy || !props.comparison}
              onClick={() => props.onReview(item.action)}
            >
              {props.busy && item.primary ? "Saving…" : item.label}
            </button>
          )}
        </For>
      </div>
      <Show when={props.decision}>
        {(decision) => (
          <p
            class="m-0 rounded-lg bg-[color-mix(in_srgb,var(--icon-success-base)_12%,transparent)] px-2.5 py-2 text-[10.5px]/[1.4] text-[var(--icon-success-base)]"
            role="status"
          >
            Decision recorded as {decision().action.replaceAll("-", " ")}.
          </p>
        )}
      </Show>
    </div>
  );
}

function DiffCanvas(props: {
  baselineSrc: string;
  currentSrc: string;
  frame: VisualFrameDiff;
  regions: VisualRegion[];
  busy?: boolean;
  onRegionsChange: (regions: VisualRegion[]) => void;
}) {
  const [split, setSplit] = createSignal(50);
  const [tool, setTool] = createSignal<"compare" | "ignore" | null>(null);
  const [draft, setDraft] = createSignal<VisualRegion | null>(null);
  let stage: HTMLDivElement | undefined;

  const point = (event: PointerEvent) => {
    const bounds = stage!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const beginRegion = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    const mode = tool();
    if (!mode || props.busy) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event);
    setDraft({
      id: `region-${Date.now().toString(36)}`,
      name: mode === "compare" ? "Compared area" : "Ignored area",
      mode,
      frameIndex: props.frame.index,
      ...start,
      width: 0,
      height: 0,
    });
  };
  const moveRegion = (event: PointerEvent) => {
    const current = draft();
    if (!current) return;
    const next = point(event);
    setDraft({
      ...current,
      x: Math.min(current.x, next.x),
      y: Math.min(current.y, next.y),
      width: Math.abs(next.x - current.x),
      height: Math.abs(next.y - current.y),
    });
  };
  const finishRegion = () => {
    const region = draft();
    setDraft(null);
    if (!region || region.width < 0.02 || region.height < 0.02) return;
    props.onRegionsChange([...props.regions, region]);
    setTool(null);
  };

  return (
    <figure class="m-0 overflow-hidden rounded-xl border border-border-weak-base bg-surface-base">
      <figcaption class="grid gap-2 border-b border-border-weak-base px-2.5 py-2">
        <div class="flex items-center justify-between gap-2">
          <span class="truncate text-[11px] font-medium text-text-strong">
            {props.frame.latest?.caption ?? `Screen ${props.frame.index + 1}`}
          </span>
          <span class="shrink-0 text-[10px] text-text-weaker">
            {tool() ? "Drag on the screen" : "Drag divider to compare"}
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            class={cn(
              "min-h-9 rounded-lg px-2.5 text-[10.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]",
              tool() === "compare"
                ? "bg-surface-interactive-base text-text-on-interactive"
                : "bg-surface-interactive-weak text-text-interactive-base hover:bg-surface-base-hover",
            )}
            aria-pressed={tool() === "compare"}
            onClick={() => setTool((current) => (current === "compare" ? null : "compare"))}
          >
            Compare area
          </button>
          <button
            type="button"
            class={cn(
              "min-h-9 rounded-lg px-2.5 text-[10.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]",
              tool() === "ignore"
                ? "bg-[var(--icon-warning-base)] text-white"
                : "bg-[color-mix(in_srgb,var(--icon-warning-base)_12%,transparent)] text-[var(--icon-warning-base)] hover:bg-[color-mix(in_srgb,var(--icon-warning-base)_18%,transparent)]",
            )}
            aria-pressed={tool() === "ignore"}
            onClick={() => setTool((current) => (current === "ignore" ? null : "ignore"))}
          >
            Ignore area
          </button>
          <Show when={props.regions.length === 0}>
            <span class="text-[10px] text-text-weaker">The whole screen is compared.</span>
          </Show>
          <For each={props.regions}>
            {(region) => (
              <button
                type="button"
                class={cn(
                  "inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-[10px] font-medium",
                  region.mode === "compare"
                    ? "bg-surface-interactive-weak text-text-interactive-base"
                    : "bg-[color-mix(in_srgb,var(--icon-warning-base)_12%,transparent)] text-[var(--icon-warning-base)]",
                )}
                aria-label={`Remove ${region.name}`}
                disabled={props.busy}
                onClick={() =>
                  props.onRegionsChange(props.regions.filter((item) => item.id !== region.id))
                }
              >
                {region.mode === "compare" ? "Compare" : "Ignore"} <Icon name="x" size={9} />
              </button>
            )}
          </For>
          <Show when={props.busy}>
            <span class="inline-flex items-center gap-1 text-[10px] text-text-weaker">
              <Icon name="refresh" size={10} class="animate-spin motion-reduce:animate-none" />
              Saving…
            </span>
          </Show>
        </div>
      </figcaption>
      <div class="flex justify-center bg-background-deep p-3">
        <div
          ref={(element) => {
            stage = element;
          }}
          class={cn(
            "relative inline-grid max-w-full touch-none select-none overflow-hidden rounded-lg",
            tool() &&
              "cursor-crosshair ring-2 ring-[var(--border-focus)] ring-offset-2 ring-offset-background-deep",
          )}
          onPointerDown={beginRegion}
          onPointerMove={moveRegion}
          onPointerUp={finishRegion}
          onPointerCancel={() => setDraft(null)}
        >
          <img
            class="col-start-1 row-start-1 max-h-[min(48vh,430px)] max-w-full object-contain"
            src={props.currentSrc}
            alt="Current captured screen"
            draggable={false}
          />
          <div
            class="pointer-events-none absolute inset-0 overflow-hidden"
            style={{ "clip-path": `inset(0 ${100 - split()}% 0 0)` }}
          >
            <img
              class="h-full w-full object-fill"
              src={props.baselineSrc}
              alt="Approved baseline screen"
              draggable={false}
            />
          </div>
          <For each={[...props.regions, ...(draft() ? [draft()!] : [])]}>
            {(region) => (
              <span
                class={cn(
                  "pointer-events-none absolute z-20 border-2",
                  region.mode === "compare"
                    ? "border-[var(--text-interactive-base)] bg-[color-mix(in_srgb,var(--text-interactive-base)_10%,transparent)]"
                    : "border-[var(--icon-warning-base)] bg-[color-mix(in_srgb,var(--icon-warning-base)_16%,transparent)] [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_6px,color-mix(in_srgb,var(--icon-warning-base)_18%,transparent)_6px,color-mix(in_srgb,var(--icon-warning-base)_18%,transparent)_10px)]",
                )}
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.width * 100}%`,
                  height: `${region.height * 100}%`,
                }}
              />
            )}
          </For>
          <Show when={!tool()}>
            <span
              class="pointer-events-none absolute inset-y-0 z-10 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={{ left: `${split()}%` }}
            >
              <span class="absolute left-1/2 top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-background-deep text-text-strong shadow-lg">
                <Icon name="move" size={12} />
              </span>
            </span>
            <input
              class="absolute inset-0 z-30 h-full w-full cursor-ew-resize opacity-0"
              type="range"
              min="0"
              max="100"
              value={split()}
              aria-label="Reveal approved baseline or current screen"
              onInput={(event) => setSplit(Number(event.currentTarget.value))}
            />
          </Show>
          <span class="pointer-events-none absolute left-2 top-2 z-20 rounded bg-background-deep/80 px-1.5 py-1 text-[10px] font-medium text-text-strong">
            Approved
          </span>
          <span class="pointer-events-none absolute right-2 top-2 z-20 rounded bg-background-deep/80 px-1.5 py-1 text-[10px] font-medium text-text-strong">
            Current
          </span>
        </div>
      </div>
    </figure>
  );
}
