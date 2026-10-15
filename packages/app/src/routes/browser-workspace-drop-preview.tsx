/** @jsxImportSource react */
import { useLayoutEffect, type CSSProperties, type RefObject } from "react";
import type { BrowserRect, DockSide } from "../data/browser-workspace-layout";
const label: Record<DockSide, string> = {
  left: "Left of",
  right: "Right of",
  top: "Above",
  bottom: "Below",
};

/** Show the actual post-drop allocation, inside all four borders of the workspace. */
export function BrowserWorkspaceDropPreview({
  side,
  name,
  rect,
  before,
  elementRef,
}: {
  side: DockSide;
  name: string;
  rect: BrowserRect;
  before?: DOMRect;
  elementRef: RefObject<HTMLDivElement | null>;
}) {
  useLayoutEffect(() => {
    const element = elementRef.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!element || preference.matches) return;
    const after = element.getBoundingClientRect();
    const transform =
      before && after.width && after.height
        ? `translate(${before.x - after.x}px, ${before.y - after.y}px) scale(${before.width / after.width}, ${before.height / after.height})`
        : "scale(0.98)";
    const animation = element.animate?.(
      [
        { transform, transformOrigin: "top left", opacity: before ? 1 : 0 },
        { transform: "none", transformOrigin: "top left", opacity: 1 },
      ],
      { duration: before ? 180 : 120, easing: "cubic-bezier(0.455, 0.03, 0.515, 0.955)" },
    );
    void animation?.finished.catch(() => undefined);
    const cancel = () => {
      if (preference.matches) animation?.cancel();
    };
    preference.addEventListener("change", cancel);
    return () => {
      preference.removeEventListener("change", cancel);
      animation?.cancel();
    };
  }, [rect.x, rect.y, rect.width, rect.height, side, elementRef]);
  return (
    <div
      ref={elementRef}
      data-dock-side={side}
      style={
        {
          "--dock-left": `calc(${rect.x}% + ${rect.x > 0.01 ? 12 : 6}px)`,
          "--dock-top": `calc(${rect.y}% + ${rect.y > 0.01 ? 12 : 6}px)`,
          "--dock-width": `calc(${rect.width}% - ${(rect.x > 0.01 ? 6 : 0) + (rect.x + rect.width < 99.99 ? 6 : 0) + 12}px)`,
          "--dock-height": `calc(${rect.height}% - ${(rect.y > 0.01 ? 6 : 0) + (rect.y + rect.height < 99.99 ? 6 : 0) + 12}px)`,
        } as CSSProperties
      }
      className="pointer-events-none absolute top-(--dock-top) left-(--dock-left) z-50 flex h-(--dock-height) w-(--dock-width) items-center justify-center rounded-lg border-2 border-primary bg-primary/15"
    >
      <span className="max-w-full truncate rounded-md bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm">
        {label[side]} {name}
      </span>
    </div>
  );
}
