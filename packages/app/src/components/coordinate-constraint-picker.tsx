import { For, Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import type { HorizontalConstraint, VerticalConstraint } from "../lib/target-inspector";
import { cn } from "../lib/cn";

const HORIZONTAL: HorizontalConstraint[] = ["left", "center", "right"];
const VERTICAL: VerticalConstraint[] = ["top", "center", "bottom"];
const PIN_POPOVER = { width: 136, height: 112 };

function pinLabel(horizontal: HorizontalConstraint, vertical: VerticalConstraint): string {
  if (horizontal === "center" && vertical === "center") return "Center";
  return `${vertical} ${horizontal}`.replace(/^./, (letter) => letter.toUpperCase());
}

export function CoordinateConstraintPicker(props: {
  horizontal: HorizontalConstraint;
  vertical: VerticalConstraint;
  point: { x: number; y: number };
  active: boolean;
  onConstraint: (value: { horizontal: HorizontalConstraint; vertical: VerticalConstraint }) => void;
  onPoint: (value: { x: number; y: number }) => void;
  onActivate: () => void;
}): JSX.Element {
  const positionFields = () => (
    <div class="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2.5">
      <span class="text-[9.5px] font-medium text-[var(--text-weak)]">Position</span>
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
    </div>
  );

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
        <div class="grid gap-2.5 px-0.5 pt-0.5">
          {positionFields()}
          <div class="grid grid-cols-[52px_minmax(0,1fr)] items-start gap-2.5">
            <span class="pt-1 text-[9.5px] font-medium text-[var(--text-weak)]">Pin to</span>
            <CoordinatePinPicker
              horizontal={props.horizontal}
              vertical={props.vertical}
              onConstraint={props.onConstraint}
            />
          </div>
        </div>
      </Show>
    </section>
  );
}

/** Compact disclosure used when two points intentionally share one pin constraint. */
export function CoordinatePinPicker(props: {
  horizontal: HorizontalConstraint;
  vertical: VerticalConstraint;
  onConstraint: (value: { horizontal: HorizontalConstraint; vertical: VerticalConstraint }) => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [position, setPosition] = createSignal<{ left: number; top: number }>();
  let root: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  let content: HTMLDivElement | undefined;

  function syncPosition(): void {
    const rect = trigger?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(
        8,
        Math.min(window.innerWidth - PIN_POPOVER.width - 8, rect.right - PIN_POPOVER.width),
      ),
      top: Math.min(window.innerHeight - PIN_POPOVER.height - 8, rect.bottom + 6),
    });
  }

  createEffect(() => {
    if (!open()) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root?.contains(target) && !content?.contains(target)) setOpen(false);
    };
    const reposition = () => syncPosition();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger?.focus({ preventScroll: true });
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("keydown", onKeyDown, true);
    });
  });

  return (
    <div
      ref={(element) => (root = element)}
      class="w-full"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open()) return;
        event.preventDefault();
        setOpen(false);
      }}
    >
      <button
        ref={(element) => (trigger = element)}
        type="button"
        class="grid h-8 w-full grid-cols-[minmax(0,1fr)_12px] items-center gap-1.5 rounded-md bg-[var(--v2-background-bg-layer-01)] px-2.5 text-left shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)] transition-[background-color,box-shadow] duration-100 ease-out hover:bg-[var(--v2-background-bg-layer-02)] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--text-base),0_0_0_2px_color-mix(in_srgb,var(--text-base)_10%,transparent)]"
        aria-haspopup="dialog"
        aria-expanded={open()}
        onClick={() => {
          if (!open()) syncPosition();
          setOpen((value) => !value);
        }}
      >
        <span class="truncate text-[10.5px] text-[var(--text-strong)]">
          {pinLabel(props.horizontal, props.vertical)}
        </span>
        <svg viewBox="0 0 12 12" class="size-3 text-[var(--text-weak)]" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.25" />
        </svg>
      </button>

      <Show when={open()}>
        <Portal>
          <div
            ref={(element) => (content = element)}
            class="ui-pop fixed z-[100] rounded-xl bg-surface-raised-stronger-non-alpha p-2 shadow-[0_14px_30px_rgb(0_0_0/48%)]"
            style={{
              left: `${position()?.left ?? 8}px`,
              top: `${position()?.top ?? 8}px`,
            }}
            role="dialog"
            aria-label="Pin both swipe points"
          >
            <ConstraintPad
              bare
              flat
              large
              horizontal={props.horizontal}
              vertical={props.vertical}
              onConstraint={(value) => {
                props.onConstraint(value);
                setOpen(false);
              }}
            />
          </div>
        </Portal>
      </Show>
    </div>
  );
}

