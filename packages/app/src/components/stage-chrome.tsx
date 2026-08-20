import { Show } from "solid-js";
import { Button } from "@relay/ui/button";
import { IconButton } from "@relay/ui/icon-button";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

/** Live / Recorded view switch above the device bezel. */
export function StageViewToggle(props: {
  stageView: "recorded" | "live";
  setStageView: (view: "recorded" | "live") => void;
  hasRecordedEvidence: boolean;
  /** A reachable target can be viewed even before semantic control is ready. */
  liveAvailable: boolean;
  recording: boolean;
  videoReady: boolean;
  videoFailed: boolean;
}) {
  return (
    <div class="absolute top-4 z-[4] flex h-8 items-center justify-center text-text-base">
      <Show
        when={props.hasRecordedEvidence && props.liveAvailable}
        fallback={
          <Show
            when={props.hasRecordedEvidence}
            fallback={
              <span
                class="inline-flex min-w-[64px] items-center justify-center gap-1.5 px-1.5 text-caption font-medium"
                role="status"
                aria-live="polite"
                data-tip={
                  props.videoReady
                    ? "Live device preview"
                    : props.videoFailed
                      ? "Using screenshot preview while video reconnects"
                      : "Screen preview is starting"
                }
              >
                <i
                  class={cn(
                    "size-1.5 shrink-0 rounded-full",
                    props.videoReady
                      ? "bg-[var(--icon-success-base)]"
                      : props.videoFailed
                        ? "bg-[var(--icon-warning-base)]"
                        : "animate-pulse bg-icon-base motion-reduce:animate-none",
                  )}
                  aria-hidden="true"
                />
                <span>{props.videoReady ? "Live" : props.videoFailed ? "Preview" : "Preview"}</span>
              </span>
            }
          >
            <span
              class="inline-flex h-8 min-w-[64px] items-center justify-center gap-1.5 px-1.5 text-caption font-medium text-text-base"
              role="status"
              aria-label="Recorded device evidence"
            >
              <Icon name="clock" size={12} /> Recorded
            </span>
          </Show>
        }
      >
        <div
          class="inline-flex h-8 items-center rounded-lg bg-[var(--surface-base)] p-0.5 shadow-[inset_0_0_0_1px_var(--border-strong-base)]"
          role="group"
          aria-label="Device view"
        >
          <button
            type="button"
            class={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-caption font-medium transition-[background-color,color,box-shadow,transform] duration-hover ease-out active:scale-[0.97]",
              props.stageView === "recorded"
                ? "bg-[var(--surface-raised-base)] text-[var(--text-strong)] shadow-[0_1px_2px_rgb(0_0_0/24%),inset_0_0_0_1px_color-mix(in_srgb,var(--border-strong-base)_72%,transparent)]"
                : "text-[var(--text-weak)] hover:enabled:bg-[var(--surface-base-hover)] hover:enabled:text-[var(--text-base)]",
            )}
            aria-pressed={props.stageView === "recorded"}
            disabled={props.recording}
            onClick={() => props.setStageView("recorded")}
          >
            <Icon name="clock" size={12} /> Recorded
          </button>
          <button
            type="button"
            class={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-caption font-medium transition-[background-color,color,box-shadow,transform] duration-hover ease-out active:scale-[0.97]",
              props.stageView === "live"
                ? "bg-[var(--surface-raised-base)] text-[var(--text-strong)] shadow-[0_1px_2px_rgb(0_0_0/24%),inset_0_0_0_1px_color-mix(in_srgb,var(--border-strong-base)_72%,transparent)]"
                : "text-[var(--text-weak)] hover:enabled:bg-[var(--surface-base-hover)] hover:enabled:text-[var(--text-base)]",
            )}
            aria-pressed={props.stageView === "live"}
            disabled={!props.liveAvailable}
            data-tip={!props.liveAvailable ? "Connect a device to use Live view" : undefined}
            onClick={() => {
              props.setStageView("live");
            }}
          >
            <i
              class={cn(
                "size-1.5 rounded-full",
                props.stageView !== "live"
                  ? "bg-[var(--text-weak)]"
                  : props.videoReady
                    ? "bg-[var(--icon-success-base)]"
                    : props.videoFailed
                      ? "bg-[var(--icon-warning-base)]"
                      : "animate-pulse bg-icon-base motion-reduce:animate-none",
              )}
              aria-hidden="true"
            />
            Live
          </button>
        </div>
      </Show>
    </div>
  );
}

