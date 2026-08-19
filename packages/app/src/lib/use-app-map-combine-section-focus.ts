import { createEffect, type Accessor } from "solid-js";
import type { CanvasCombineSection } from "./app-map-combine-canvas";

/** Keeps deep-linked matrix sections visible without stealing focus from editors. */
export function useAppMapCombineSectionFocus(options: {
  section: Accessor<CanvasCombineSection | undefined>;
  editorOpen: Accessor<boolean>;
}) {
  let scrollArea: HTMLDivElement | undefined;
  createEffect(() => {
    const sectionName = options.section();
    if (!sectionName || !scrollArea || options.editorOpen()) return;
    queueMicrotask(() => {
      const section = scrollArea?.querySelector<HTMLElement>(
        `[data-combine-section="${sectionName}"]`,
      );
      if (!section || !scrollArea) return;
      scrollArea.scrollTop = Math.max(0, section.offsetTop - 12);
      section.focus({ preventScroll: true });
    });
  });
  return (element: HTMLDivElement) => {
    scrollArea = element;
  };
}
