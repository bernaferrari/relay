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
  sourceName,
  rect,
  before,
  elementRef,
}: {
  side: DockSide;
  name: string;
  sourceName: string;
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
      role="img"
      aria-label={`${sourceName}: ${label[side].toLowerCase()} ${name}`}
      style={
        {
          "--dock-left": `calc(${rect.x}% + ${(12 * rect.x) / 100 + 6}px)`,
          "--dock-top": `calc(${rect.y}% + ${(12 * rect.y) / 100 + 6}px)`,
          "--dock-width": `calc(${rect.width}% - ${12 * (1 - rect.width / 100) + 12}px)`,
          "--dock-height": `calc(${rect.height}% - ${12 * (1 - rect.height / 100) + 12}px)`,
        } as CSSProperties
      }
      className="pointer-events-none absolute top-(--dock-top) left-(--dock-left) z-50 h-(--dock-height) w-(--dock-width) overflow-hidden rounded-xl border-2 border-primary/70 bg-primary/10"
    >
      <div className="relative flex h-11 items-center border-b border-primary/20 bg-primary/10 px-3">
        <span className="max-w-2/3 truncate text-sm font-medium text-foreground">{sourceName}</span>
        <span
          className="absolute top-1/2 left-1/2 h-1 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/40"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
