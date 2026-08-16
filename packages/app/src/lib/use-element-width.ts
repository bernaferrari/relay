import { createSignal, onCleanup, type Accessor } from "solid-js";

/**
 * Measures an element instead of the viewport. A workspace can lose 280px to the
 * shell's map library without the viewport changing, so viewport media queries
 * pick the wrong layout exactly when space is tight.
 *
 * Returns a `ref` to attach and an accessor for the observed content width.
 * Hosts without `ResizeObserver` (and server rendering) keep the fallback, so
 * the caller never has to branch on environment.
 */
export function useElementWidth(fallback = 1440): {
  ref: (element: HTMLElement) => void;
  width: Accessor<number>;
} {
  const [width, setWidth] = createSignal(fallback);
  let observer: ResizeObserver | undefined;

  onCleanup(() => observer?.disconnect());

  return {
    width,
    ref: (element: HTMLElement) => {
      observer?.disconnect();
      if (typeof ResizeObserver === "undefined") return;
      observer = new ResizeObserver((entries) => {
        const measured = entries[0]?.contentRect.width ?? element.clientWidth;
        if (measured > 0) setWidth(Math.round(measured));
      });
      observer.observe(element);
      if (element.clientWidth > 0) setWidth(element.clientWidth);
    },
  };
}
