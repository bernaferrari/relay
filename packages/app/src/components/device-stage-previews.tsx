import { Show } from "solid-js";
import { Button } from "@relay/ui/button";
import type { RecipeStep } from "../context/server";
import { targetPointGuide } from "../lib/target-inspector";
import { cn } from "../lib/cn";
import { DEFAULT_TOUCH_BOUNDS } from "../lib/stage-presentation";
import { Icon } from "./icon";
import { SwipePathPreview, type SwipeEndpoint } from "./swipe-path-preview";

export type DeviceBounds = { width: number; height: number };
export type CoordinateGuide = NonNullable<ReturnType<typeof targetPointGuide>>;

export type DevicePanelState = {
  kind: "progress" | "recording" | "setup" | "error";
  title: string;
  detail: string;
  primaryAction?: "open-xcode" | "open-settings" | "retry";
  primaryLabel?: string;
  secondaryRetry?: boolean;
};

export function DevicePanelStatus(props: {
  state: DevicePanelState;
  busy?: boolean;
  onOpenXcode: () => void;
  onOpenSettings: () => void;
  onRetry: () => void;
}) {
  const runPrimary = () => {
    if (props.busy) return;
    switch (props.state.primaryAction) {
      case "open-xcode":
        props.onOpenXcode();
        break;
      case "open-settings":
        props.onOpenSettings();
        break;
      case "retry":
        props.onRetry();
        break;
    }
  };
  const busyLabel = () =>
    props.state.primaryLabel?.toLowerCase().includes("reconnect") ? "Reconnecting…" : "Checking…";

  return (
    <div
      class="relative z-[2] grid w-full max-w-[360px] justify-items-center gap-5 px-5 text-center"
      data-device-state={props.state.kind}
      role={["progress", "recording"].includes(props.state.kind) ? "status" : "group"}
      aria-live="polite"
    >
      <span
        class={cn(
          "grid size-12 place-items-center rounded-2xl text-[var(--text-base)]",
          "bg-[var(--surface-base-hover)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--border-strong-base)_64%,transparent),0_1px_2px_rgb(0_0_0/5%),0_8px_22px_-12px_rgb(0_0_0/18%)]",
        )}
        aria-hidden="true"
      >
        <Show
          when={props.state.kind === "progress"}
          fallback={
            <Icon
              name={
                props.state.kind === "recording"
                  ? "circle"
                  : props.state.kind === "setup"
                    ? "sliders"
                    : "alert"
              }
              size={props.state.kind === "recording" ? 12 : 20}
            />
          }
        >
          <span class="size-5 animate-spin rounded-full border-2 border-[var(--text-weak)] border-t-transparent motion-reduce:animate-none" />
        </Show>
      </span>

      <div class="grid justify-items-center gap-2">
        <h3 class="m-0 max-w-[22ch] text-balance text-title font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
          {props.state.title}
        </h3>
        <p class="m-0 max-w-[38ch] text-pretty text-caption/[1.55] text-[var(--text-weak)]">
          {props.state.detail}
        </p>
      </div>

      <Show when={props.state.primaryAction && props.state.primaryLabel}>
        <div class="flex min-h-11 flex-wrap items-center justify-center gap-1.5">
          <Button
            variant="primary"
            size="lg"
            disabled={props.busy}
            aria-busy={props.busy}
            onClick={runPrimary}
          >
            <Show
              when={props.busy}
              fallback={
                <Show when={props.state.primaryAction === "open-xcode"}>
                  <Icon name="external" size={13} />
                </Show>
              }
            >
              <span
                class="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
                aria-hidden="true"
              />
            </Show>
            {props.busy ? busyLabel() : props.state.primaryLabel}
          </Button>
          <Show when={props.state.secondaryRetry}>
            <button
              type="button"
              class="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-caption font-medium text-[var(--text-base)] transition-[background-color,color,transform] duration-150 ease-out hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-strong)] active:scale-[0.96] motion-reduce:active:scale-100"
              disabled={props.busy}
              onClick={props.onRetry}
            >
              <Icon name="refresh" size={13} /> Check again
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export function CoordinateTapPreview(props: { guide: CoordinateGuide; empty?: boolean }) {
  return (
    <div
      class={cn(
        "pointer-events-none absolute inset-0 z-[3] overflow-hidden",
        props.empty &&
          "bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--text-interactive-base)_5%,transparent),transparent_58%)]",
      )}
      role={props.empty ? "img" : undefined}
      aria-label={props.empty ? "Tap target preview" : undefined}
      aria-hidden={props.empty ? undefined : "true"}
      data-coordinate-preview={props.empty ? "empty" : "evidence"}
    >
      <i
        class="absolute top-0 border-l border-dashed border-[color-mix(in_srgb,var(--text-interactive-base)_72%,white)] opacity-80"
        data-coordinate-guide="vertical"
        style={{
          left: props.guide.left,
          top: props.guide.verticalGuide.top,
          height: props.guide.verticalGuide.height,
        }}
      />
      <i
        class="absolute left-0 border-t border-dashed border-[color-mix(in_srgb,var(--text-interactive-base)_72%,white)] opacity-80"
        data-coordinate-guide="horizontal"
        style={{
          left: props.guide.horizontalGuide.left,
          top: props.guide.top,
          width: props.guide.horizontalGuide.width,
        }}
      />
      <i
        class="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color-mix(in_srgb,var(--text-interactive-base)_76%,white)] shadow-[0_0_0_1px_rgb(0_0_0/35%)]"
        style={{ left: props.guide.horizontalOrigin, top: props.guide.top }}
      />
      <i
        class="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color-mix(in_srgb,var(--text-interactive-base)_76%,white)] shadow-[0_0_0_1px_rgb(0_0_0/35%)]"
        style={{ left: props.guide.left, top: props.guide.verticalOrigin }}
      />
      <i
        class="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/90 bg-[color-mix(in_srgb,var(--text-interactive-base)_22%,transparent)] shadow-[0_2px_8px_rgb(0_0_0/52%)] after:absolute after:inset-[5px] after:rounded-full after:bg-[var(--text-interactive-base)] after:shadow-[0_0_0_1.5px_white] after:content-['']"
        style={{ left: props.guide.left, top: props.guide.top }}
        data-coordinate-point
      />
    </div>
  );
}

function blankPreviewBounds(step: RecipeStep): DeviceBounds | undefined {
  if (step.evidence?.deviceBounds) return step.evidence.deviceBounds;
  if (step.kind === "tap") return step.target.point?.referenceBounds ?? DEFAULT_TOUCH_BOUNDS;
  if (step.kind === "swipe") {
    return step.from.referenceBounds ?? step.to.referenceBounds ?? DEFAULT_TOUCH_BOUNDS;
  }
  return undefined;
}

export function UncapturedStepPreview(props: {
  step: RecipeStep;
  onSwipePoint: (endpoint: SwipeEndpoint, point: { x: number; y: number }) => void;
}) {
  return (
    <>
      <Show when={props.step.kind === "swipe" ? props.step : undefined}>
        {(swipe) => (
          <SwipePathPreview
            from={swipe().from}
            to={swipe().to}
            bounds={blankPreviewBounds(swipe()) ?? DEFAULT_TOUCH_BOUNDS}
            onPoint={props.onSwipePoint}
          />
        )}
      </Show>
      <Show when={props.step.kind === "tap" && props.step.target.point ? props.step : undefined}>
        {(tap) => {
          const guide = () => targetPointGuide(tap().target.point, blankPreviewBounds(tap()));
          return (
            <Show when={guide()}>{(value) => <CoordinateTapPreview guide={value()} empty />}</Show>
          );
        }}
      </Show>
      <Show when={props.step.kind === "scroll" ? props.step : undefined}>
        {(scroll) => {
          const down = () => scroll().direction === "down";
          return (
            <div
              class="pointer-events-none absolute inset-0 z-[3]"
              role="img"
              aria-label={`Scroll ${scroll().direction}`}
            >
              <svg class="absolute inset-0 size-full" viewBox="0 0 100 100" aria-hidden="true">
                <line
                  x1="50"
                  y1={down() ? "38" : "62"}
                  x2="50"
                  y2={down() ? "62" : "38"}
                  stroke="var(--text-interactive-base)"
                  stroke-width="0.8"
                  stroke-dasharray="1.8 2.6"
                  stroke-linecap="round"
                  opacity="0.86"
                />
                <path
                  d={down() ? "M46.5 57.5 50 62l3.5-4.5" : "M46.5 42.5 50 38l3.5 4.5"}
                  fill="none"
                  stroke="var(--text-interactive-base)"
                  stroke-width="1.15"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
          );
        }}
      </Show>
    </>
  );
}
