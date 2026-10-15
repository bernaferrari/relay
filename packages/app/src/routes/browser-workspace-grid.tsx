/** @jsxImportSource react */
import { useRef, useState, type CSSProperties, type ReactNode } from "react";

export function BrowserWorkspaceGrid({
  count,
  focused,
  children,
}: {
  count: number;
  focused: boolean;
  children: ReactNode;
}) {
  const [split, setSplit] = useState(50);
  const container = useRef<HTMLDivElement>(null);
  const clamp = (value: number) => Math.min(75, Math.max(25, value));
  const divided = !focused && count > 1;
  return (
    <div ref={container} className="relative flex min-h-0 flex-1">
      <div
        style={{ "--browser-columns": `${split}fr ${100 - split}fr` } as CSSProperties}
        className={`grid min-h-0 min-w-0 flex-1 gap-3 overflow-auto ${divided ? "min-[761px]:grid-cols-(--browser-columns)" : "grid-cols-1"} ${divided && count > 2 ? "min-[761px]:grid-rows-2" : "min-[761px]:grid-rows-1"}`}
      >
        {children}
      </div>
      {divided ? (
        <div
          role="separator"
          aria-label="Resize browser columns"
          aria-orientation="vertical"
          aria-valuenow={Math.round(split)}
          aria-valuemin={25}
          aria-valuemax={75}
          tabIndex={0}
          style={
            {
              "--browser-divider": `calc((100% - 0.75rem) * ${split / 100} + 0.375rem)`,
            } as CSSProperties
          }
          className="absolute inset-y-0 left-(--browser-divider) z-10 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center outline-none min-[761px]:flex before:h-10 before:w-1 before:rounded-full before:bg-border hover:before:bg-primary focus-visible:before:bg-primary"
          onDoubleClick={() => setSplit(50)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            setSplit((value) =>
              event.key === "Home"
                ? 25
                : event.key === "End"
                  ? 75
                  : clamp(value + (event.key === "ArrowRight" ? 5 : -5)),
            );
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId) || !container.current)
              return;
            const rect = container.current.getBoundingClientRect();
            setSplit(clamp(((event.clientX - rect.left) / rect.width) * 100));
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        />
      ) : null}
    </div>
  );
}