function CoordinateField(props: {
  axis: "X" | "Y";
  value: number;
  onValue: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal(String(props.value));
  const [scrubbing, setScrubbing] = createSignal(false);
  let input: HTMLInputElement | undefined;
  let scrub:
    | {
        pointerId: number;
        startX: number;
        startValue: number;
        lastValue: number;
        cursor: string;
        userSelect: string;
      }
    | undefined;

  createEffect(() => {
    if (document.activeElement !== input) setDraft(String(props.value));
  });

  function update(raw: string): void {
    setDraft(raw);
    if (!raw.trim()) return;
    const value = Number(raw);
    if (Number.isFinite(value)) props.onValue(Math.max(0, Math.round(value)));
  }

  function startScrub(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLSpanElement;
    scrub = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: props.value,
      lastValue: props.value,
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    setScrubbing(true);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    handle.setPointerCapture(event.pointerId);
  }

  function moveScrub(event: PointerEvent): void {
    const active = scrub;
    if (!active || active.pointerId !== event.pointerId) return;
    const scale = event.shiftKey ? 10 : 1;
    const next = Math.max(
      0,
      Math.round(active.startValue + (event.clientX - active.startX) * scale),
    );
    if (next === active.lastValue) return;
    active.lastValue = next;
    setDraft(String(next));
    props.onValue(next);
  }

  function stopScrub(event?: PointerEvent): void {
    const active = scrub;
    if (!active || (event && active.pointerId !== event.pointerId)) return;
    const handle = event?.currentTarget as HTMLSpanElement | undefined;
    if (handle?.hasPointerCapture && handle.hasPointerCapture(active.pointerId)) {
      handle.releasePointerCapture(active.pointerId);
    }
    document.body.style.cursor = active.cursor;
    document.body.style.userSelect = active.userSelect;
    scrub = undefined;
    setScrubbing(false);
  }

  onCleanup(() => stopScrub());

  return (
    <div
      class={cn(
        "grid h-8 grid-cols-[22px_minmax(0,1fr)] items-center rounded-md bg-[var(--v2-background-bg-layer-01)] pr-2 pl-1 shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)]",
        "focus-within:shadow-[inset_0_0_0_1px_var(--text-base),0_0_0_2px_color-mix(in_srgb,var(--text-base)_10%,transparent)]",
        scrubbing() &&
          "shadow-[inset_0_0_0_1px_var(--v2-background-bg-accent),0_0_0_2px_color-mix(in_srgb,var(--v2-background-bg-accent)_12%,transparent)]",
      )}
    >
      <span
        class={cn(
          "grid h-full touch-none cursor-ew-resize place-items-center rounded-l-md font-mono text-[9px] text-[var(--text-weak)] select-none",
          "hover:text-[var(--text-interactive-base)]",
          scrubbing() && "text-[var(--text-interactive-base)]",
        )}
        data-tip={`Drag to adjust ${props.axis}`}
        data-scrub-axis={props.axis.toLowerCase()}
        aria-hidden="true"
        onPointerDown={startScrub}
        onPointerMove={moveScrub}
        onPointerUp={stopScrub}
        onPointerCancel={stopScrub}
        onLostPointerCapture={stopScrub}
      >
        {props.axis}
      </span>
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
    </div>
  );
}

function ConstraintPad(props: {
  horizontal: HorizontalConstraint;
  vertical: VerticalConstraint;
  onConstraint: (value: { horizontal: HorizontalConstraint; vertical: VerticalConstraint }) => void;
  bare?: boolean;
  flat?: boolean;
  large?: boolean;
}): JSX.Element {
  const selectedX = () =>
    props.horizontal === "left" ? 21.5 : props.horizontal === "center" ? 52 : 82.5;
  const selectedY = () => (props.vertical === "top" ? 18 : props.vertical === "center" ? 41 : 64);
  const horizontalGuideStart = () => (props.horizontal === "right" ? selectedX() : 6.5);
  const horizontalGuideEnd = () => (props.horizontal === "left" ? selectedX() : 97.5);
  const verticalGuideStart = () => (props.vertical === "bottom" ? selectedY() : 6.5);
  const verticalGuideEnd = () => (props.vertical === "top" ? selectedY() : 75.5);

  const pad = (
    <div class={cn("grid gap-1", props.bare && "gap-0")}>
      <Show when={!props.bare}>
        <span class="flex items-center justify-between gap-1 text-[9.5px] font-medium text-[var(--text-weak)]">
          <span>Pin to</span>
          <strong class="truncate text-[9px] font-medium text-[var(--text-base)]">
            {pinLabel(props.horizontal, props.vertical)}
          </strong>
        </span>
      </Show>
      <div
        class={cn(
          "relative h-[82px] w-[104px] overflow-hidden rounded-lg",
          props.flat
            ? "bg-transparent"
            : "bg-[var(--v2-background-bg-deep)] shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]",
        )}
        role="radiogroup"
        aria-label="Pin coordinates to screen"
      >
        <svg
          class="pointer-events-none absolute inset-0 z-[2] size-full"
          viewBox="0 0 104 82"
          aria-hidden="true"
        >
          <rect
            x="6.5"
            y="6.5"
            width="91"
            height="69"
            rx="7"
            fill="none"
            stroke="var(--v2-border-border-muted)"
          />
          <line
            x1={horizontalGuideStart()}
            y1={selectedY()}
            x2={horizontalGuideEnd()}
            y2={selectedY()}
            stroke="var(--v2-background-bg-accent)"
            stroke-width="1.25"
            stroke-dasharray="2.5 3"
            stroke-linecap="round"
            data-pin-guide="horizontal"
          />
          <line
            x1={selectedX()}
            y1={verticalGuideStart()}
            x2={selectedX()}
            y2={verticalGuideEnd()}
            stroke="var(--v2-background-bg-accent)"
            stroke-width="1.25"
            stroke-dasharray="2.5 3"
            stroke-linecap="round"
            data-pin-guide="vertical"
          />
        </svg>

        <div class="absolute inset-1.5 z-[3] grid grid-cols-3 grid-rows-3">
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
                        "group grid min-h-0 min-w-0 cursor-pointer place-items-center rounded-[5px] outline-none",
                        "transition-[background-color,transform] duration-100 ease-out hover:bg-[color-mix(in_srgb,var(--text-base)_7%,transparent)] active:scale-90",
                        "focus-visible:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_12%,transparent)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--v2-background-bg-accent)]",
                      )}
                      aria-label={`Pin to ${positionLabel().toLowerCase()}`}
                      aria-checked={selected()}
                      data-tip={positionLabel()}
                      onClick={() => props.onConstraint({ horizontal, vertical })}
                    >
                      <i
                        class={cn(
                          "size-1.5 rounded-full border border-[color-mix(in_srgb,var(--text-base)_28%,transparent)] bg-[color-mix(in_srgb,var(--text-base)_58%,var(--v2-background-bg-deep))]",
                          "transition-[background-color,border-color,box-shadow,transform] duration-100 group-hover:scale-125 group-hover:border-[color-mix(in_srgb,var(--text-base)_55%,transparent)] group-hover:bg-[var(--text-base)]",
                          selected() &&
                            "scale-125 border-[color-mix(in_srgb,var(--v2-background-bg-accent)_72%,white)] bg-[var(--v2-background-bg-accent)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--v2-background-bg-accent)_20%,transparent)] group-hover:bg-[var(--v2-background-bg-accent)]",
                        )}
                        aria-hidden="true"
                      />
                      <span class="sr-only">{positionLabel()}</span>
                    </button>
                  );
                }}
              </For>
            )}
          </For>
        </div>
      </div>
    </div>
  );

  return props.large ? (
    <div class="h-[94px] w-[120px]">
      <div class="origin-top-left scale-[1.15]">{pad}</div>
    </div>
  ) : (
    pad
  );
}
