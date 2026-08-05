import { Show, type Accessor, type JSX } from "solid-js";
import type { RecipeStep } from "../context/server";
import { cn } from "../lib/cn";
import { deviceCaption, deviceIconWell, deviceTitle, mono } from "../lib/ui";
import { Icon } from "./icon";
import { UncapturedStepPreview } from "./device-stage-previews";
import type { SwipeEndpoint } from "./swipe-path-preview";

export type StageRecordingIssue = { kind: "setup" | "screen"; message: string };

export type StageScreenFallbackProps = {
  arming: boolean;
  recordingIssue: StageRecordingIssue | null | undefined;
  displayImageSrc: string;
  embeddedRecordingControls: boolean;
  plannedFocus: { index: number; title: string } | null | undefined;
  focusedPlanStep: Accessor<RecipeStep | undefined>;
  targetReady: boolean;
  isEmptyDevices: boolean;
  needsIosSetup: boolean;
  developerModeDisabled: boolean;
  liveCaptureIssue: string | null | undefined;
  emptyStageTitle: string;
  checkingIosSetup: boolean;
  preparingIosScreen: boolean;
  hasIosSetupIssue: boolean;
  iosSetupGuidance: string;
  onRetryScreenPreview: () => void;
  onEnterRecordMode: () => void;
  onSwipePoint: (endpoint: SwipeEndpoint, point: { x: number; y: number }) => void;
  children: JSX.Element;
};

/**
 * Content inside the phone glass when there is no live/recorded frame yet —
 * arming, setup, empty, or planned-step preview. Keeps DeviceStage focused on
 * interaction wiring rather than status copy trees.
 */
