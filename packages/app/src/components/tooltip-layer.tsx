import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { tooltipLabelFor, tooltipPlacement, type TooltipSide } from "../lib/tooltip-placement";

/** How long a pointer must rest on a control before it explains itself. */
const OPEN_DELAY_MS = 400;
/** After one tooltip has opened, moving along a toolbar shows the next one
 * immediately — waiting again for each button feels broken. The group resets
 * once the pointer has been away from every tipped control for this long. */
const SKIP_DELAY_MS = 300;

type Shown = { label: string; left: number; top: number; side: TooltipSide };

/**
 * One tooltip for the whole app, driven by the `data-tip` attribute that a
 * hundred controls already carry. Icon-only buttons are the reason it exists:
 * `aria-label` tells a screen reader what a glyph means but leaves a sighted
 * person guessing.
 *
 * Mounted once rather than per control so nothing has to become a positioned
 * ancestor, and so a tooltip on a button inside a scrolling panel is not
 * clipped by it.
 */
export function TooltipLayer() {
  const [shown, setShown] = createSignal<Shown | null>(null);
  const [visible, setVisible] = createSignal(false);
  let anchor: HTMLElement | null = null;
  let openTimer: number | undefined;
  let groupTimer: number | undefined;
  let warm = false;
  const refs: { tip?: HTMLDivElement } = {};

  const clearTimers = () => {
    if (openTimer) window.clearTimeout(openTimer);
    if (groupTimer) window.clearTimeout(groupTimer);
    openTimer = undefined;
    groupTimer = undefined;
  };

  const hide = () => {
    clearTimers();
    anchor = null;
    setVisible(false);
    setShown(null);
    groupTimer = window.setTimeout(() => (warm = false), SKIP_DELAY_MS);
  };

  const place = (element: HTMLElement, label: string) => {
    const rect = element.getBoundingClientRect();
    // Measure the real text at the real width before committing a position, so
    // the tooltip never appears in one place and jumps to another.
    setShown({ label, left: -9999, top: -9999, side: "bottom" });
    requestAnimationFrame(() => {
      if (anchor !== element) return;
      const box = refs.tip?.getBoundingClientRect();
      const placement = tooltipPlacement({
        anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        tooltip: { width: box?.width ?? 0, height: box?.height ?? 0 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      setShown({ label, ...placement });
      setVisible(true);
      warm = true;
    });
  };

  const open = (element: HTMLElement, immediate: boolean) => {
    const label = tooltipLabelFor({
      tip: element.getAttribute("data-tip"),
      text: element.textContent,
      disabled:
        element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true",
    });
    if (!label) return;
    clearTimers();
    anchor = element;
    if (immediate) {
      place(element, label);
      return;
    }
    openTimer = window.setTimeout(() => {
      if (anchor === element) place(element, label);
    }, OPEN_DELAY_MS);
  };

  onMount(() => {
    const tipped = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const element = tipped(event.target);
      if (!element) {
        if (anchor) hide();
        return;
      }
      if (element === anchor) return;
      open(element, warm);
    };
    // A press has already answered the question the tooltip was asking.
    const onPointerDown = () => hide();
    const onFocusIn = (event: FocusEvent) => {
      const element = tipped(event.target);
      // Only keyboard focus earns a tooltip; a click already focused the button.
      if (!element || !element.matches(":focus-visible")) {
        if (anchor) hide();
        return;
      }
      open(element, true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && anchor) hide();
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusIn, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);

    onCleanup(() => {
      clearTimers();
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusIn, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    });
  });

  return (
    <Show when={shown()}>
      {(tip) => (
        <Portal>
          <div
            ref={(element) => (refs.tip = element)}
            // aria-hidden: every anchor already carries its own accessible name,
            // so announcing this too would say the same thing twice.
            aria-hidden="true"
            class="pointer-events-none fixed max-w-[min(20rem,calc(100vw-1rem))] rounded-md border border-border-base bg-surface-strong px-2 py-1 text-micro text-text-strong shadow-md transition-[opacity,transform] duration-hover ease-out motion-reduce:transition-none"
            style={{
              "z-index": "var(--z-tooltip)",
              left: `${tip().left}px`,
              top: `${tip().top}px`,
              opacity: visible() ? "1" : "0",
              transform: visible()
                ? "translateY(0)"
                : `translateY(${tip().side === "bottom" ? "-2px" : "2px"})`,
            }}
          >
            {tip().label}
          </div>
        </Portal>
      )}
    </Show>
  );
}
