import { For, Show, type Accessor } from "solid-js";
import { Button } from "@relay/ui/button";
import type { PickStrategy } from "../lib/snapshot";
import { strategyIcon, strategyLabel, strategyValue } from "../lib/stage-presentation";
import type { HorizontalConstraint, VerticalConstraint } from "../lib/target-inspector";
import { cn } from "../lib/cn";
import { mono, popover } from "../lib/ui";
import { Icon } from "./icon";
import { CoordinateConstraintPicker } from "./coordinate-constraint-picker";

export type StagePickerState = {
  fx: number;
  fy: number;
  vx: number;
  vy: number;
  placement: "above" | "below";
  ancestry: unknown[];
  index: number;
};

export function StageTargetPicker(props: {
  picker: Accessor<StagePickerState>;
  setPickerEl: (element: HTMLDivElement) => void;
  nodeLabel: string;
  metaLine: string;
  ancestryLength: number;
  strategies: PickStrategy[];
  selectedStrategy: PickStrategy | undefined;
  strategyId: PickStrategy["id"];
  setStrategyId: (id: PickStrategy["id"]) => void;
  horizontalConstraint: HorizontalConstraint;
  verticalConstraint: VerticalConstraint;
  setHorizontalConstraint: (value: HorizontalConstraint) => void;
  setVerticalConstraint: (value: VerticalConstraint) => void;
  constrainedPoint: { x: number; y: number } | undefined;
  setManualPoint: (point: { x: number; y: number } | null) => void;
  hasPickerNodeRect: boolean;
  canAnchorToElement: boolean;
  coordinateSpace: "element" | "screen";
  setCoordinateSpace: (value: "element" | "screen") => void;
  onClose: () => void;
  onRetarget: (index: number) => void;
  onAddStep: (strategy: PickStrategy) => void;
  onTapDevice: (strategy: PickStrategy) => void;
}) {
  return (
    <div
      ref={(element) => {
        props.setPickerEl(element);
      }}
      class={cn(
        "absolute z-50 w-[252px]",
        props.picker().placement === "above"
          ? "-translate-y-[calc(100%+10px)]"
          : "translate-y-[10px]",
      )}
      style={{ left: `${props.picker().vx}px`, top: `${props.picker().vy}px` }}
    >
      <div
        class={cn(
          popover,
          "!overflow-visible border border-[var(--border-strong-base)] bg-surface-raised-stronger-non-alpha p-0 shadow-[var(--shadow-lg)]",
        )}
        style={{
          "--ui-pop-origin": props.picker().placement === "above" ? "bottom left" : "top left",
        }}
        role="dialog"
        aria-label="Choose target"
      >
        <header class="flex items-start justify-between gap-3 px-3 pt-3 pb-2.5">
          <span class="min-w-0">
            <small class="block text-micro font-semibold tracking-[0.11em] text-[var(--text-weak)] uppercase">
              Target
            </small>
            <strong class="mt-0.5 block truncate text-body font-semibold text-[var(--text-strong)]">
              {props.nodeLabel}
            </strong>
            <Show when={props.metaLine}>
              <span class={cn(mono, "mt-0.5 block truncate text-micro text-[var(--text-weak)]")}>
                {props.metaLine}
              </span>
            </Show>
          </span>
          <button
            type="button"
            class="grid size-11 shrink-0 place-items-center rounded-md text-[var(--text-weak)] transition-[background-color,color,transform] duration-hover ease-out-strong hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] active:scale-[0.96]"
            aria-label="Close target picker"
            onClick={props.onClose}
          >
            <Icon name="x" size={13} />
          </button>
        </header>

        <Show when={props.ancestryLength > 1}>
          <div class="mx-2.5 flex min-h-11 items-center justify-between rounded-lg bg-[var(--surface-base)] px-1">
            <button
              type="button"
              class="inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 text-micro font-medium text-[var(--text-weak)] transition-[background-color,color,transform] duration-hover ease-out-strong hover:enabled:bg-[var(--surface-base-hover)] hover:enabled:text-[var(--text-strong)] active:enabled:scale-[0.97] disabled:opacity-30"
              disabled={props.picker().index <= 0}
              onClick={() => props.onRetarget(props.picker().index - 1)}
            >
              <Icon name="chevron-down" size={12} /> Child
            </button>
            <span class={cn(mono, "text-micro tabular-nums text-[var(--text-weak)]")}>
              {props.picker().index + 1} / {props.ancestryLength}
            </span>
            <button
              type="button"
              class="inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 text-micro font-medium text-[var(--text-weak)] transition-[background-color,color,transform] duration-hover ease-out-strong hover:enabled:bg-[var(--surface-base-hover)] hover:enabled:text-[var(--text-strong)] active:enabled:scale-[0.97] disabled:opacity-30"
              disabled={props.picker().index >= props.ancestryLength - 1}
              onClick={() => props.onRetarget(props.picker().index + 1)}
            >
              Parent <Icon name="chevron-up" size={12} />
            </button>
          </div>
        </Show>

        <div class="grid gap-1 px-2.5 py-2.5" role="group" aria-label="Target method">
          <For each={props.strategies.filter((strategy) => strategy.kind !== "point")}>
            {(strategy) => {
              const selected = () => props.selectedStrategy?.id === strategy.id;
              return (
                <button
                  type="button"
                  aria-pressed={selected()}
                  class={cn(
                    "grid min-h-11 w-full grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 text-left",
                    "transition-[background-color,box-shadow,transform] duration-hover ease-out-strong hover:bg-[var(--surface-base-hover)] active:scale-[0.985]",
                    selected() &&
                      "bg-[var(--product-accent-soft)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text-interactive-base)_28%,transparent)]",
                  )}
                  onClick={() => {
                    props.setStrategyId(strategy.id);
                  }}
                >
                  <span
                    class={cn(
                      "grid size-[26px] place-items-center rounded-md bg-[var(--surface-base)] text-[var(--text-weak)]",
                      selected() && "text-[var(--text-interactive-base)]",
                    )}
                  >
                    <Icon name={strategyIcon(strategy)} size={13} />
                  </span>
                  <span class="min-w-0">
                    <strong class="block truncate text-micro font-medium text-[var(--text-base)]">
                      {strategyLabel(strategy)}
                    </strong>
                    <code class="mt-0.5 block truncate font-mono text-micro text-[var(--text-weak)]">
                      {strategyValue(strategy)}
                    </code>
                  </span>
                  <span
                    class={cn(
                      "size-3.5 rounded-full border border-[var(--border-strong-base)]",
                      selected() && "border-[4px] border-[var(--text-interactive-base)] bg-white",
                    )}
                    aria-hidden="true"
                  />
                </button>
              );
            }}
          </For>

          <Show
            when={props.hasPickerNodeRect && props.constrainedPoint}
            fallback={
              <button
                type="button"
                class={cn(
                  "grid min-h-11 w-full grid-cols-[26px_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 text-left",
                  "transition-[background-color,box-shadow,transform] duration-hover ease-out-strong hover:bg-[var(--surface-base-hover)] active:scale-[0.985]",
                  props.strategyId === "point" &&
                    "bg-[var(--product-accent-soft)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text-interactive-base)_28%,transparent)]",
                )}
                aria-pressed={props.strategyId === "point"}
                onClick={() => props.setStrategyId("point")}
              >
                <span class="grid size-[26px] place-items-center rounded-md bg-[var(--surface-base)] text-[var(--text-interactive-base)]">
                  <Icon name="scan" size={13} />
                </span>
                <span class="min-w-0">
                  <strong class="block text-micro font-medium text-[var(--text-base)]">
                    Coordinates
                  </strong>
                  <span class="mt-1 flex gap-1.5">
                    <code class="rounded bg-[var(--background-deep)] px-1.5 py-0.5 font-mono text-micro text-[var(--text-weak)]">
                      X {props.strategies.find((strategy) => strategy.kind === "point")?.x ?? 0}
                    </code>
                    <code class="rounded bg-[var(--background-deep)] px-1.5 py-0.5 font-mono text-micro text-[var(--text-weak)]">
                      Y {props.strategies.find((strategy) => strategy.kind === "point")?.y ?? 0}
                    </code>
                  </span>
                </span>
              </button>
            }
          >
            <div class="grid gap-2">
              <CoordinateConstraintPicker
                horizontal={props.horizontalConstraint}
                vertical={props.verticalConstraint}
                point={props.constrainedPoint!}
                active={props.strategyId === "point"}
                onConstraint={({ horizontal, vertical }) => {
                  props.setHorizontalConstraint(horizontal);
                  props.setVerticalConstraint(vertical);
                }}
                onPoint={props.setManualPoint}
                onActivate={() => props.setStrategyId("point")}
              />
              <Show when={props.strategyId === "point" && props.canAnchorToElement}>
                <div
                  class="grid grid-cols-2 gap-1 rounded-lg bg-[var(--background-deep)] p-1"
                  role="group"
                  aria-label="Coordinate reference"
                >
                  <button
                    type="button"
                    class={cn(
                      "min-h-11 rounded-md px-2 text-micro font-medium",
                      props.coordinateSpace === "element"
                        ? "bg-[var(--surface-base)] text-[var(--text-strong)] shadow-sm"
                        : "text-[var(--text-weak)]",
                    )}
                    aria-pressed={props.coordinateSpace === "element"}
                    onClick={() => props.setCoordinateSpace("element")}
                  >
                    Inside element
                  </button>
                  <button
                    type="button"
                    class={cn(
                      "min-h-11 rounded-md px-2 text-micro font-medium",
                      props.coordinateSpace === "screen"
                        ? "bg-[var(--surface-base)] text-[var(--text-strong)] shadow-sm"
                        : "text-[var(--text-weak)]",
                    )}
                    aria-pressed={props.coordinateSpace === "screen"}
                    onClick={() => props.setCoordinateSpace("screen")}
                  >
                    On screen
                  </button>
                </div>
                <p class="px-1 text-micro leading-4 text-[var(--text-weak)]">
                  {props.coordinateSpace === "element"
                    ? "Tracks this stable element when translated copy moves the layout."
                    : "Keeps the point pinned to the viewport."}
                </p>
              </Show>
            </div>
          </Show>
        </div>

        <footer class="flex items-center justify-end gap-1.5 border-t border-[var(--border-weak-base)] px-2.5 py-2.5">
          <Button
            variant="secondary"
            size="sm"
            class="text-micro"
            disabled={!props.selectedStrategy}
            onClick={() => {
              const strategy = props.selectedStrategy;
              if (strategy) props.onAddStep(strategy);
            }}
          >
            Add step
          </Button>
          <Button
            variant="primary"
            size="sm"
            class="text-micro"
            disabled={!props.selectedStrategy}
            onClick={() => {
              const strategy = props.selectedStrategy;
              if (strategy) props.onTapDevice(strategy);
            }}
          >
            <Icon name="pointer" size={12} /> Tap device
          </Button>
        </footer>
      </div>
    </div>
  );
}
