import { createEffect, createSignal, createUniqueId, onCleanup } from "solid-js";
import { cn } from "../lib/cn";

export type SwipeEndpoint = "from" | "to";

type Point = { x: number; y: number };
type Bounds = { width: number; height: number };

export function SwipePathPreview(props: {
  from: Point;
  to: Point;
  bounds: Bounds;
  onPoint: (endpoint: SwipeEndpoint, point: Point) => void;
  /** A captured screen can show the gesture without becoming an editor. */
  interactive?: boolean;
  /** Remount-free playback trigger used by the recorded-screen preview. */
  previewToken?: number;
  previewDurationMs?: number;
}) {
  const [dragging, setDragging] = createSignal<SwipeEndpoint | null>(null);
  const [playbackProgress, setPlaybackProgress] = createSignal<number | undefined>();
  const gradientId = `swipe-fade-${createUniqueId()}`;
  let drag:
    | {
        pointerId: number;
        endpoint: SwipeEndpoint;
        captureTarget: HTMLElement;
      }
    | undefined;
  let overlay: HTMLDivElement | undefined;

  const hasPoint = (point: Point | undefined): point is Point =>
    Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
  const bounds = () =>
    props.bounds?.width > 0 && props.bounds.height > 0 ? props.bounds : { width: 1, height: 1 };
  const hasGeometry = () => hasPoint(props.from) && hasPoint(props.to);
  const percent = (point: Point | undefined) => {
    const viewport = bounds();
    const safePoint = hasPoint(point) ? point : { x: viewport.width / 2, y: viewport.height / 2 };
    return {
      x: Math.max(0, Math.min(100, (safePoint.x / viewport.width) * 100)),
      y: Math.max(0, Math.min(100, (safePoint.y / viewport.height) * 100)),
    };
  };
  const from = () => percent(props.from);
  const to = () => percent(props.to);
  const direction = () => {
    if (!hasGeometry()) return 0;
    const dx = props.to.x - props.from.x;
    const dy = props.to.y - props.from.y;
    return dx || dy ? (Math.atan2(dy, dx) * 180) / Math.PI : 0;
  };
  const playbackPosition = () => {
    const progress = playbackProgress() ?? 0;
    return {
      x: from().x + (to().x - from().x) * progress,
      y: from().y + (to().y - from().y) * progress,
    };
  };
  const playbackDuration = () => Math.max(180, Math.min(props.previewDurationMs ?? 300, 900));

  createEffect(() => {
    const token = props.previewToken;
    if (token === undefined) {
      setPlaybackProgress(undefined);
      return;
    }

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setPlaybackProgress(1);
      return;
    }

    const duration = playbackDuration();
    const startedAt = performance.now();
    let frame = 0;
    setPlaybackProgress(0);
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      setPlaybackProgress(progress);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  function pointAt(clientX: number, clientY: number): Point | undefined {
    const rect = overlay?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return undefined;
    return {
      x: Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * bounds().width),
      y: Math.round(Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) * bounds().height),
    };
  }

  function move(endpoint: SwipeEndpoint, clientX: number, clientY: number): void {
    const point = pointAt(clientX, clientY);
    if (point) props.onPoint(endpoint, point);
  }

  function closestEndpoint(point: Point): SwipeEndpoint {
    if (!hasGeometry()) return "from";
    const fromDistance = Math.hypot(point.x - props.from.x, point.y - props.from.y);
    const toDistance = Math.hypot(point.x - props.to.x, point.y - props.to.y);
    return fromDistance <= toDistance ? "from" : "to";
  }

  function startDrag(event: PointerEvent, endpoint?: SwipeEndpoint): void {
    if (props.interactive === false) return;
    if (!hasGeometry()) return;
    if (event.button !== 0) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const nextEndpoint = endpoint ?? closestEndpoint(point);
    drag = { pointerId: event.pointerId, endpoint: nextEndpoint, captureTarget: target };
    setDragging(nextEndpoint);
    target.setPointerCapture(event.pointerId);
    // Grabbing anywhere on the screen always catches the nearer endpoint.
    // Moving it immediately makes an imprecise initial press feel intentional.
    props.onPoint(nextEndpoint, point);
  }

  function continueDrag(event: PointerEvent): void {
    const active = drag;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    move(active.endpoint, event.clientX, event.clientY);
  }

  function finishDrag(event: PointerEvent): void {
    const active = drag;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    move(active.endpoint, event.clientX, event.clientY);
    drag = undefined;
    setDragging(null);
    if (active.captureTarget.hasPointerCapture(event.pointerId)) {
      active.captureTarget.releasePointerCapture(event.pointerId);
    }
  }

  function cancelDrag(event: PointerEvent): void {
    if (drag?.pointerId !== event.pointerId) return;
    drag = undefined;
    setDragging(null);
  }

  function endpointHandle(endpoint: SwipeEndpoint) {
    const position = () => (endpoint === "from" ? from() : to());
    const active = () => dragging() === endpoint;
    const isOrigin = endpoint === "from";
    return (
      <button
        type="button"
        class={cn(
          "pointer-events-auto absolute z-[2] grid size-6 touch-none cursor-grab -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full",
          "transition-transform duration-press ease-out hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/85",
          active() && "scale-110 cursor-grabbing",
        )}
        style={{ left: `${position().x}%`, top: `${position().y}%` }}
        aria-label={`Drag swipe ${isOrigin ? "start" : "end"}`}
        aria-hidden={props.interactive === false ? "true" : undefined}
        tabindex={props.interactive === false ? -1 : undefined}
        data-swipe-endpoint={endpoint}
        onPointerDown={(event) => {
          startDrag(event, endpoint);
        }}
      >
        <i
          class={cn(
            "pointer-events-none grid size-4 place-items-center rounded-full bg-[var(--text-interactive-base)] transition-shadow duration-press ease-out",
            isOrigin
              ? active()
                ? "shadow-[inset_0_1px_2px_rgb(0_0_0/38%),inset_0_-1px_0_rgb(255_255_255/18%),0_1px_4px_rgb(0_0_0/60%),0_0_0_3px_color-mix(in_srgb,var(--text-interactive-base)_45%,transparent)]"
                : "shadow-[inset_0_1px_2px_rgb(0_0_0/38%),inset_0_-1px_0_rgb(255_255_255/18%),0_1px_3px_rgb(0_0_0/55%),0_0_0_1px_rgb(0_0_0/22%)]"
              : active()
                ? "shadow-[0_1px_4px_rgb(0_0_0/60%),0_0_0_3px_color-mix(in_srgb,var(--text-interactive-base)_45%,transparent)]"
                : "shadow-[0_1px_3px_rgb(0_0_0/55%),0_0_0_1px_rgb(0_0_0/22%)]",
          )}
          aria-hidden="true"
        >
          {!isOrigin && (
            <svg
              class="pointer-events-none size-[9px] shrink-0"
              viewBox="0 0 12 12"
              style={{ transform: `rotate(${direction()}deg)` }}
              aria-hidden="true"
            >
              <path
                d="M2.4 2 L9.6 6 L2.4 10"
                fill="none"
                stroke="white"
                stroke-width="2.1"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          )}
        </i>
      </button>
    );
  }

  return (
    <div
      ref={(element) => {
        overlay = element;
      }}
      class={cn(
        "absolute inset-0 z-[5] touch-none overflow-hidden",
        props.interactive === false ? "pointer-events-none" : "cursor-grab",
        props.interactive !== false && dragging() && "cursor-grabbing",
      )}
      role={props.interactive === false ? "img" : "group"}
      aria-label={
        hasGeometry()
          ? `Swipe from ${props.from.x}, ${props.from.y} to ${props.to.x}, ${props.to.y}`
          : "Swipe gesture"
      }
      data-swipe-preview
      onPointerDown={(event) => startDrag(event)}
      onPointerMove={continueDrag}
      onPointerUp={finishDrag}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={cancelDrag}
    >
      <svg class="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={`${from().x}%`}
            y1={`${from().y}%`}
            x2={`${to().x}%`}
            y2={`${to().y}%`}
          >
            <stop offset="0%" stop-color="var(--text-interactive-base)" stop-opacity="0" />
            <stop offset="20%" stop-color="var(--text-interactive-base)" stop-opacity="0.9" />
            <stop offset="100%" stop-color="var(--text-interactive-base)" stop-opacity="0.9" />
          </linearGradient>
        </defs>
        <line
          x1={`${from().x}%`}
          y1={`${from().y}%`}
          x2={`${to().x}%`}
          y2={`${to().y}%`}
          stroke={`url(#${gradientId})`}
          stroke-width="2"
          stroke-linecap="round"
          stroke-dasharray="0.1 7"
          vector-effect="non-scaling-stroke"
          class="drop-shadow-[0_1px_2px_rgb(0_0_0/55%)] motion-safe:animate-[swipe-path-flow_3200ms_linear_infinite]"
        />
      </svg>
      {playbackProgress() !== undefined && (
        <i
          class="step-preview-swipe-marker pointer-events-none absolute z-[3] grid size-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white shadow-[0_2px_8px_rgb(0_0_0/52%)]"
          style={`left: ${playbackPosition().x}%; top: ${playbackPosition().y}%; --step-preview-duration: ${playbackDuration()}ms`}
          data-swipe-playback
          aria-hidden="true"
        >
          <i class="size-2 rounded-full bg-[var(--text-interactive-base)]" />
        </i>
      )}
      {endpointHandle("from")}
      {endpointHandle("to")}
    </div>
  );
}
