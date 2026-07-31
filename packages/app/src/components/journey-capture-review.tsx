import { For, Show, createSignal } from "solid-js";
import type { JourneyGraphScreen, JourneyVideoClip } from "@relay/protocol";
import type { RecipeStep } from "../context/server";
import { cn } from "../lib/cn";
import type { TakeDestination } from "../lib/journey-graph";
import { phoneBezel, phoneScreen } from "../lib/ui";
import { describeStep, type RecordingTake } from "../context/recorder";
import { Icon } from "./icon";
import { ChooseDeviceEmptyState } from "./choose-device-empty-state";

const controlButton =
  "grid h-7 min-w-7 place-items-center rounded-[7px] px-1.5 text-[10px] text-[var(--text-base)] transition-colors duration-100 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-border-strong-focus";
const primaryButton =
  "inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-[var(--product-accent-soft)] px-2.5 text-[10.5px] font-semibold text-[var(--text-interactive-base)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35";
const secondaryButton =
  "inline-flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-[10px] font-medium text-[var(--text-base)] transition-colors duration-100 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-border-strong-focus";

/** A compact capture status for the live device drawer. Once stopped, review
 * moves into TakeReviewWorkspace so it never competes with the live device. */
export function TakeCaptureBar(props: {
  take: RecordingTake;
  contextLabel?: string;
  onStop: () => void;
  onOpenDevice: () => void;
}) {
  const count = () => props.take.steps.length;
  const actionLabel = () =>
    count() === 0 ? "No actions yet" : `${count()} action${count() === 1 ? "" : "s"}`;
  return (
    <section class="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-4">
      <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2 text-[11px]">
          <i class="size-1.5 shrink-0 rounded-full bg-[var(--icon-critical-base)]" />
          <strong class="shrink-0 font-semibold text-[var(--text-strong)]">
            {props.contextLabel ? "Recording transition" : "Recording"}
          </strong>
          <span class="truncate text-[var(--text-weak)]">
            {props.contextLabel ? `${props.contextLabel} · ${actionLabel()}` : actionLabel()}
          </span>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class={controlButton}
          aria-label="Open device workspace"
          title="Open device workspace"
          onClick={props.onOpenDevice}
        >
          <Icon name="arrow-right" size={13} />
        </button>
        <button type="button" class={primaryButton} onClick={props.onStop}>
          <Icon name="square" size={11} /> Stop
        </button>
      </div>
    </section>
  );
}

/** A stopped take is a decision, not a live-control state. The list decides
 * what survives and the player provides the immutable recorded frame. */
