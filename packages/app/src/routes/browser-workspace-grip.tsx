/** @jsxImportSource react */
import { useRef } from "react";
import { GripHorizontal } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";

export function BrowserWorkspaceGrip({
  name,
  disabled,
  onDrop,
  onMove,
  onHover,
}: {
  name: string;
  disabled: boolean;
  onDrop(targetId: string): void;
  onMove(offset: number): void;
  onHover(targetId?: string): void;
}) {
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  function targetAt(x: number, y: number) {
    return (
      document
        .elementFromPoint(x, y)
        ?.closest("[data-browser-tile]")
        ?.getAttribute("data-browser-tile") ?? undefined
    );
  }
  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-9 w-10 shrink-0 touch-none cursor-grab active:cursor-grabbing"
      aria-label={`Move ${name}`}
      title="Drag to reorder. Use arrow keys to move."
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
        start.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) >= 4)
          onHover(targetAt(event.clientX, event.clientY));
      }}
      onPointerUp={(event) => {
        if (!start.current) return;
        const moved =
          Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) >= 4;
        start.current = undefined;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        const target = targetAt(event.clientX, event.clientY);
        onHover();
        if (moved && target) onDrop(target);
      }}
      onPointerCancel={() => {
        start.current = undefined;
        onHover();
      }}
    >
      <GripHorizontal className="size-5 text-muted-foreground" aria-hidden="true" />
    </Button>
  );
}
