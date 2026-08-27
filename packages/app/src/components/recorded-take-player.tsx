import { For, Show, createSignal } from "solid-js";
import type { RecordedNodeEvidence, RecordingClip } from "@relay/protocol";
import type { RecipeStep } from "../context/server";
import type { RecordingTake } from "../context/recorder";
import { cn } from "../lib/cn";
import { softTruncate } from "../lib/human-error";
import { sentenceForStep as describeStep } from "../lib/step-sentence";
import { recordedTargetNodes, targetHighlight, targetPointGuide } from "../lib/target-inspector";
import { CoordinateTapPreview } from "./device-stage-previews";
import { EmptyState } from "./empty-state";
import { Icon } from "./icon";
import { OrientedScreenshot, type ScreenshotOrientationEvidence } from "./oriented-screenshot";
import { StepPlaybackPreview } from "./step-playback-preview";
import { SwipePathPreview } from "./swipe-path-preview";

const controlButton =
  "grid min-h-11 min-w-11 place-items-center rounded-lg px-1.5 text-caption text-[var(--text-base)] transition-colors duration-press hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)] disabled:cursor-not-allowed disabled:opacity-35";
const reviewEvidenceShell =
  "relative overflow-hidden rounded-2xl bg-[var(--phone-screen)] shadow-[0_0_0_1px_var(--border-weak-base),0_24px_54px_-32px_color-mix(in_srgb,var(--surface-float-base)_72%,transparent)]";

/** Frames are evidence, not a fake video. This component accepts a real video
 * when the recorder later persists one, without changing the review surface. */
