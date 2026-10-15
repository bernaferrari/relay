/** @jsxImportSource react */
import { useRef, type ReactNode, type CSSProperties } from "react";
import {
  browserLayoutGeometry,
  type BrowserLayout,
  type BrowserSplit,
} from "../data/browser-workspace-layout";

export function BrowserWorkspaceGrid({
  layout,
  focused,
  onResize,
  children,
}: {
  layout?: BrowserLayout;
  focused: boolean;
  onResize(path: string, ratio: number, persist: boolean): void;
  children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<BrowserSplit | undefined>(undefined);
  const splits = focused ? [] : browserLayoutGeometry(layout).splits;
  return (
    <div
      ref={container}
      className="relative isolate flex min-h-0 flex-1 flex-col gap-3 overflow-visible"
    >
      {children}
      {splits.map((split, index) => {
        const horizontal = split.axis === "horizontal";
        const boundaryX = split.x + (horizontal ? (split.width * split.ratio) / 100 : 0);
        const boundaryY = split.y + (horizontal ? 0 : (split.height * split.ratio) / 100);
        const style = {
          "--divider-left": `calc(${boundaryX}% + ${(12 * boundaryX) / 100 - (horizontal ? 6 : 0)}px)`,
          "--divider-top": `calc(${boundaryY}% + ${(12 * boundaryY) / 100 - (horizontal ? 0 : 6)}px)`,
          "--divider-width": `calc(${split.width}% - ${12 * (1 - split.width / 100)}px)`,
          "--divider-height": `calc(${split.height}% - ${12 * (1 - split.height / 100)}px)`,
        } as CSSProperties;
        function ratioAt(x: number, y: number) {
          const bounds = container.current!.getBoundingClientRect();
          const frame = drag.current ?? split;
          return horizontal
            ? ((((x - bounds.left + 6) / (bounds.width + 12)) * 100 - frame.x) / frame.width) * 100
            : ((((y - bounds.top + 6) / (bounds.height + 12)) * 100 - frame.y) / frame.height) *
                100;
        }
        return (
          <div
            key={split.path}
            role="separator"
            aria-label={`Resize browser ${horizontal ? "columns" : "rows"}${index ? ` ${index + 1}` : ""}`}
            aria-orientation={horizontal ? "vertical" : "horizontal"}
            aria-valuenow={Math.round(split.ratio)}
            aria-valuemin={25}
            aria-valuemax={75}
            tabIndex={0}
            style={style}
            className={`absolute top-(--divider-top) left-(--divider-left) z-10 flex touch-none items-center justify-center outline-none before:rounded-full before:bg-border before:transition-colors hover:before:bg-primary focus-visible:before:bg-primary motion-reduce:before:transition-none ${horizontal ? "h-(--divider-height) w-3 -translate-x-1/2 cursor-col-resize before:h-10 before:w-1" : "h-3 w-(--divider-width) -translate-y-1/2 cursor-row-resize before:h-1 before:w-10"}`}
            onDoubleClick={() => onResize(split.path, 50, true)}
            onKeyDown={(event) => {
              const decrement = horizontal ? "ArrowLeft" : "ArrowUp";
              const increment = horizontal ? "ArrowRight" : "ArrowDown";
              if (![decrement, increment, "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              onResize(
                split.path,
                event.key === "Home"
                  ? 25
                  : event.key === "End"
                    ? 75
                    : split.ratio + (event.key === increment ? 5 : -5),
                true,
              );
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              drag.current = split;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId))
                onResize(split.path, ratioAt(event.clientX, event.clientY), false);
            }}
            onPointerUp={(event) => {
              if (!drag.current) return;
              onResize(split.path, ratioAt(event.clientX, event.clientY), true);
              drag.current = undefined;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              if (drag.current) onResize(split.path, drag.current.ratio, false);
              drag.current = undefined;
            }}
          />
        );
      })}
    </div>
  );
}