export function TakeReviewSidebar(props: {
  take: RecordingTake;
  selectedIndex: number;
  sourceTitle: string;
  screens: JourneyGraphScreen[];
  destination: TakeDestination;
  onSelect: (index: number) => void;
  onDestination: (destination: TakeDestination) => void;
  onKeep: () => void;
  onDiscard: () => void;
  onReplay: () => void;
  onRewrite: () => void;
  onRemove: (index: number) => void;
  replayState: "idle" | "running" | "passed" | "failed";
  replayError?: string;
}) {
  const count = () => props.take.steps.length;
  const actionLabel = () => `${count()} action${count() === 1 ? "" : "s"}`;
  return (
    <aside
      class="flex min-h-0 min-w-0 flex-col border-r border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)]"
      aria-label="Review captured actions"
    >
      <header class="shrink-0 border-b border-[var(--v2-border-border-muted)] px-4 py-3.5">
        <span class="text-[9.5px] font-semibold tracking-[0.12em] text-[var(--text-weak)] uppercase">
          Capture
        </span>
        <strong class="mt-1 block text-[15px] font-semibold tracking-[-0.018em] text-[var(--text-strong)]">
          Review this take
        </strong>
        <p class="m-0 mt-1 text-[11px]/[1.45] text-[var(--text-weak)]">
          {actionLabel()} from {props.sourceTitle}. Remove anything accidental, then choose its
          destination.
        </p>
      </header>

      <div class="min-h-0 flex-1 overflow-auto px-2.5 py-2.5">
        <Show
          when={count() > 0}
          fallback={
            <div class="grid h-full place-items-center px-5 text-center text-[11px]/[1.5] text-[var(--text-weak)]">
              No actions left. Discard this recording or go back to the device and record again.
            </div>
          }
        >
          <ol class="m-0 grid list-none gap-1 p-0">
            <For each={props.take.steps}>
              {(step, displayIndex) => {
                const index = () => displayIndex();
                const description = () => describeStep(step);
                return (
                  <li
                    class={cn(
                      "group flex min-h-11 min-w-0 items-center gap-2.5 rounded-[9px] px-2.5 text-[11.5px] text-[var(--text-base)] transition-colors",
                      props.selectedIndex === index()
                        ? "bg-[var(--product-accent-soft)] text-[var(--text-strong)]"
                        : "hover:bg-[var(--v2-background-bg-layer-02)]",
                    )}
                  >
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      aria-current={props.selectedIndex === index() ? "step" : undefined}
                      onClick={() => props.onSelect(index())}
                    >
                      <span
                        class={cn(
                          "grid size-6 shrink-0 place-items-center rounded-[6px] font-mono text-[9.5px]",
                          props.selectedIndex === index()
                            ? "bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_20%,transparent)] text-[var(--text-interactive-base)]"
                            : "bg-[var(--v2-background-bg-layer-02)] text-[var(--text-weak)]",
                        )}
                      >
                        {String(index() + 1).padStart(2, "0")}
                      </span>
                      <span class="min-w-0 flex-1 truncate font-medium">{description()}</span>
                    </button>
                    <button
                      type="button"
                      class="grid size-6 shrink-0 place-items-center rounded-[6px] text-[var(--text-weak)] opacity-0 transition-[background-color,color,opacity] duration-150 group-hover:opacity-100 hover:bg-[var(--v2-background-bg-layer-03)] hover:text-[var(--icon-critical-base)] focus-visible:opacity-100"
                      aria-label={`Remove ${description()}`}
                      title="Remove action"
                      onClick={() => props.onRemove(index())}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </li>
                );
              }}
            </For>
          </ol>
          <section class="mt-4 border-t border-[var(--v2-border-border-muted)] px-1 pt-3">
            <span class="block text-[9.5px] font-semibold tracking-[0.11em] text-[var(--text-weak)] uppercase">
              Transition
            </span>
            <span class="mt-1 block text-[10.5px] text-[var(--text-weak)]">
              From <span class="font-medium text-[var(--text-base)]">{props.sourceTitle}</span>
            </span>
            <label class="mt-2 grid gap-1.5 text-[10.5px] font-medium text-[var(--text-base)]">
              Goes to
              <select
                class="h-8 w-full rounded-[7px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-2 text-[11px] text-[var(--text-strong)] outline-none transition-colors focus:border-[var(--text-interactive-base)]"
                value={
                  props.destination.kind === "new-screen"
                    ? "new"
                    : props.destination.kind === "end"
                      ? "end"
                      : `screen:${props.destination.screenId}`
                }
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (value === "new") props.onDestination({ kind: "new-screen" });
                  else if (value === "end") props.onDestination({ kind: "end" });
                  else
                    props.onDestination({
                      kind: "screen",
                      screenId: value.slice("screen:".length),
                    });
                }}
              >
                <option value="new">New screen</option>
                <For each={props.screens}>
                  {(screen) => <option value={`screen:${screen.id}`}>{screen.title}</option>}
                </For>
                <option value="end">End journey</option>
              </select>
            </label>
          </section>
          <section
            class={cn(
              "mt-3 rounded-[9px] border px-3 py-2.5",
              props.replayState === "passed"
                ? "border-[color-mix(in_srgb,var(--icon-success-base)_35%,transparent)] bg-[color-mix(in_srgb,var(--icon-success-base)_8%,transparent)]"
                : props.replayState === "failed"
                  ? "border-[color-mix(in_srgb,var(--icon-critical-base)_35%,transparent)] bg-[color-mix(in_srgb,var(--icon-critical-base)_7%,transparent)]"
                  : "border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)]",
            )}
          >
            <div class="flex items-center gap-2">
              <Icon
                name={
                  props.replayState === "passed"
                    ? "check"
                    : props.replayState === "failed"
                      ? "alert"
                      : "play"
                }
                size={12}
                class={
                  props.replayState === "passed"
                    ? "text-[var(--icon-success-base)]"
                    : props.replayState === "failed"
                      ? "text-[var(--icon-critical-base)]"
                      : "text-[var(--text-interactive-base)]"
                }
              />
              <strong class="text-[10.5px] font-semibold text-[var(--text-strong)]">
                {props.replayState === "passed"
                  ? "Replayed successfully"
                  : props.replayState === "failed"
                    ? "Needs another pass"
                    : props.replayState === "running"
                      ? "Replaying on device…"
                      : "Ready to test"}
              </strong>
            </div>
            <p class="m-0 mt-1 text-[9.5px]/[1.45] text-[var(--text-weak)]">
              {props.replayState === "passed"
                ? "Approve it if the device reached the right screen."
                : props.replayState === "failed"
                  ? props.replayError || "The transition stopped before it finished."
                  : "Relay will reproduce only this transition before you add it to the journey."}
            </p>
          </section>
        </Show>
      </div>

      <footer class="grid shrink-0 gap-2 border-t border-[var(--v2-border-border-muted)] p-3">
        <button
          type="button"
          class={cn(primaryButton, "h-9 justify-center")}
          disabled={count() === 0 || props.replayState === "running"}
          onClick={props.replayState === "passed" ? props.onKeep : props.onReplay}
        >
          <Icon
            name={
              props.replayState === "passed"
                ? "check"
                : props.replayState === "running"
                  ? "refresh"
                  : "play"
            }
            size={12}
            class={props.replayState === "running" ? "animate-spin motion-reduce:animate-none" : ""}
          />
          {props.replayState === "passed"
            ? "Approve transition"
            : props.replayState === "running"
              ? "Replaying…"
              : props.replayState === "failed"
                ? "Try again"
                : "Replay on device"}
        </button>
        <div class="flex items-center justify-between">
          <button type="button" class={secondaryButton} onClick={props.onDiscard}>
            Discard
          </button>
          <button type="button" class={secondaryButton} onClick={props.onRewrite}>
            <Icon name="refresh" size={11} /> Record again
          </button>
        </div>
      </footer>
    </aside>
  );
}