export function RecordedTakePlayer(props: {
  take: RecordingTake;
  selectedIndex: number;
  onSelect: (index: number) => void;
  screenshotFor: (step: RecipeStep | undefined, index: number) => string;
  orientationEvidence?: ScreenshotOrientationEvidence;
  videoSrc?: string;
  clip?: RecordingClip;
  onClip?: (clip: RecordingClip) => void;
}) {
  const [durationMs, setDurationMs] = createSignal(0);
  const [frameHovered, setFrameHovered] = createSignal(false);
  const [hoverNode, setHoverNode] = createSignal<RecordedNodeEvidence | null>(null);
  let video: HTMLVideoElement | undefined;
  let frameSurface: HTMLDivElement | undefined;
  const lastIndex = () => Math.max(0, props.take.steps.length - 1);
  const selectedIndex = () => Math.min(lastIndex(), Math.max(0, props.selectedIndex));
  const step = () => props.take.steps[selectedIndex()];
  const imageSrc = () => props.screenshotFor(step(), selectedIndex());
  const title = () => {
    const selected = step();
    if (!selected) return "No recorded action";
    if (selected.kind === "type") {
      const verb = selected.mode === "replace" ? "Replace text" : "Type text";
      const lines = selected.text.split("\n").length;
      return softTruncate(
        `${verb} · ${selected.text.length} characters${lines > 1 ? ` across ${lines} lines` : ""}`,
        96,
      );
    }
    return softTruncate(describeStep(selected), 96);
  };
  const playbackBounds = () => {
    const selected = step();
    const viewport = props.orientationEvidence?.logicalViewport;
    if (viewport && viewport.width > 0 && viewport.height > 0) return viewport;
    if (selected?.evidence?.deviceBounds) return selected.evidence.deviceBounds;
    if (selected?.kind === "tap") {
      return selected.target.point?.referenceBounds ?? { width: 834, height: 1112 };
    }
    if (selected?.kind === "swipe") {
      return (
        selected.from.referenceBounds ?? selected.to.referenceBounds ?? { width: 834, height: 1112 }
      );
    }
    return { width: 834, height: 1112 };
  };
  const treeNodes = () => recordedTargetNodes(step()?.evidence);
  const treeActive = () => !props.videoSrc && treeNodes().length > 0;
  const nodeOutlines = () => {
    if (!frameHovered() || !treeActive()) return [];
    const bounds = step()?.evidence?.deviceBounds ?? playbackBounds();
    return treeNodes()
      .map((node) => targetHighlight(node, bounds))
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
  };
  const hoverHighlight = () => {
    if (!frameHovered() || !treeActive()) return undefined;
    const bounds = step()?.evidence?.deviceBounds ?? playbackBounds();
    return targetHighlight(hoverNode() ?? undefined, bounds);
  };
  const hoverLabel = () => {
    const node = hoverNode();
    if (!node) return undefined;
    const name = (
      node.label ??
      node.value ??
      node.identifier ??
      node.role ??
      node.type ??
      ""
    ).trim();
    return name || undefined;
  };
  function updateHover(clientX: number, clientY: number): void {
    if (!treeActive() || !frameSurface) {
      setHoverNode(null);
      return;
    }
    const bounds = step()?.evidence?.deviceBounds ?? playbackBounds();
    const rect = frameSurface.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      setHoverNode(null);
      return;
    }
    const x = ((clientX - rect.left) / rect.width) * bounds.width;
    const y = ((clientY - rect.top) / rect.height) * bounds.height;
    // Prefer the smallest node under the pointer — same as live inspection.
    const hit = treeNodes().find((node) => {
      const nodeRect = node.rect;
      return (
        nodeRect &&
        x >= nodeRect.x &&
        x <= nodeRect.x + nodeRect.width &&
        y >= nodeRect.y &&
        y <= nodeRect.y + nodeRect.height
      );
    });
    setHoverNode(hit ?? null);
  }
  const coordinateGuide = () => {
    const selected = step();
    if (selected?.kind !== "tap") return undefined;
    const point = selected.target.point ?? selected.evidence?.pointer;
    if (!point) return undefined;
    return targetPointGuide(point, playbackBounds());
  };
  const swipePreview = () => {
    const selected = step();
    if (selected?.kind !== "swipe") return undefined;
    return {
      from: selected.from,
      to: selected.to,
      bounds: playbackBounds(),
      durationMs: selected.durationMs,
    };
  };
  const previous = () => props.onSelect(Math.max(0, selectedIndex() - 1));
  const next = () => props.onSelect(Math.min(lastIndex(), selectedIndex() + 1));
  const hasMultipleFrames = () => props.take.steps.length > 1;
  const evidenceAspectRatio = () => {
    const viewport = props.orientationEvidence?.logicalViewport;
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) return 9 / 19.5;
    return viewport.width / viewport.height;
  };
  const evidenceShellStyle = () => {
    const ratio = evidenceAspectRatio();
    return {
      "aspect-ratio": String(ratio),
      width: ratio >= 1 ? "min(760px, calc(100% - 48px))" : "auto",
      height: ratio >= 1 ? "auto" : "min(700px, calc(100% - 148px))",
      "max-width": "calc(100% - 48px)",
      "max-height": "calc(100% - 148px)",
    };
  };

  return (
    <section
      class="relative flex h-full min-h-0 flex-col items-center justify-center gap-5 overflow-hidden px-6 py-4"
      aria-label="Recorded action preview"
    >
      {/* Frame position lives only in the bottom pager — no duplicate badge. */}

      <Show
        when={Boolean(props.videoSrc || imageSrc())}
        fallback={
          <div class="grid w-full max-w-[340px] place-items-center rounded-2xl bg-[var(--surface-base)] px-4 py-6 text-center shadow-[inset_0_0_0_1px_var(--border-weak-base)]">
            <EmptyState
              size="sm"
              icon="camera"
              title="No screen captured"
              description="This automatic path has no frame or video to preview."
            />
          </div>
        }
      >
        <div
          data-evidence-frame
          class={cn(reviewEvidenceShell, "relative z-[1] shrink-0")}
          style={evidenceShellStyle()}
        >
          <div
            ref={(element) => {
              frameSurface = element;
            }}
            class="relative h-full w-full overflow-hidden bg-[var(--phone-screen)]"
            onMouseEnter={() => setFrameHovered(true)}
            onMouseMove={(event) => {
              setFrameHovered(true);
              updateHover(event.clientX, event.clientY);
            }}
            onMouseLeave={() => {
              setFrameHovered(false);
              setHoverNode(null);
            }}
          >
            <Show
              when={props.videoSrc}
              fallback={
                <OrientedScreenshot
                  class="pointer-events-none size-full object-contain"
                  src={imageSrc()}
                  alt={`Recorded screen for ${title()}`}
                  evidence={props.orientationEvidence}
                />
              }
            >
              {(src) => (
                <video
                  ref={(element) => {
                    video = element;
                  }}
                  class="h-full w-full object-contain"
                  src={src()}
                  controls
                  playsinline
                  aria-label="Recorded take video"
                  onLoadedMetadata={(event) => {
                    const nextDuration = Math.max(
                      0,
                      Math.round(event.currentTarget.duration * 1000),
                    );
                    setDurationMs(nextDuration);
                    if (!props.clip && nextDuration > 0) {
                      props.onClip?.({ startMs: 0, endMs: nextDuration });
                    }
                  }}
                  onPlay={(event) => {
                    const clip = props.clip;
                    if (
                      clip &&
                      (event.currentTarget.currentTime * 1000 < clip.startMs ||
                        event.currentTarget.currentTime * 1000 >= clip.endMs)
                    ) {
                      event.currentTarget.currentTime = clip.startMs / 1000;
                    }
                  }}
                  onTimeUpdate={(event) => {
                    const clip = props.clip;
                    if (clip && event.currentTarget.currentTime * 1000 >= clip.endMs) {
                      event.currentTarget.pause();
                      event.currentTarget.currentTime = clip.startMs / 1000;
                    }
                  }}
                />
              )}
            </Show>
            <Show when={!props.videoSrc && frameHovered()}>
              <For each={nodeOutlines()}>
                {(highlight) => (
                  <i
                    class="pointer-events-none absolute z-[2] rounded-sm border border-[color-mix(in_srgb,var(--text-interactive-base)_34%,transparent)]"
                    style={highlight}
                    data-recorded-node-outline
                    aria-hidden="true"
                  />
                )}
              </For>
            </Show>
            <Show when={!props.videoSrc ? hoverHighlight() : undefined}>
              {(highlight) => (
                <div class="pointer-events-none absolute inset-0 z-[4]" aria-hidden="true">
                  <i
                    class="absolute rounded border-[1.5px] border-[var(--text-interactive-base)] bg-[color-mix(in_srgb,var(--text-interactive-base)_12%,transparent)] shadow-[0_0_0_1px_rgb(255_255_255/16%)]"
                    style={highlight()}
                  />
                  <Show when={hoverLabel()}>
                    {(label) => (
                      <span
                        class="absolute z-[5] max-w-[62%] -translate-y-[calc(100%+6px)] truncate rounded-md bg-[var(--text-interactive-base)] px-1.5 py-0.5 text-micro leading-snug font-medium text-[var(--text-on-brand-base,white)] shadow-sm"
                        style={{ left: highlight().left, top: highlight().top }}
                      >
                        {label()}
                      </span>
                    )}
                  </Show>
                </div>
              )}
            </Show>
            <Show when={!props.videoSrc ? step() : undefined}>
              {(selected) => (
                <>
                  <Show when={coordinateGuide()}>
                    {(guide) => <CoordinateTapPreview guide={guide()} />}
                  </Show>
                  <Show when={swipePreview()}>
                    {(swipe) => (
                      <SwipePathPreview
                        from={swipe().from}
                        to={swipe().to}
                        bounds={swipe().bounds}
                        interactive={false}
                        onPoint={() => undefined}
                        previewToken={selectedIndex()}
                        previewDurationMs={swipe().durationMs}
                      />
                    )}
                  </Show>
                  <Show
                    when={
                      selected().kind !== "tap" && selected().kind !== "swipe"
                        ? selected()
                        : undefined
                    }
                  >
                    {(playbackStep) => (
                      <StepPlaybackPreview step={playbackStep()} bounds={playbackBounds()} />
                    )}
                  </Show>
                </>
              )}
            </Show>
          </div>
        </div>
      </Show>

      <Show when={props.videoSrc && durationMs() > 0 ? props.clip : undefined}>
        {(clip) => {
          const minimumGap = 100;
          const formatTime = (milliseconds: number) => `${(milliseconds / 1000).toFixed(1)}s`;
          return (
            <section class="mt-3 w-full max-w-[420px] rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-3 py-2.5">
              <div class="flex items-center justify-between">
                <span class="text-micro font-semibold text-[var(--text-strong)]">Trim video</span>
                <span class="text-micro text-[var(--text-weak)]">
                  Original recording is preserved
                </span>
              </div>
              <div class="mt-2 grid grid-cols-[36px_1fr_36px] items-center gap-2">
                <span class="font-mono text-micro tabular-nums text-[var(--text-weak)]">
                  {formatTime(clip().startMs)}
                </span>
                <input
                  type="range"
                  class="h-4 w-full accent-[var(--text-interactive-base)]"
                  aria-label="Video start"
                  min="0"
                  max={Math.max(0, clip().endMs - minimumGap)}
                  step="100"
                  value={clip().startMs}
                  onInput={(event) => {
                    const startMs = Number(event.currentTarget.value);
                    props.onClip?.({ startMs, endMs: clip().endMs });
                    if (video) video.currentTime = startMs / 1000;
                  }}
                />
                <span class="text-right text-micro text-[var(--text-weak)]">Start</span>
                <span class="font-mono text-micro tabular-nums text-[var(--text-weak)]">
                  {formatTime(clip().endMs)}
                </span>
                <input
                  type="range"
                  class="h-4 w-full accent-[var(--text-interactive-base)]"
                  aria-label="Video end"
                  min={Math.min(durationMs(), clip().startMs + minimumGap)}
                  max={durationMs()}
                  step="100"
                  value={clip().endMs}
                  onInput={(event) =>
                    props.onClip?.({
                      startMs: clip().startMs,
                      endMs: Number(event.currentTarget.value),
                    })
                  }
                />
                <span class="text-right text-micro text-[var(--text-weak)]">End</span>
              </div>
            </section>
          );
        }}
      </Show>

      <Show when={hasMultipleFrames() || Boolean(step())}>
        <div class="mt-1 flex max-w-[min(640px,100%)] flex-col items-center gap-2.5 pt-1">
          <span class="line-clamp-2 max-w-full px-2 text-center text-caption leading-snug font-medium text-[var(--text-strong)]">
            {title()}
          </span>
          <Show when={!props.videoSrc && frameHovered() && !treeActive()}>
            <span class="text-micro text-[var(--text-weak)]">
              No accessibility labels on this frame
            </span>
          </Show>
          <Show when={hasMultipleFrames()}>
            <div class="inline-flex items-center gap-1 rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-1 shadow-[0_2px_8px_rgb(0_0_0/12%)]">
              <button
                type="button"
                class={controlButton}
                aria-label="Previous recorded action"
                title="Previous action"
                disabled={selectedIndex() === 0}
                onClick={previous}
              >
                <Icon name="chevron-left" size={13} />
              </button>
              <span
                class="min-w-16 px-1 text-center text-micro tabular-nums text-[var(--text-weak)]"
                aria-live="polite"
              >
                Step {selectedIndex() + 1} of {props.take.steps.length}
              </span>
              <button
                type="button"
                class={controlButton}
                aria-label="Next recorded action"
                title="Next action"
                disabled={selectedIndex() === lastIndex()}
                onClick={next}
              >
                <Icon name="chevron-right" size={13} />
              </button>
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
}
