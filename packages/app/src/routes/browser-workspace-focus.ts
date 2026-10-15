import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Frame = { rect: DOMRect; opacity: string };
type Motion = {
  before?: Map<string, Frame>;
  active: Map<HTMLElement, Animation>;
};

function cancelMotion(motion: Motion) {
  for (const [element, animation] of motion.active) {
    animation.cancel();
    element.removeAttribute("data-workspace-moving");
  }
  motion.active.clear();
}

/** Resize the existing live tiles; never replace their canvases or sessions. */
export function useBrowserWorkspaceFocus() {
  const [focused, setFocused] = useState<string>();
  const container = useRef<HTMLElement>(null);
  const motion = useRef<Motion>({ active: new Map() });

  function focus(next?: string, animate = false) {
    if (next === focused) return;
    const state = motion.current;
    const before = new Map<string, Frame>();
    if (animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const element of container.current?.querySelectorAll<HTMLElement>(
        "[data-browser-tile]",
      ) ?? []) {
        if (element.hidden) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width && rect.height)
          before.set(element.dataset.browserTile!, {
            rect,
            opacity: getComputedStyle(element).opacity,
          });
      }
    }
    // Read the current animated position before cancelling, so rapid reversals
    // continue from what the user sees instead of jumping to an old endpoint.
    cancelMotion(state);
    state.before = before.size ? before : undefined;
    setFocused(next);
  }

  useLayoutEffect(() => {
    const state = motion.current;
    const before = state.before;
    state.before = undefined;
    if (!before || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const element of container.current?.querySelectorAll<HTMLElement>("[data-browser-tile]") ??
      []) {
      if (element.hidden || typeof element.animate !== "function") continue;
      const after = element.getBoundingClientRect();
      if (!after.width || !after.height) continue;
      const previous = before.get(element.dataset.browserTile!);
      const transform = previous
        ? `translate(${previous.rect.x - after.x}px, ${previous.rect.y - after.y}px) scale(${previous.rect.width / after.width}, ${previous.rect.height / after.height})`
        : "none";
      if (previous) element.setAttribute("data-workspace-moving", "");
      const animation = element.animate(
        [
          { transform, transformOrigin: "top left", opacity: previous?.opacity ?? 0 },
          { transform: "none", transformOrigin: "top left", opacity: 1 },
        ],
        {
          duration: previous ? (focused ? 240 : 200) : 160,
          easing: "cubic-bezier(0.455, 0.03, 0.515, 0.955)",
        },
      );
      state.active.set(element, animation);
      const finish = () => {
        if (state.active.get(element) !== animation) return;
        element.removeAttribute("data-workspace-moving");
        state.active.delete(element);
      };
      animation.onfinish = finish;
      animation.oncancel = finish;
    }
  }, [focused]);

  useEffect(() => {
    const state = motion.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {
      if (preference.matches) cancelMotion(state);
    };
    preference.addEventListener("change", change);
    return () => {
      preference.removeEventListener("change", change);
      cancelMotion(state);
    };
  }, []);

  return { focused, focus, container };
}
