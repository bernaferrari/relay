import { For, Show, type JSX } from "solid-js";
import { cn } from "../lib/cn";
import type { CanvasPoint, CanvasViewport } from "../lib/app-map-canvas-layout";
import type { CanvasSnapGuide } from "../lib/app-map-snapping";
import type { AppMapWorkspaceView } from "./app-map-toolbar";
import { canvasOwnsWheel, canvasWheelAction } from "./app-map-events";

export function AppMapCanvasViewport(props: {
  children: JSX.Element;
  observe: (element: HTMLElement) => void;
  workspaceView: AppMapWorkspaceView;
  tool: "select" | "hand";
  hasContent: boolean;
  gridVisual: { screenSpacing: number; offset: CanvasPoint };
  onZoom: (delta: number, clientPoint: CanvasPoint) => void;
  onPan: (delta: CanvasPoint) => void;
  onBeginPan: (event: PointerEvent) => void;
  onBeginMarquee: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
}) {
  return (
    <section
      ref={props.observe}
      class={cn(
        "relative isolate flex min-h-0 min-w-0 select-none overflow-hidden",
        props.workspaceView === "map" && "touch-none",
        props.tool === "hand" ? "cursor-grab active:cursor-grabbing" : "cursor-default",
      )}
      aria-label="Canvas"
      onWheel={(event) => {
        const target = event.target as HTMLElement;
        if (
          !canvasOwnsWheel({
            workspaceView: props.workspaceView,
            hasCanvasContent: props.hasContent,
            insideOverlay: Boolean(
              target.closest("aside, [role='dialog'], [data-app-map-native-scroll]"),
            ),
          })
        )
          return;
        const action = canvasWheelAction({
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          viewportHeight: event.currentTarget.clientHeight,
        });
        if (!action) return;
        event.preventDefault();
        if (action.kind === "zoom") {
          props.onZoom(action.delta, { x: event.clientX, y: event.clientY });
          return;
        }
        props.onPan({ x: action.x, y: action.y });
      }}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        const isCanvasBackground = !target.closest(
          "[data-app-map-screen-id], aside, button, input, textarea",
        );
        const wantsPan = props.tool === "hand" || event.button === 1;
        if (props.hasContent && wantsPan && !target.closest("button")) {
          props.onBeginPan(event);
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }
        if (!props.hasContent || !isCanvasBackground || event.button !== 0) return;
        props.onBeginMarquee(event);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
    >
      <div
        class="app-map-grid pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          "--app-map-grid-size": `${props.gridVisual.screenSpacing}px`,
          "--app-map-grid-offset-x": `${props.gridVisual.offset.x}px`,
          "--app-map-grid-offset-y": `${props.gridVisual.offset.y}px`,
        }}
      />
      {props.children}
    </section>
  );
}

export function AppMapCanvasWorld(props: {
  children: JSX.Element;
  view: CanvasViewport;
  bounds: { width: number; height: number };
  marquee: { left: number; top: number; width: number; height: number } | null;
  snapGuides: readonly CanvasSnapGuide[];
}) {
  return (
    <div
      class="absolute top-0 left-0 origin-top-left will-change-transform"
      style={{
        width: `${props.bounds.width}px`,
        height: `${props.bounds.height}px`,
        transform: `translate3d(${props.view.x}px, ${props.view.y}px, 0) scale(${props.view.scale})`,
      }}
    >
      <Show when={props.marquee}>
        {(selection) => (
          <div
            class="pointer-events-none absolute z-50 rounded border border-[var(--text-interactive-base)] bg-[color-mix(in_srgb,var(--product-accent-soft)_48%,transparent)]"
            data-app-map-marquee
            aria-hidden="true"
            style={{
              transform: `translate3d(${selection().left}px, ${selection().top}px, 0)`,
              width: `${selection().width}px`,
              height: `${selection().height}px`,
              "border-width": `${1 / props.view.scale}px`,
            }}
          />
        )}
      </Show>
      <CanvasSnapGuides guides={props.snapGuides} scale={props.view.scale} />
      {props.children}
    </div>
  );
}

function CanvasSnapGuides(props: { guides: readonly CanvasSnapGuide[]; scale: number }) {
  return (
    <For each={props.guides}>
      {(guide) => {
        const vertical = guide.kind === "alignment" ? guide.axis === "x" : guide.axis === "y";
        const segments = guide.segments ?? [guide];
        const positions = guide.parallelPositions ?? [guide.position];
        const lines = positions.flatMap((position) =>
          segments.map((segment) => ({ position, segment })),
        );
        const hairline = 1 / props.scale;
        const capLength = 5 / props.scale;
        return (
          <For each={lines}>
            {({ position, segment }) => {
              const length = Math.max(hairline, segment.end - segment.start);
              const spacing = guide.kind === "spacing";
              return (
                <div class="contents" aria-hidden="true">
                  <div
                    class="pointer-events-none absolute z-[49] bg-[var(--text-interactive-base)]"
                    data-app-map-snap-guide={guide.kind}
                    style={
                      vertical
                        ? {
                            left: `${position}px`,
                            top: `${segment.start}px`,
                            width: `${hairline}px`,
                            height: `${length}px`,
                          }
                        : {
                            left: `${segment.start}px`,
                            top: `${position}px`,
                            width: `${length}px`,
                            height: `${hairline}px`,
                          }
                    }
                  />
                  <Show when={spacing}>
                    <For each={[segment.start, segment.end]}>
                      {(endpoint) => (
                        <div
                          class="pointer-events-none absolute z-[49] bg-[var(--text-interactive-base)]"
                          data-app-map-snap-cap
                          style={
                            vertical
                              ? {
                                  left: `${position - capLength / 2}px`,
                                  top: `${endpoint}px`,
                                  width: `${capLength}px`,
                                  height: `${hairline}px`,
                                }
                              : {
                                  left: `${endpoint}px`,
                                  top: `${position - capLength / 2}px`,
                                  width: `${hairline}px`,
                                  height: `${capLength}px`,
                                }
                          }
                        />
                      )}
                    </For>
                  </Show>
                </div>
              );
            }}
          </For>
        );
      }}
    </For>
  );
}