/** Frames are evidence, not a fake video. This component accepts a real video
 * when the recorder later persists one, without changing the review surface. */
export function RecordedTakePlayer(props: {
  take: RecordingTake;
  selectedIndex: number;
  onSelect: (index: number) => void;
  screenshotFor: (step: RecipeStep | undefined) => string;
  videoSrc?: string;
  clip?: JourneyVideoClip;
  onClip?: (clip: JourneyVideoClip) => void;
}) {
  const [durationMs, setDurationMs] = createSignal(0);
  let video: HTMLVideoElement | undefined;
  const lastIndex = () => Math.max(0, props.take.steps.length - 1);
  const selectedIndex = () => Math.min(lastIndex(), Math.max(0, props.selectedIndex));
  const step = () => props.take.steps[selectedIndex()];
  const imageSrc = () => props.screenshotFor(step());
  const title = () => (step() ? describeStep(step()!) : "No recorded action");
  const previous = () => props.onSelect(Math.max(0, selectedIndex() - 1));
  const next = () => props.onSelect(Math.min(lastIndex(), selectedIndex() + 1));
  const hasMultipleFrames = () => props.take.steps.length > 1;

  return (
    <section
      class="relative flex h-full min-h-0 flex-col items-center justify-center overflow-hidden px-6 py-5"
      aria-label="Recorded action preview"
    >
      <Show when={hasMultipleFrames()}>
        <div class="absolute top-4 inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--v2-background-bg-layer-02)] px-2.5 text-[10.5px] text-[var(--text-weak)] shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
          <Icon name="clock" size={12} />
          <span>Captured frame</span>
          <span class="text-[var(--v2-border-border-strong)]">·</span>
          <span class="font-mono tabular-nums text-[var(--text-base)]">
            {String(selectedIndex() + 1).padStart(2, "0")} /{" "}
            {String(props.take.steps.length).padStart(2, "0")}
          </span>
        </div>
      </Show>

      <div
        data-device-chrome
        class={cn(
          phoneBezel,
          "relative z-[1] h-[min(790px,calc(100%-136px))] max-w-[min(440px,calc(100%-56px))] shrink-0 rounded-[18px]",
        )}
        style={{ "aspect-ratio": "9 / 19.5" }}
      >
        <div
          class={cn(phoneScreen, "relative h-full w-full overflow-hidden rounded-[18px] bg-black")}
        >
          <Show
            when={props.videoSrc}
            fallback={
              <Show
                when={imageSrc()}
                fallback={
                  <div class="grid h-full place-items-center bg-[var(--v2-background-bg-base)] px-7 text-center">
                    <div class="grid justify-items-center gap-2.5">
                      <span class="grid size-10 place-items-center rounded-[12px] bg-[var(--v2-background-bg-layer-02)] text-[var(--text-weak)]">
                        <Icon name="camera" size={18} />
                      </span>
                      <div>
                        <strong class="block text-[12px] font-semibold text-[var(--text-strong)]">
                          No screen captured
                        </strong>
                        <p class="m-0 mt-1 text-[10.5px]/[1.45] text-[var(--text-weak)]">
                          This action is kept, but it has no recorded frame to preview.
                        </p>
                      </div>
                    </div>
                  </div>
                }
              >
                <img
                  class="h-full w-full object-contain"
                  src={imageSrc()}
                  alt={`Recorded screen for ${title()}`}
                  draggable={false}
                />
              </Show>
            }
          >
            {(src) => (
              <video
                ref={video}
                class="h-full w-full object-contain"
                src={src()}
                controls
                playsinline
                aria-label="Recorded take video"
                onLoadedMetadata={(event) => {
                  const nextDuration = Math.max(0, Math.round(event.currentTarget.duration * 1000));
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
        </div>
      </div>

      <Show when={props.videoSrc && durationMs() > 0 ? props.clip : undefined}>
        {(clip) => {
          const minimumGap = 100;
          const formatTime = (milliseconds: number) => `${(milliseconds / 1000).toFixed(1)}s`;
          return (
            <section class="mt-3 w-full max-w-[420px] rounded-[10px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-3 py-2.5">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-semibold text-[var(--text-strong)]">Trim video</span>
                <span class="text-[9px] text-[var(--text-weak)]">
                  Original recording is preserved
                </span>
              </div>
              <div class="mt-2 grid grid-cols-[36px_1fr_36px] items-center gap-2">
                <span class="font-mono text-[9px] tabular-nums text-[var(--text-weak)]">
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
                <span class="text-right text-[9px] text-[var(--text-weak)]">Start</span>
                <span class="font-mono text-[9px] tabular-nums text-[var(--text-weak)]">
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
                <span class="text-right text-[9px] text-[var(--text-weak)]">End</span>
              </div>
            </section>
          );
        }}
      </Show>

      <Show when={hasMultipleFrames()}>
        <div class="mt-4 flex max-w-[min(420px,100%)] flex-col items-center gap-2">
          <span class="max-w-full truncate text-[12px] font-medium text-[var(--text-strong)]">
            {title()}
          </span>
          <div class="inline-flex items-center gap-1 rounded-[9px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] p-1 shadow-[0_2px_8px_rgb(0_0_0/12%)]">
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
            <span class="min-w-12 text-center font-mono text-[10px] tabular-nums text-[var(--text-weak)]">
              {selectedIndex() + 1} / {props.take.steps.length}
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
        </div>
      </Show>
    </section>
  );
}

export function GraphEmptyState(props: {
  take: RecordingTake | null;
  recordState:
    | "ready"
    | "choose-device"
    | "checking-ios"
    | "preparing-ios"
    | "setup-check-failed"
    | "setup-ios"
    | "enable-developer-mode"
    | "device-unavailable";
  selectedDeviceName?: string;
  deviceOpen: boolean;
  onRecord: () => void;
  onSetUpDevice: () => void;
  onRetrySetup: () => void;
  onOpenDevice: () => void;
}) {
  const isRecording = () => props.take?.state === "recording";
  const count = () => props.take?.steps.length ?? 0;
  if (!props.take && props.recordState === "setup-ios") {
    return (
      <div class="absolute inset-0 z-[1] grid place-items-center px-5 text-center">
        <div class="flex flex-col items-center">
          <span class="mb-3 grid size-9 place-items-center rounded-[11px] bg-[var(--v2-background-bg-layer-01)] text-[var(--text-base)]">
            <Icon name="smartphone" size={16} />
          </span>
          <h2 class="m-0 text-[18px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
            Set up this iPad
          </h2>
          <p class="m-0 mt-1.5 max-w-[31ch] text-[12px]/[1.5] text-[var(--text-weak)]">
            Relay needs its local runner before it can read{" "}
            {props.selectedDeviceName ?? "this device"}.
          </p>
          <button type="button" class={cn(primaryButton, "mt-4")} onClick={props.onSetUpDevice}>
            Set up iPad
          </button>
        </div>
      </div>
    );
  }
  if (!props.take && props.recordState === "enable-developer-mode") {
    return (
      <div class="absolute inset-0 z-[1] grid place-items-center px-5 text-center">
        <div class="flex flex-col items-center">
          <span class="mb-3 grid size-9 place-items-center rounded-[11px] bg-[var(--v2-background-bg-layer-01)] text-[var(--text-base)]">
            <Icon name="smartphone" size={16} />
          </span>
          <h2 class="m-0 text-[18px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
            Turn on Developer Mode
          </h2>
          <p class="m-0 mt-1.5 max-w-[32ch] text-[12px]/[1.5] text-[var(--text-weak)]">
            On your iPad: Settings → Privacy &amp; Security → Developer Mode. Restart when prompted,
            then turn it on.
          </p>
        </div>
      </div>
    );
  }
  if (!props.take && props.recordState === "preparing-ios") {
    return (
      <div class="absolute inset-0 z-[1] grid place-items-center px-5 text-center">
        <div class="flex flex-col items-center">
          <span
            class="mb-3 size-6 animate-spin rounded-full border-2 border-[var(--text-weak)] border-t-transparent motion-reduce:animate-none"
            role="status"
            aria-label="Preparing iPad"
          />
          <h2 class="m-0 text-[18px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
            Preparing this iPad
          </h2>
          <p class="m-0 mt-1.5 max-w-[32ch] text-[12px]/[1.5] text-[var(--text-weak)]">
            Keep it unlocked while macOS enables Apple device support. This can take a minute after
            Developer Mode is turned on.
          </p>
        </div>
      </div>
    );
  }
  if (!props.take && props.recordState === "checking-ios") {
    return (
      <div class="absolute inset-0 z-[1] grid place-items-center px-5 text-center">
        <div class="flex flex-col items-center">
          <span
            class="mb-3 size-6 animate-spin rounded-full border-2 border-[var(--text-weak)] border-t-transparent motion-reduce:animate-none"
            role="status"
            aria-label="Checking iPad setup"
          />
          <h2 class="m-0 text-[18px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
            Checking iPad setup
          </h2>
        </div>
      </div>
    );
  }
  if (!props.take && props.recordState === "setup-check-failed") {
    return (
      <div class="absolute inset-0 z-[1] grid place-items-center px-5 text-center">
        <div class="flex flex-col items-center">
          <span class="mb-3 grid size-9 place-items-center rounded-[11px] bg-[var(--v2-background-bg-layer-01)] text-[var(--text-base)]">
            <Icon name="smartphone" size={16} />
          </span>
          <h2 class="m-0 text-[18px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
            Can’t check this iPad yet
          </h2>
          <p class="m-0 mt-1.5 max-w-[31ch] text-[12px]/[1.5] text-[var(--text-weak)]">
            Try again once the local Relay service is ready.
          </p>
          <button type="button" class={cn(primaryButton, "mt-4")} onClick={props.onRetrySetup}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!props.take && props.recordState === "device-unavailable") {
    return (
      <div class="absolute inset-0 z-[1] grid place-items-center px-5 text-center">
        <div class="flex flex-col items-center">
          <span class="mb-3 grid size-9 place-items-center rounded-[11px] bg-[var(--v2-background-bg-layer-01)] text-[var(--text-base)]">
            <Icon name="smartphone" size={16} />
          </span>
          <h2 class="m-0 text-[18px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
            Reconnect {props.selectedDeviceName}
          </h2>
          <p class="m-0 mt-1.5 max-w-[30ch] text-[12px]/[1.5] text-[var(--text-weak)]">
            Relay will be ready to record when it can reach this device again.
          </p>
        </div>
      </div>
    );
  }
  if (!props.take && props.recordState === "choose-device") {
    return (
      <div class="absolute inset-0 z-[1] grid place-items-center px-5">
        <ChooseDeviceEmptyState onChooseDevice={props.onRecord} />
      </div>
    );
  }
  return (
    <div class="absolute inset-0 z-[1] grid place-items-center px-5 text-center">
      <div class="flex flex-col items-center">
        <span class="mb-3 grid size-9 place-items-center rounded-[11px] bg-[var(--v2-background-bg-layer-01)] text-[var(--text-base)]">
          <Icon name="move" size={16} />
        </span>
        <h2 class="m-0 text-[18px] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
          {isRecording()
            ? "Recording this journey"
            : props.take
              ? "Review this recording"
              : props.deviceOpen
                ? "Record your first path"
                : "Start this journey"}
        </h2>
        <p class="m-0 mt-1.5 max-w-[34ch] text-[12px]/[1.5] text-[var(--text-weak)]">
          {isRecording()
            ? `${count()} captured action${count() === 1 ? "" : "s"}. Use the device normally, then stop to review before anything is added here.`
            : props.take
              ? `${count()} action${count() === 1 ? "" : "s"} is ready to review. Keep it to turn the recording into your first screen.`
              : props.deviceOpen
                ? `${props.selectedDeviceName ?? "Your device"} is live on the right. Explore freely, then record when you are ready to capture actions here.`
                : `Open ${props.selectedDeviceName ?? "your device"} to explore it, or start recording to capture the first path.`}
        </p>
        <Show when={!props.take}>
          <div class="mt-4 flex items-center gap-2">
            <button type="button" class={cn(primaryButton, "h-9 px-3")} onClick={props.onRecord}>
              <i class="size-1.5 rounded-full bg-[var(--icon-critical-base)]" />
              Start recording
            </button>
            <Show when={!props.deviceOpen}>
              <button
                type="button"
                class={cn(controlButton, "h-9 px-3")}
                onClick={props.onOpenDevice}
              >
                <Icon name="smartphone" size={12} /> Open live device
              </button>
            </Show>
          </div>
        </Show>
        <Show when={props.take && !isRecording()}>
          <button
            type="button"
            class={cn(controlButton, "mt-4 px-2.5")}
            onClick={props.onOpenDevice}
          >
            Review capture
          </button>
        </Show>
      </div>
    </div>
  );
}
