import { createSignal } from "solid-js";
import type { ConnectionPresentation } from "@relay/protocol";
import type { CanvasEdgeGeometry, CanvasPoint } from "../lib/app-map-canvas-layout";
import type { CanvasConnection } from "../lib/app-map-connection-draft";

type AppMapCurveControlProps = {
  connection: CanvasConnection;
  geometry: CanvasEdgeGeometry;
  viewportScale: number;
  width: number;
  height: number;
  onPreviewPresentation: (presentation: ConnectionPresentation) => void;
  onChangePresentation: (presentation: ConnectionPresentation) => void;
  onCancelPreview: () => void;
};

type ConnectionControlDrag = {
  presentation: ConnectionPresentation;
  originPointer: CanvasPoint;
  originOffset: CanvasPoint;
};

const CURVE_KEYBOARD_NUDGE = 20;

function pointerInCanvas(event: PointerEvent, element: SVGGraphicsElement): CanvasPoint {
  const svg = element.ownerSVGElement;
  const matrix = svg?.getScreenCTM()?.inverse();
  if (!svg || !matrix) return { x: event.clientX, y: event.clientY };
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const transformed = point.matrixTransform(matrix);
  return { x: transformed.x, y: transformed.y };
}

export function AppMapCurveControl(props: AppMapCurveControlProps) {
  const [drag, setDrag] = createSignal<ConnectionControlDrag | null>(null);
  const hitRadius = () => 22 / Math.max(props.viewportScale, 0.01);
  const visibleRadius = () => 5.5 / Math.max(props.viewportScale, 0.01);

  const beginDrag = (event: PointerEvent) => {
    event.stopPropagation();
    const element = event.currentTarget as SVGCircleElement;
    element.setPointerCapture(event.pointerId);
    const initial: ConnectionControlDrag = {
      presentation: { ...props.connection.presentation, route: "curve" },
      originPointer: pointerInCanvas(event, element),
      originOffset: props.connection.presentation?.controlOffset ?? { x: 0, y: 0 },
    };
    setDrag(initial);
    props.onPreviewPresentation(initial.presentation);
  };

  const moveDrag = (event: PointerEvent) => {
    const current = drag();
    if (!current) return;
    const pointer = pointerInCanvas(event, event.currentTarget as SVGGraphicsElement);
    const next: ConnectionControlDrag = {
      ...current,
      presentation: {
        ...current.presentation,
        route: "curve",
        controlOffset: {
          x: current.originOffset.x + pointer.x - current.originPointer.x,
          y: current.originOffset.y + pointer.y - current.originPointer.y,
        },
      },
    };
    setDrag(next);
    props.onPreviewPresentation(next.presentation);
  };

  const finishDrag = (event: PointerEvent) => {
    const current = drag();
    if (!current) return;
    event.stopPropagation();
    setDrag(null);
    props.onChangePresentation(current.presentation);
  };

  const nudge = (event: KeyboardEvent) => {
    const multiplier = event.shiftKey ? 4 : 1;
    const delta =
      event.key === "ArrowLeft"
        ? { x: -CURVE_KEYBOARD_NUDGE * multiplier, y: 0 }
        : event.key === "ArrowRight"
          ? { x: CURVE_KEYBOARD_NUDGE * multiplier, y: 0 }
          : event.key === "ArrowUp"
            ? { x: 0, y: -CURVE_KEYBOARD_NUDGE * multiplier }
            : event.key === "ArrowDown"
              ? { x: 0, y: CURVE_KEYBOARD_NUDGE * multiplier }
              : undefined;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const offset = props.connection.presentation?.controlOffset ?? { x: 0, y: 0 };
    props.onChangePresentation({
      ...props.connection.presentation,
      route: "curve",
      controlOffset: { x: offset.x + delta.x, y: offset.y + delta.y },
    });
  };

  return (
    <svg
      class="pointer-events-none absolute inset-0 z-[21] overflow-visible"
      width={props.width}
      height={props.height}
      role="group"
      aria-label="Curve anchor controls"
    >
      <circle
        cx={props.geometry.labelPoint.x}
        cy={props.geometry.labelPoint.y}
        r={hitRadius()}
        class="cursor-grab touch-none fill-transparent stroke-transparent focus-visible:stroke-[var(--border-focus)] active:cursor-grabbing"
        pointer-events="all"
        role="button"
        tabindex="0"
        ref={(element) => element.setAttribute("focusable", "true")}
        aria-label="Adjust curve"
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
        data-tip="Drag to reshape curve · Arrow keys nudge"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={() => {
          setDrag(null);
          props.onCancelPreview();
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={nudge}
      />
      <circle
        cx={props.geometry.labelPoint.x}
        cy={props.geometry.labelPoint.y}
        r={visibleRadius()}
        class="pointer-events-none fill-[var(--background-base)] stroke-[var(--text-interactive-base)]"
        stroke-width={2 / Math.max(props.viewportScale, 0.01)}
        aria-hidden="true"
      />
    </svg>
  );
}
