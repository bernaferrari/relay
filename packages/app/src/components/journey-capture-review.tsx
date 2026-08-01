import { For, Show, createSignal } from "solid-js";
import type { JourneyGraphScreen, JourneyVideoClip } from "@relay/protocol";
import type { RecipeStep } from "../context/server";
import { cn } from "../lib/cn";
import type { TakeDestination } from "../lib/journey-graph";
import { phoneScreen } from "../lib/ui";
import { describeStep, type RecordingTake } from "../context/recorder";
import { Icon } from "./icon";

const controlButton =
  "grid min-h-11 min-w-11 place-items-center rounded-[7px] px-1.5 text-[10px] text-[var(--text-base)] transition-colors duration-100 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-border-strong-focus";
const primaryButton =
  "inline-flex min-h-11 items-center gap-1.5 rounded-[8px] bg-[var(--product-accent-soft)] px-3 text-[10.5px] font-semibold text-[var(--text-interactive-base)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35";
const secondaryButton =
  "inline-flex min-h-11 items-center gap-1.5 rounded-[8px] px-2.5 text-[10px] font-medium text-[var(--text-base)] transition-colors duration-100 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-border-strong-focus";
const reviewPhoneShell =
  "relative rounded-[21px] bg-[var(--phone-bezel)] p-[2px] shadow-[0_0_0_1px_rgb(255_255_255/10%),0_22px_54px_-24px_rgb(0_0_0/78%)]";

/** A compact capture status for the live device drawer. Once stopped, review
 * moves into TakeReviewWorkspace so it never competes with the live device. */
