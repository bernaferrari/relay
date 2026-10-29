import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "relay.workspace.outline-width";
const DEFAULT_WIDTH = 352;
const MIN_WIDTH = 256;

function savedWidth() {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value >= MIN_WIDTH ? Math.min(value, 960) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/** A shared width keeps the outline steady when switching between run views. */
export function useWorkspaceDivider() {
  const [width, setWidth] = useState(savedWidth);
  const grid = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(1600);
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    setAvailableWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailableWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const maximumWidth = Math.max(MIN_WIDTH, Math.min(960, availableWidth * 0.6));
  const visibleWidth = Math.min(width, maximumWidth);
  const drag = useRef<{ pointer: number; start: number; width: number }>(null);
  const maximum = () =>
    Math.max(MIN_WIDTH, Math.min(960, (grid.current?.clientWidth ?? 1000) * 0.6));
  const resize = (value: number) => {
    const next = Math.round(Math.max(MIN_WIDTH, Math.min(maximum(), value)));
    setWidth(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Resizing still works when browser storage is unavailable.
    }
  };
  return {
    grid,
    width,
    divider: (
      <div
        role="separator"
        aria-label="Resize steps panel"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={Math.floor(maximumWidth)}
        aria-valuenow={Math.round(visibleWidth)}
        tabIndex={0}
        title="Drag to resize · Double-click to reset"
        className="absolute inset-y-0 -right-1 z-20 hidden w-2 cursor-col-resize touch-none select-none items-center justify-center outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring @2xl/workspace:flex"
        onDoubleClick={() => resize(DEFAULT_WIDTH)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
          event.preventDefault();
          resize(
            event.key === "Home"
              ? DEFAULT_WIDTH
              : visibleWidth + (event.key === "ArrowRight" ? 24 : -24),
          );
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          const outline = event.currentTarget.parentElement!;
          drag.current = {
            pointer: event.pointerId,
            start: event.clientX,
            width: outline.clientWidth,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus();
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointer === event.pointerId)
            resize(drag.current.width + event.clientX - drag.current.start);
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer !== event.pointerId) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <span className="h-8 w-0.5 rounded-full bg-border" aria-hidden="true" />
      </div>
    ),
  };
}
