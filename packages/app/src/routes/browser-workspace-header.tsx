/** @jsxImportSource react */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@relay/ui-react/components/button";
import { browserDockSide, type DockSide } from "../data/browser-workspace-layout";

export type BrowserDockTarget = { targetId: string; side: DockSide; workspace?: boolean };
export type BrowserWorkspaceHeaderProps = {
  id: string;
  name: string;
  disabled: boolean;
  onDrop(target: BrowserDockTarget): void;
  onMove(direction: DockSide): void;
  onHover(target?: BrowserDockTarget): void;
  onDrag(active: boolean, cancelled?: boolean): void;
  leading: ReactNode;
  actions: ReactNode;
};
export function BrowserWorkspaceHeader({
  id,
  name,
  disabled,
  onDrop,
  onMove,
  onHover,
  onDrag,
  leading,
  actions,
}: BrowserWorkspaceHeaderProps) {
  const start = useRef<
    | {
        x: number;
        y: number;
        pointer: number;
        element: HTMLElement;
        tile: HTMLElement;
        dragged: boolean;
      }
    | undefined
  >(undefined);
  const [active, setActive] = useState(false);
  const handle = useRef<HTMLButtonElement>(null);
  function targetAt(x: number, y: number): BrowserDockTarget | undefined {
    const workspace = start.current?.tile.parentElement;
    if (workspace) {
      const rect = workspace.getBoundingClientRect();
      const xIn = x - rect.left,
        yIn = y - rect.top;
      if (
        rect.width &&
        rect.height &&
        xIn >= -20 &&
        yIn >= -20 &&
        xIn <= rect.width + 20 &&
        yIn <= rect.height + 20
      ) {
        const edges: [DockSide, number][] = [
          ["left", xIn],
          ["right", rect.width - xIn],
          ["top", yIn],
          ["bottom", rect.height - yIn],
        ];
        const edge = edges.sort((a, b) => a[1] - b[1])[0]!;
        if (edge[1] < 24) return { targetId: "", side: edge[0], workspace: true };
      }
    }
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
    if (previous) {
      previous.tile.style.transform = "";
      delete previous.tile.dataset.dragging;
    }
    if (previous?.element.hasPointerCapture(previous.pointer))
      previous.element.releasePointerCapture(previous.pointer);
    if (previous?.dragged && document.activeElement === handle.current) handle.current?.blur();
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
      <header
        className="relative grid min-h-11 shrink-0 cursor-grab touch-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @max-[280px]:grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 border-b border-border px-3 select-none active:cursor-grabbing"
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          const control = (event.target as HTMLElement).closest("button,a,input");
          if (control && control !== handle.current) return;
          event.preventDefault();
          handle.current?.focus({ preventScroll: true });
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
            start.current.tile.dataset.dragging = "true";
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
        {leading}
        <Button
          ref={handle}
          size="icon"
          variant="ghost"
          className="group h-11 w-16 @max-[360px]:w-12 @max-[280px]:w-8 shrink-0 touch-none cursor-grab active:cursor-grabbing"
          aria-label={`Move ${name}`}
          aria-pressed={active}
          title="Drag to an edge to split. Use arrow keys to move."
          disabled={disabled}
          onKeyDown={(event) => {
            const directions: Record<string, DockSide | undefined> = {
              ArrowLeft: "left",
              ArrowRight: "right",
              ArrowUp: "top",
              ArrowDown: "bottom",
            };
            const direction = directions[event.key];
            if (!direction) return;
            event.preventDefault();
            onMove(direction);
          }}
        >
          <span
            className="h-1.5 w-10 @max-[280px]:w-6 rounded-full bg-muted-foreground/50 transition-colors group-hover:bg-muted-foreground group-active:bg-foreground group-focus-visible:bg-foreground motion-reduce:transition-none"
            aria-hidden="true"
          />
        </Button>
        <div className="flex cursor-auto items-center justify-end gap-0.5">{actions}</div>
      </header>
    </>
  );
}