export function StageScreenFallback(props: StageScreenFallbackProps) {
  return (
    <Show
      when={!props.arming && !props.recordingIssue && props.displayImageSrc}
      fallback={
        <Show
          when={props.arming}
          fallback={
            <Show
              when={props.recordingIssue}
              fallback={
                <Show
                  when={!props.embeddedRecordingControls ? props.plannedFocus : undefined}
                  fallback={
                    <div class="grid h-full w-full place-items-center px-6 text-center">
                      <Show
                        when={
                          props.embeddedRecordingControls &&
                          props.targetReady &&
                          (props.needsIosSetup ||
                            props.developerModeDisabled ||
                            Boolean(props.liveCaptureIssue))
                        }
                        fallback={
                          <Show
                            when={props.embeddedRecordingControls && props.targetReady}
                            fallback={
                              <div class="grid justify-items-center gap-2.5">
                                <span class={cn(deviceIconWell, "size-11 rounded-[13px]")}>
                                  <Icon name="smartphone" size={20} />
                                </span>
                                <strong
                                  class={cn(
                                    deviceTitle,
                                    "text-[14px] font-semibold tracking-[-0.01em]",
                                  )}
                                >
                                  {props.emptyStageTitle}
                                </strong>
                              </div>
                            }
                          >
                            <div class="grid justify-items-center gap-2.5 text-center">
                              <span
                                class="size-5 animate-spin rounded-full border-2 border-[var(--text-weak)] border-t-transparent motion-reduce:animate-none"
                                role="status"
                                aria-label={
                                  props.checkingIosSetup
                                    ? "Checking iPad setup"
                                    : props.preparingIosScreen
                                      ? "Preparing the iPad"
                                      : "Waiting for the device screen"
                                }
                              />
                              <Show when={props.preparingIosScreen}>
                                <strong
                                  class={cn(
                                    deviceTitle,
                                    "text-[14px] font-semibold tracking-[-0.01em]",
                                  )}
                                >
                                  {props.emptyStageTitle}
                                </strong>
                              </Show>
                              <Show when={props.checkingIosSetup}>
                                <strong
                                  class={cn(
                                    deviceTitle,
                                    "text-[14px] font-semibold tracking-[-0.01em]",
                                  )}
                                >
                                  Checking iPad setup
                                </strong>
                              </Show>
                            </div>
                          </Show>
                        }
                      >
                        <div class="grid justify-items-center gap-3 text-center">
                          <span class={cn(deviceIconWell, "size-10 rounded-[12px]")}>
                            <Icon name="smartphone" size={18} />
                          </span>
                          <strong class={cn(deviceTitle, "text-[13px] font-semibold")}>
                            {props.developerModeDisabled
                              ? "Turn on Developer Mode"
                              : props.hasIosSetupIssue
                                ? "Set up this iPad"
                                : "Screen unavailable"}
                          </strong>
                          <Show when={props.hasIosSetupIssue}>
                            <p class="m-0 max-w-[23ch] text-[10.5px] leading-4 text-[var(--text-weak)]">
                              {props.iosSetupGuidance}
                            </p>
                          </Show>
                          <Show when={!props.developerModeDisabled}>
                            <button
                              type="button"
                              class="inline-flex min-h-11 min-w-[92px] items-center justify-center rounded-[10px] border border-[var(--phone-rim)] bg-[var(--phone-fill-strong)] px-4 text-[11px] font-semibold text-[var(--phone-fg)] shadow-[0_6px_18px_rgb(0_0_0/20%)] transition-[background-color,border-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--phone-fg)_22%,transparent)] active:scale-[0.96] motion-reduce:active:scale-100"
                              onClick={() => {
                                if (props.hasIosSetupIssue) {
                                  window.dispatchEvent(
                                    new CustomEvent("relay:open-settings", {
                                      detail: { section: "devices" },
                                    }),
                                  );
                                  return;
                                }
                                props.onRetryScreenPreview();
                              }}
                            >
                              {props.hasIosSetupIssue ? "Open device setup" : "Try again"}
                            </button>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  }
                >
                  {(focused) => {
                    const step = () => props.focusedPlanStep();
                    return (
                      <div class="relative h-full w-full">
                        <Show when={step()}>
                          {(value) => (
                            <UncapturedStepPreview
                              step={value()}
                              onSwipePoint={props.onSwipePoint}
                            />
                          )}
                        </Show>
                        <div class="pointer-events-none absolute inset-x-5 bottom-[15%] grid justify-items-center gap-1.5 text-center">
                          <span
                            class={cn(
                              mono,
                              deviceCaption,
                              "text-[9.5px] tracking-[0.09em] uppercase",
                            )}
                          >
                            Step {String(focused().index + 1).padStart(2, "0")}
                          </span>
                          <span class={cn(deviceCaption, "max-w-[26ch] text-[11.5px]/[1.5]")}>
                            {props.targetReady
                              ? "No captured screen"
                              : props.isEmptyDevices
                                ? "No device selected"
                                : "Device unavailable"}
                          </span>
                        </div>
                      </div>
                    );
                  }}
                </Show>
              }
            >
              {(issue) => (
                <div class="grid h-full w-full place-items-center px-6 text-center">
                  <div class="grid max-w-[220px] justify-items-center gap-3">
                    <span class={cn(deviceIconWell, "size-10 rounded-[12px]")}>
                      <Icon name="smartphone" size={18} />
                    </span>
                    <strong class={cn(deviceTitle, "text-[13px] font-semibold")}>
                      {issue().kind === "setup" ? "Set up this iPad" : "Can’t read this screen"}
                    </strong>
                    <p class="m-0 text-[10.5px] leading-4 text-[var(--text-weak)]">
                      {issue().message}
                    </p>
                    <button
                      type="button"
                      class="min-h-11 rounded-[8px] bg-[var(--product-accent-soft)] px-3 text-[11px] font-semibold text-[var(--text-interactive-base)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] active:scale-[0.97]"
                      onClick={() => {
                        if (issue().kind === "setup") {
                          window.dispatchEvent(
                            new CustomEvent("relay:open-settings", {
                              detail: { section: "devices" },
                            }),
                          );
                          return;
                        }
                        props.onEnterRecordMode();
                      }}
                    >
                      {issue().kind === "setup" ? "Open iPad setup" : "Try again"}
                    </button>
                  </div>
                </div>
              )}
            </Show>
          }
        >
          <div class="grid h-full w-full place-items-center px-6 text-center">
            <div class="grid justify-items-center gap-3">
              <span class={cn(deviceIconWell, "size-10 rounded-[12px]")}>
                <Icon name="smartphone" size={18} />
              </span>
              <strong class={cn(deviceTitle, "text-[13px] font-semibold")}>Preparing device</strong>
              <span
                class="size-4 animate-spin rounded-full border-2 border-[var(--text-weak)] border-t-transparent motion-reduce:animate-none"
                role="status"
                aria-label="Preparing device for recording"
              />
            </div>
          </div>
        </Show>
      }
    >
      {props.children}
    </Show>
  );
}
