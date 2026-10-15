/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { Button } from "@relay/ui-react/components/button";
import { browserDockSide, type DockSide } from "../data/browser-workspace-layout";

export type BrowserDockTarget = { targetId: string; side: DockSide };
export function BrowserWorkspaceGrip({
  id,
  name,
  disabled,
  onDrop,
  onMove,
  onHover,
  onDrag,
}: {
  id: string;
  name: string;
  disabled: boolean;
  onDrop(target: BrowserDockTarget): void;
  onMove(offset: number): void;
  onHover(target?: BrowserDockTarget): void;
  onDrag(active: boolean, cancelled?: boolean): void;
}) {
  const start = useRef<
    | {
        x: number;
        y: number;
        pointer: number;
        element: HTMLButtonElement;
        tile: HTMLElement;
        dragged: boolean;
      }
    | undefined
  >(undefined);
  const [active, setActive] = useState(false);
  function targetAt(x: number, y: number): BrowserDockTarget | undefined {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-browser-tile]");
    const targetId = element?.dataset.browserTile;
    if (!element || !targetId || targetId === id) return undefined;
    const rect = element.getBoundingClientRect();
    return {
      targetId,
      side: browserDockSide(x - rect.left, y - rect.top, rect.width, rect.height),
    };
  }
  function finish(cancelled = true) {
    const previous = start.current;
    start.current = undefined;
    if (previous?.dragged) onDrag(false, cancelled);
    if (previous) previous.tile.style.transform = "";
    if (previous?.element.hasPointerCapture(previous.pointer))
      previous.element.releasePointerCapture(previous.pointer);
    setActive(false);
    onHover();
  }
  useEffect(() => {
    if (!active) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish();
      }
    };
    document.addEventListener("keydown", cancel);
    return () => document.removeEventListener("keydown", cancel);
  }, [active]);
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="group h-11 w-16 shrink-0 touch-none cursor-grab active:cursor-grabbing"
        aria-label={`Move ${name}`}
        aria-pressed={active}
        title="Drag to an edge to split. Use arrow keys to move."
        disabled={disabled}
        onKeyDown={(event) => {
          const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 }[event.key];
          if (offset === undefined) return;
          event.preventDefault();
          onMove(offset);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          const tile = event.currentTarget.closest<HTMLElement>("[data-browser-tile]");
          if (!tile) return;
          start.current = {
            x: event.clientX,
            y: event.clientY,
            pointer: event.pointerId,
            element: event.currentTarget,
            tile,
            dragged: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (
            !start.current ||
            Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) < 5
          )
            return;
          if (!start.current.dragged) {
            start.current.dragged = true;
            setActive(true);
            onDrag(true);
          }
          start.current.tile.style.transform = `translate(${event.clientX - start.current.x}px, ${event.clientY - start.current.y}px) scale(0.96)`;
          onHover(targetAt(event.clientX, event.clientY));
        }}
        onPointerUp={(event) => {
          if (!start.current) return;
          const moved =
            Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) >= 5;
          const target = targetAt(event.clientX, event.clientY);
          if (moved && target) {
            onDrop(target);
            finish(false);
          } else finish();
        }}
        onPointerCancel={() => finish()}
        onLostPointerCapture={() => {
          if (start.current) finish();
        }}
      >
        <span
          className="h-1.5 w-10 rounded-full bg-muted-foreground/50 transition-colors group-hover:bg-muted-foreground group-active:bg-foreground group-focus-visible:bg-foreground motion-reduce:transition-none"
          aria-hidden="true"
        />
      </Button>
    </>
  );
}