export function TakeCaptureBar(props: {
  take: RecordingTake;
  contextLabel?: string;
  onStop: () => void;
}) {
  const count = () => props.take.steps.length;
  const actionLabel = () =>
    count() === 0 ? "No actions yet" : `${count()} action${count() === 1 ? "" : "s"}`;
  return (
    <section class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-t border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <i class="size-2 shrink-0 rounded-full bg-[var(--icon-critical-base)] motion-safe:animate-pulse" />
        <div class="min-w-0 text-[10.5px]/[1.35]">
          <strong class="block font-semibold text-[var(--text-strong)]">
            {props.contextLabel ? "Recording connection" : "Recording"}
          </strong>
          <span class="block truncate text-[var(--text-weak)]">
            {props.contextLabel ? `${props.contextLabel} · ${actionLabel()}` : actionLabel()}
          </span>
        </div>
      </div>
      <button
        type="button"
        class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] bg-[color-mix(in_srgb,var(--icon-critical-base)_14%,transparent)] px-3 text-[11px] font-semibold text-[var(--icon-critical-base)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--icon-critical-base)_20%,transparent)] active:scale-[0.96] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-border-border-strong)]"
        onClick={props.onStop}
      >
        <Icon name="square" size={10} /> Stop
      </button>
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
      class="flex min-h-0 min-w-0 flex-col border-r border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)] max-[760px]:border-r-0 max-[760px]:border-b"
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
            <div class="rounded-[9px] bg-[var(--v2-background-bg-layer-01)] px-4 py-3 text-[11px]/[1.5] text-[var(--text-weak)]">
              No device action. This connection observes a transition that happens on its own.
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
                      class="flex min-w-0 flex-1 self-stretch items-center gap-2.5 text-left"
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
                      class="grid size-11 shrink-0 place-items-center rounded-[8px] text-[var(--text-weak)] opacity-60 transition-[background-color,color,opacity] duration-150 group-hover:opacity-100 hover:bg-[var(--v2-background-bg-layer-03)] hover:text-[var(--icon-critical-base)] focus-visible:opacity-100"
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
        </Show>
        <section class="mt-4 border-t border-[var(--v2-border-border-muted)] px-1 pt-3">
          <span class="block text-[9.5px] font-semibold tracking-[0.11em] text-[var(--text-weak)] uppercase">
            Connection
          </span>
          <span class="mt-1 block text-[10.5px] text-[var(--text-weak)]">
            From <span class="font-medium text-[var(--text-base)]">{props.sourceTitle}</span>
          </span>
          <label class="mt-2 grid gap-1.5 text-[10.5px] font-medium text-[var(--text-base)]">
            Goes to
            <select
              class="h-11 w-full rounded-[7px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-2 text-[11px] text-[var(--text-strong)] outline-none transition-colors focus:border-[var(--text-interactive-base)]"
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
                ? props.replayError || "The connection stopped before it finished."
                : "Relay will try only this connection before you add it to the journey."}
          </p>
        </section>
      </div>

      <footer class="grid shrink-0 gap-2 border-t border-[var(--v2-border-border-muted)] p-3">
        <button
          type="button"
          class={cn(primaryButton, "justify-center")}
          disabled={props.replayState === "running"}
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
            class={
              props.replayState === "running"
                ? "animate-[spin_900ms_linear_infinite] motion-reduce:animate-none"
                : ""
            }
          />
          {props.replayState === "passed"
            ? "Approve connection"
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
            <Icon name="refresh" size={11} /> Rewrite connection
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
  screenshotFor: (step: RecipeStep | undefined, index: number) => string;
  videoSrc?: string;
  clip?: JourneyVideoClip;
  onClip?: (clip: JourneyVideoClip) => void;
}) {
  const [durationMs, setDurationMs] = createSignal(0);
  let video: HTMLVideoElement | undefined;
  const lastIndex = () => Math.max(0, props.take.steps.length - 1);
  const selectedIndex = () => Math.min(lastIndex(), Math.max(0, props.selectedIndex));
  const step = () => props.take.steps[selectedIndex()];
  const imageSrc = () => props.screenshotFor(step(), selectedIndex());
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
          reviewPhoneShell,
          "relative z-[1] h-[min(790px,calc(100%-136px))] max-w-[min(440px,calc(100%-56px))] shrink-0",
        )}
        style={{ "aspect-ratio": "9 / 19.5" }}
      >
        <div
          class={cn(phoneScreen, "relative h-full w-full overflow-hidden rounded-[20px] bg-black")}
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
                ref={(element) => {
                  video = element;
                }}
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
    | "preparing-screen"
    | "setup-check-failed"
    | "setup-ios"
    | "enable-developer-mode"
    | "capture-error"
    | "device-unavailable";
  selectedDeviceName?: string;
  deviceOpen: boolean;
  deviceSelected: boolean;
  liveScreenSrc?: string;
  captureBusy: boolean;
  onUseCurrentScreen: () => void;
  onOpenDevice: () => void;
}) {
  const isRecording = () => props.take?.state === "recording";
  const count = () => props.take?.steps.length ?? 0;
  const activeStep = () => {
    if (props.recordState === "choose-device" || props.recordState === "device-unavailable")
      return 0;
    if (props.recordState === "ready") return 2;
    return 1;
  };
  const guidance = () => {
    if (isRecording()) {
      return {
        title: "Record one connection",
        detail: `${count()} action${count() === 1 ? "" : "s"} captured. Stop when the destination screen is visible.`,
      };
    }
    if (props.take) {
      return {
        title: "Review this connection",
        detail: "Trim its actions, try it on the device, then approve it for the journey.",
      };
    }
    if (!props.deviceOpen) {
      return {
        title: "Set the entry screen",
        detail: "Open Device, navigate to the beginning, then save that screen to the canvas.",
      };
    }
    switch (props.recordState) {
      case "choose-device":
        return {
          title: "Start from any screen",
          detail: "Choose a target on the right, then navigate to where this journey begins.",
        };
      case "setup-ios":
      case "enable-developer-mode":
      case "setup-check-failed":
      case "capture-error":
        return {
          title: "Finish device setup",
          detail:
            "Follow the guidance in the device panel, then return here to record the first connection.",
        };
      case "checking-ios":
      case "preparing-ios":
      case "preparing-screen":
        return {
          title: "Preparing the device",
          detail: `Keep ${props.selectedDeviceName ?? "the device"} unlocked. Relay will enable recording when its screen is ready.`,
        };
      case "device-unavailable":
        return {
          title: "Reconnect the device",
          detail: "Relay will continue as soon as the selected device is available again.",
        };
      default:
        return {
          title: "Set the entry screen",
          detail: `Navigate ${props.selectedDeviceName ?? "the device"} to where this journey begins, then use the current screen as the start.`,
        };
    }
  };
  return (
    <Show when={!(props.deviceOpen && props.recordState === "choose-device")}>
      <div
        class="absolute inset-y-0 left-0 z-[1] grid place-items-center px-6 max-[760px]:right-0"
        style={{ right: props.deviceOpen && props.deviceSelected ? "min(420px, 50vw)" : "0" }}
      >
        <section class="ui-modal w-[min(410px,calc(100vw-48px))] overflow-hidden rounded-[20px] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_96%,transparent)] p-1.5 shadow-[0_0_0_1px_color-mix(in_srgb,var(--v2-border-border-strong)_80%,transparent),0_24px_80px_-28px_rgb(0_0_0/55%)] backdrop-blur-[18px]">
          <div class="rounded-[15px] bg-[color-mix(in_srgb,var(--v2-background-bg-layer-01)_72%,transparent)] px-5 pt-5 pb-4">
            <div class="flex items-center gap-3">
              <span class="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text-interactive-base)_18%,transparent)]">
                <Icon name={isRecording() ? "camera" : "smartphone"} size={18} />
              </span>
              <div class="min-w-0">
                <span class="block text-[9.5px] font-semibold tracking-[0.12em] text-[var(--text-weak)] uppercase">
                  {isRecording() ? "Capturing connection" : "New journey"}
                </span>
                <h2 class="m-0 mt-0.5 text-[20px] font-semibold tracking-[-0.035em] text-[var(--text-strong)] text-balance">
                  {guidance().title}
                </h2>
              </div>
            </div>
            <p class="m-0 mt-3 max-w-[46ch] text-[12px]/[1.55] text-[var(--text-weak)] text-pretty">
              {guidance().detail}
            </p>
            <Show when={!props.take}>
              <ol
                class="m-0 mt-4 grid list-none grid-cols-3 gap-1 p-0"
                aria-label="Getting started"
              >
                <For each={["Connect", "Navigate", "Capture"]}>
                  {(label, index) => (
                    <li
                      class={cn(
                        "flex min-w-0 items-center gap-1.5 rounded-[8px] px-2 py-2 text-[10px] font-medium",
                        index() === activeStep()
                          ? "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]"
                          : index() < activeStep()
                            ? "text-[var(--text-base)]"
                            : "text-[var(--text-weak)]",
                      )}
                    >
                      <span
                        class={cn(
                          "grid size-4 shrink-0 place-items-center rounded-full text-[8px] font-semibold",
                          index() <= activeStep()
                            ? "bg-[var(--text-interactive-base)] text-white"
                            : "bg-[var(--v2-background-bg-layer-03)] text-[var(--text-weak)]",
                        )}
                      >
                        {index() < activeStep() ? <Icon name="check" size={9} /> : index() + 1}
                      </span>
                      <span class="truncate">{label}</span>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
          </div>
          <Show when={!props.take && !(props.deviceOpen && props.recordState === "choose-device")}>
            <div class="flex items-center justify-between gap-3 px-3 py-2.5">
              <span class="text-[10px] text-[var(--text-weak)]">
                {props.recordState === "ready"
                  ? "Your live screen is ready"
                  : "Device stays one click away"}
              </span>
              <button
                type="button"
                class={cn(primaryButton, "shrink-0 justify-center px-3")}
                disabled={
                  props.captureBusy ||
                  (props.deviceOpen &&
                    !["ready", "choose-device", "device-unavailable"].includes(props.recordState))
                }
                aria-busy={props.captureBusy}
                onClick={
                  props.recordState === "ready" ? props.onUseCurrentScreen : props.onOpenDevice
                }
              >
                <Icon
                  name={
                    props.captureBusy
                      ? "refresh"
                      : props.recordState === "ready"
                        ? "camera"
                        : "smartphone"
                  }
                  size={13}
                  class={
                    props.captureBusy
                      ? "animate-[spin_900ms_linear_infinite] motion-reduce:animate-none"
                      : ""
                  }
                />
                {props.captureBusy
                  ? "Saving…"
                  : props.recordState === "ready"
                    ? "Capture first screen"
                    : "Open device"}
              </button>
            </div>
          </Show>
        </section>
      </div>
    </Show>
  );
}
