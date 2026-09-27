/** @jsxImportSource react */
import type {
  ComponentProps,
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
  WheelEventHandler,
} from "react";
import { MapCanvasWorld } from "./infinite-map-canvas-world";

type WorldProps = ComponentProps<typeof MapCanvasWorld>;

export function MapCanvasViewport({
  viewportRef,
  panningTool,
  marquee,
  selectedIds,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onWheel,
  onKeyDown,
  worldProps,
}: {
  viewportRef: { current: HTMLElement | null };
  panningTool: boolean;
  marquee: { x: number; y: number; width: number; height: number } | undefined;
  selectedIds: Set<string>;
  onPointerDown: PointerEventHandler<HTMLElement>;
  onPointerMove: PointerEventHandler<HTMLElement>;
  onPointerUp: PointerEventHandler<HTMLElement>;
  onPointerCancel: PointerEventHandler<HTMLElement>;
  onWheel: WheelEventHandler<HTMLElement>;
  onKeyDown: KeyboardEventHandler<HTMLElement>;
  worldProps: WorldProps;
}) {
  return (
    <section
      data-tool={panningTool ? "hand" : "select"}
      data-slot="map-canvas"
      className="data-[tool=hand]:cursor-grab relative h-full min-h-0 w-full flex-1 overflow-hidden bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:20px_20px]"
      aria-label="Screens and verified paths"
      aria-describedby="map-keyboard-help"
      tabIndex={0}
      ref={viewportRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    >
      {marquee ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-(--box-left) top-(--box-top) z-30 h-(--box-height) w-(--box-width) border border-info bg-info/10"
          style={
            {
              "--box-left": `${marquee.x}px`,
              "--box-top": `${marquee.y}px`,
              "--box-width": `${marquee.width}px`,
              "--box-height": `${marquee.height}px`,
            } as CSSProperties
          }
        />
      ) : null}
      {selectedIds.size > 1 ? (
        <span
          role="status"
          className="pointer-events-none absolute right-4 top-4 z-20 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground"
        >
          {selectedIds.size} screens selected
        </span>
      ) : null}
      <span className="sr-only" id="map-keyboard-help">
        Use arrow keys to move, plus and minus to zoom, F to fit the map, Shift F to focus a
        selected screen, Space to pan, or 0 to reset the view. Tab to visit each screen.
      </span>
      <MapCanvasWorld {...worldProps} />
    </section>
  );
}
