import { For, Show, createEffect, createSignal, type JSX } from "solid-js";
import type { HorizontalConstraint, VerticalConstraint } from "../lib/target-inspector";
import { cn } from "../lib/cn";

const HORIZONTAL: HorizontalConstraint[] = ["left", "center", "right"];
const VERTICAL: VerticalConstraint[] = ["top", "center", "bottom"];

function pinLabel(horizontal: HorizontalConstraint, vertical: VerticalConstraint): string {
  if (horizontal === "center" && vertical === "center") return "Center";
  return `${vertical} ${horizontal}`.replace(/^./, (letter) => letter.toUpperCase());
}

export function CoordinateConstraintPicker(props: {
  horizontal: HorizontalConstraint;
  vertical: VerticalConstraint;
  point: { x: number; y: number };
  active: boolean;
  onHorizontal: (value: HorizontalConstraint) => void;
  onVertical: (value: VerticalConstraint) => void;
  onPoint: (value: { x: number; y: number }) => void;
  onActivate: () => void;
  canUndo?: boolean;
  onUndo?: () => void;
}): JSX.Element {
  return (
    <section class="grid gap-2" aria-label="Coordinates">
      <button
        type="button"
        role="radio"
        aria-checked={props.active}
        class={cn(
          "grid min-h-10 w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left",
          "transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.985]",
          props.active
            ? "border-[color-mix(in_srgb,var(--v2-background-bg-accent)_58%,transparent)] bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_11%,var(--v2-background-bg-layer-01))]"
            : "border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] hover:border-[var(--v2-border-border-strong)] hover:bg-[var(--v2-background-bg-layer-02)]",
        )}
        onClick={props.onActivate}
      >
        <span
          class={cn(
            "grid size-3.5 place-items-center rounded-full border",
            props.active
              ? "border-[var(--v2-background-bg-accent)]"
              : "border-[var(--v2-border-border-strong)]",
          )}
          aria-hidden="true"
        >
          <i
            class={cn(
              "size-1.5 rounded-full",
              props.active && "bg-[var(--v2-background-bg-accent)]",
            )}
          />
        </span>
        <strong class="truncate text-[11px] font-medium text-[var(--text-strong)]">
          Coordinates
        </strong>
        <code class="font-mono text-[9.5px] tabular-nums text-[var(--text-base)]">
          {props.point.x}, {props.point.y}
        </code>
      </button>

      <Show when={props.active}>
        <div class="grid grid-cols-[minmax(0,1fr)_92px] items-start gap-2.5 pl-6">
          <div class="grid gap-1.5">
            <div class="flex h-5 items-center justify-between">
              <span class="text-[9.5px] font-medium text-[var(--text-weak)]">Position</span>
              <Show when={props.canUndo && props.onUndo}>
                <button
                  type="button"
                  class="rounded px-1.5 py-0.5 text-[9px] font-medium text-[var(--text-interactive-base)] transition-colors hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                  onClick={() => props.onUndo?.()}
                >
                  Undo
                </button>
              </Show>
            </div>
            <div class="grid grid-cols-2 gap-1.5" aria-label="Device coordinates">
              <CoordinateField
                axis="X"
                value={props.point.x}
                onValue={(x) => props.onPoint({ x, y: props.point.y })}
              />
              <CoordinateField
                axis="Y"
                value={props.point.y}
                onValue={(y) => props.onPoint({ x: props.point.x, y })}
              />
            </div>
            <p class="m-0 text-[9px]/[1.4] text-[var(--text-weak)]">
              Keeps this point in place on different screen sizes.
            </p>
          </div>

          <ConstraintPad
            horizontal={props.horizontal}
            vertical={props.vertical}
            onHorizontal={props.onHorizontal}
            onVertical={props.onVertical}
          />
        </div>
      </Show>
    </section>
  );
}

function CoordinateField(props: {
  axis: "X" | "Y";
  value: number;
  onValue: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal(String(props.value));
  let input: HTMLInputElement | undefined;

  createEffect(() => {
    if (document.activeElement !== input) setDraft(String(props.value));
  });

  function update(raw: string): void {
    setDraft(raw);
    if (!raw.trim()) return;
    const value = Number(raw);
    if (Number.isFinite(value)) props.onValue(Math.max(0, Math.round(value)));
  }

  return (
    <label class="grid h-8 grid-cols-[16px_minmax(0,1fr)] items-center rounded-md bg-[var(--v2-background-bg-layer-01)] px-2 shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)] focus-within:shadow-[inset_0_0_0_1px_var(--text-base),0_0_0_2px_color-mix(in_srgb,var(--text-base)_10%,transparent)]">
      <span class="font-mono text-[9px] text-[var(--text-weak)]">{props.axis}</span>
      <input
        ref={(element) => (input = element)}
        type="number"
        inputmode="numeric"
        min="0"
        step="1"
        aria-label={`${props.axis} coordinate`}
        class="min-w-0 bg-transparent p-0 font-mono text-[10.5px] tabular-nums text-[var(--text-strong)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        value={draft()}
        onInput={(event) => update(event.currentTarget.value)}
        onBlur={() => setDraft(String(props.value))}
      />
    </label>
  );
}

function ConstraintPad(props: {
  horizontal: HorizontalConstraint;
  vertical: VerticalConstraint;
  onHorizontal: (value: HorizontalConstraint) => void;
  onVertical: (value: VerticalConstraint) => void;
}): JSX.Element {
  return (
    <div class="grid gap-1">
      <span class="flex items-center justify-between gap-1 text-[9.5px] font-medium text-[var(--text-weak)]">
        <span>Pin to</span>
        <strong class="truncate text-[9px] font-medium text-[var(--text-base)]">
          {pinLabel(props.horizontal, props.vertical)}
        </strong>
      </span>
      <div
        class="grid h-[76px] w-[92px] grid-cols-3 grid-rows-3 gap-0.5 rounded-lg bg-[var(--v2-background-bg-deep)] p-1.5 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]"
        role="radiogroup"
        aria-label="Pin coordinates to screen"
      >
        <For each={VERTICAL}>
          {(vertical) => (
            <For each={HORIZONTAL}>
              {(horizontal) => {
                const selected = () =>
                  props.horizontal === horizontal && props.vertical === vertical;
                const positionLabel = () => pinLabel(horizontal, vertical);
                return (
                  <button
                    type="button"
                    role="radio"
                    class={cn(
                      "group grid min-h-0 min-w-0 place-items-center rounded-[5px] outline-none transition-[background-color,box-shadow,transform] duration-100 ease-out hover:bg-[color-mix(in_srgb,var(--text-base)_8%,transparent)] active:scale-90 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--text-base)]",
                      selected() &&
                        "bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--v2-background-bg-accent)_34%,transparent)]",
                    )}
                    aria-label={`Pin to ${positionLabel().toLowerCase()}`}
                    aria-checked={selected()}
                    data-tip={positionLabel()}
                    onClick={() => {
                      if (horizontal !== props.horizontal) props.onHorizontal(horizontal);
                      if (vertical !== props.vertical) props.onVertical(vertical);
                    }}
                  >
                    <i
                      class={cn(
                        "size-1.5 rounded-full bg-[var(--text-weak)] transition-[background-color,box-shadow,transform] duration-150 ease-out group-hover:scale-125",
                        selected() &&
                          "size-2 bg-[var(--v2-background-bg-accent)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)]",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                );
              }}
            </For>
          )}
        </For>
      </div>
    </div>
  );
}