/** Record / screenshot utilities beneath the live device (non-embedded only). */
export function StageRecordingControls(props: {
  stageView: "recorded" | "live";
  recording: boolean;
  recordingGroup: string;
  setRecordingGroup: (value: string) => void;
  startNextRecordingGroup: () => void;
  selectedLeaseId: string | null | undefined;
  busyCapture: boolean;
  frameCount: number;
  onToggleRecording: () => void;
  onCaptureScreenshot: () => void;
  onCopyScreenshot: () => void;
  onClearFrames: () => void;
}) {
  return (
    <div class="z-[2] mt-3 flex min-h-10 items-center justify-center text-text-base">
      <Show when={props.stageView === "live"}>
        <div class="flex items-center gap-1 rounded-xl bg-surface-raised-stronger-non-alpha p-1 shadow-[var(--map-elevation-control)]">
          <Button
            variant={props.recording ? "danger" : "primary"}
            size="md"
            class="min-w-[104px] gap-2 rounded-lg"
            aria-label={props.recording ? "Stop recording path" : "Record path"}
            disabled={!props.recording && !props.selectedLeaseId}
            onClick={props.onToggleRecording}
            data-tip={
              props.recording
                ? "Stop when you reach the next screen"
                : props.selectedLeaseId
                  ? "Record taps as a path on the map"
                  : "Restoring device control…"
            }
          >
            <Icon name={props.recording ? "square" : "circle"} size={10} />
            {props.recording ? "Stop" : "Record path"}
          </Button>
          <Show when={props.recording}>
            <div class="flex h-9 min-w-0 items-center rounded-lg bg-[var(--surface-base)] shadow-[inset_0_0_0_1px_var(--border-weak-base)]">
              <input
                class="h-full w-32 min-w-0 bg-transparent px-2.5 text-caption font-medium text-[var(--text-strong)] outline-none placeholder:text-text-weak"
                aria-label="Current recording task"
                value={props.recordingGroup}
                placeholder="Task name"
                onInput={(event) => props.setRecordingGroup(event.currentTarget.value)}
              />
              <button
                type="button"
                class="grid size-9 shrink-0 place-items-center rounded-r-lg text-text-weak transition-[background-color,color,transform] duration-hover hover:bg-[var(--surface-base-hover)] hover:text-text-strong active:scale-[0.97]"
                aria-label="Start a new recording task"
                data-tip="Start a new task"
                onClick={() => props.startNextRecordingGroup()}
              >
                <Icon name="plus" size={14} />
              </button>
            </div>
          </Show>
          <span class="mx-0.5 h-5 w-px bg-border-weak-base" aria-hidden="true" />
          <IconButton
            variant="ghost"
            size="normal"
            class="!size-9 rounded-lg"
            data-tip="Save screenshot to the map (⌘⇧S)"
            aria-label="Save screenshot to the map"
            disabled={props.busyCapture}
            onClick={props.onCaptureScreenshot}
          >
            <Show when={props.busyCapture} fallback={<Icon name="camera" size={14} />}>
              <span
                class="size-3.5 rounded-full border-[1.5px] border-current border-t-transparent opacity-70 motion-safe:animate-spin"
                aria-hidden="true"
              />
            </Show>
          </IconButton>
          <IconButton
            variant="ghost"
            size="normal"
            class="!size-9 rounded-lg"
            data-tip="Copy screenshot"
            aria-label="Copy screenshot to clipboard"
            disabled={props.busyCapture}
            onClick={props.onCopyScreenshot}
          >
            <Icon name="copy" size={14} />
          </IconButton>
          <Show when={props.frameCount > 0}>
            <IconButton
              variant="ghost"
              size="normal"
              class="!size-9 rounded-lg hover:text-icon-critical-base"
              data-tip="Clear frames"
              aria-label="Clear frames"
              onClick={props.onClearFrames}
            >
              <Icon name="trash" size={14} />
            </IconButton>
          </Show>
        </div>
      </Show>
    </div>
  );
}
