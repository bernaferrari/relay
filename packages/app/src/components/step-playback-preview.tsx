import { Match, Switch, type JSX } from "solid-js";
import { type RecipeStep, type StepPoint } from "@relay/protocol";
import { Icon } from "./icon";

type Bounds = { width: number; height: number };
type Point = { x: number; y: number };

function pointForTapPreview(step: Extract<RecipeStep, { kind: "tap" }>, bounds: Bounds): Point {
  const point: StepPoint | undefined = step.target.point ?? step.evidence?.pointer;
  // Playback is drawn over the recorded image, so it must show the authored
  // point literally. Responsive pinning belongs to execution on a different
  // device; resolving it here made a recorded tap visibly drift from X/Y.
  if (point) {
    return {
      x: Math.max(0, Math.min(bounds.width, Math.round(point.x))),
      y: Math.max(0, Math.min(bounds.height, Math.round(point.y))),
    };
  }

  const rect = step.evidence?.node?.rect;
  if (rect) return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };

  return { x: bounds.width / 2, y: bounds.height / 2 };
}

function position(point: Point, bounds: Bounds) {
  return {
    left: `${Math.max(0, Math.min(100, (point.x / bounds.width) * 100))}%`,
    top: `${Math.max(0, Math.min(100, (point.y / bounds.height) * 100))}%`,
  };
}

/**
 * A playback-only cue layered over recorded evidence. It never sends input to
 * the device or mutates the captured image — Run remains the real execution.
 */
export function StepPlaybackPreview(props: {
  step: RecipeStep;
  bounds: Bounds;
}): JSX.Element | null {
  return (
    <Switch>
      <Match when={props.step.kind === "tap"}>
        {(() => {
          const step = props.step as Extract<RecipeStep, { kind: "tap" }>;
          return (
            <span
              class="pointer-events-none absolute z-[7] size-7 -translate-x-1/2 -translate-y-1/2"
              style={position(pointForTapPreview(step, props.bounds), props.bounds)}
              aria-hidden="true"
              data-step-playback="tap"
            >
              <i class="absolute inset-0 rounded-full border-[1.5px] border-white/95 bg-[color-mix(in_srgb,var(--text-interactive-base)_24%,transparent)] shadow-[0_2px_10px_rgb(0_0_0/44%)] motion-safe:animate-[step-preview-tap_620ms_ease-out_both]" />
              <i class="step-preview-tap-dot absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-interactive-base)] shadow-[0_0_0_1.5px_white,0_1px_4px_rgb(0_0_0/48%)]" />
            </span>
          );
        })()}
      </Match>
      <Match when={props.step.kind === "scroll"}>
        {(() => {
          const step = props.step as Extract<RecipeStep, { kind: "scroll" }>;
          const down = step.direction === "down";
          return (
            <svg
              class="pointer-events-none absolute inset-0 z-[7] size-full overflow-visible"
              viewBox="0 0 100 100"
              aria-hidden="true"
              data-step-playback="scroll"
            >
              <g
                class={
                  down
                    ? "motion-safe:animate-[step-preview-scroll-down_700ms_cubic-bezier(0.23,1,0.32,1)_both]"
                    : "motion-safe:animate-[step-preview-scroll-up_700ms_cubic-bezier(0.23,1,0.32,1)_both]"
                }
              >
                <line
                  x1="50"
                  y1={down ? "36" : "64"}
                  x2="50"
                  y2={down ? "64" : "36"}
                  stroke="var(--text-interactive-base)"
                  stroke-width="1"
                  stroke-dasharray="2 3"
                  stroke-linecap="round"
                />
                <path
                  d={down ? "M45.5 58.5 50 64l4.5-5.5" : "M45.5 41.5 50 36l4.5 5.5"}
                  fill="none"
                  stroke="white"
                  stroke-width="1.45"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </g>
            </svg>
          );
        })()}
      </Match>
      <Match when={props.step.kind === "type"}>
        {(() => {
          const step = props.step as Extract<RecipeStep, { kind: "type" }>;
          return (
            <span
              class="step-preview-label pointer-events-none absolute inset-x-4 bottom-4 z-[7] flex justify-center"
              aria-hidden="true"
              data-step-playback="type"
            >
              <span class="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--surface-float-base)_90%,transparent)] px-2.5 py-1.5 text-micro text-[var(--text-invert-strong)] shadow-[0_8px_22px_color-mix(in_srgb,var(--surface-float-base)_38%,transparent)]">
                <Icon name="keyboard" size={12} />
                <span class="max-w-[18ch] truncate font-mono">{step.text}</span>
              </span>
            </span>
          );
        })()}
      </Match>
      <Match when={props.step.kind === "key"}>
        {(() => {
          const step = props.step as Extract<RecipeStep, { kind: "key" }>;
          return (
            <span
              class="step-preview-label pointer-events-none absolute inset-x-4 bottom-4 z-[7] flex justify-center"
              aria-hidden="true"
              data-step-playback="key"
            >
              <span class="inline-flex items-center gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--surface-float-base)_90%,transparent)] px-2.5 py-1.5 text-micro text-[var(--text-invert-strong)] shadow-[0_8px_22px_color-mix(in_srgb,var(--surface-float-base)_38%,transparent)]">
                <Icon name="keyboard" size={12} /> {step.key === "back" ? "Back" : "Home"}
              </span>
            </span>
          );
        })()}
      </Match>
    </Switch>
  );
}
