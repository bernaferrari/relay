import { createMemo, createSignal, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { cn } from "../lib/cn";
import {
  deviceInteractionContentBox,
  deviceInteractionDisplayedPoint,
  deviceInteractionPointAtClient,
  deviceInteractionPointStyle,
  hasDevicePreviewDimensions,
  moveDeviceInteractionCursor,
  type DeviceInteractionCursorKey,
  type DeviceInteractionPoint,
  type DeviceInteractionViewport,
  type DevicePreviewDimensions,
  type DevicePreviewRotation,
} from "../lib/device-interaction-surface";

export type DeviceInteractionTap = {
  point: DeviceInteractionPoint;
  source: "pointer" | "keyboard" | "activation";
};

export type DeviceInteractionSwipe = {
  start: DeviceInteractionPoint;
  end: DeviceInteractionPoint;
  durationMs: number;
};

/**
 * Optional source-specific transport hook. The final tap/swipe callbacks still
 * provide the canonical, transport-independent device action.
 */
export type DeviceInteractionGesture = {
  phase: "down" | "move" | "up" | "cancel";
  point: DeviceInteractionPoint;
  start: DeviceInteractionPoint;
  pointerId: number;
};

export type DeviceInteractionCursorEvent = {
  key: DeviceInteractionCursorKey;
  point: DeviceInteractionPoint;
  step: number;
};

export type DeviceInteractionWheel = {
  point: DeviceInteractionPoint;
  deltaX: number;
  deltaY: number;
};

export type DeviceInteractionInspect = {
  point: DeviceInteractionPoint;
  event: MouseEvent;
};

/** A non-mutating semantic hover. Keeping it separate from gestures lets a
 * preview surface expose reviewed AX hints without turning movement into
 * input. */
export type DeviceInteractionHover = {
  point: DeviceInteractionPoint;
  event: PointerEvent;
};

type ActivePointer = {
  id: number;
  start: DeviceInteractionPoint;
  startedAt: number;
  contentWidth: number;
  contentHeight: number;
};

const TAP_DISTANCE_PX = 8;
const CLICK_DEDUPLICATION_MS = 350;

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function isCursorKey(value: string): value is DeviceInteractionCursorKey {
  return (
    value === "ArrowLeft" || value === "ArrowRight" || value === "ArrowUp" || value === "ArrowDown"
  );
}

function viewportFor(element: HTMLElement): DeviceInteractionViewport | undefined {
  const rect = element.getBoundingClientRect();
  if (
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return undefined;
  }
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * A single transparent input plane for any device pixels. It intentionally
 * knows nothing about a device backend, XCTest, or an image/canvas transport:
 * it only turns user input into safe normalized logical coordinates.
 *
 * Keep the media below this component `pointer-events-none`; otherwise image
 * and video previews can accidentally create two competing input paths.
 */
export function DeviceInteractionSurface(props: {
  /** Native source-pixel dimensions. Required before the surface can aim safely. */
  sourceDimensions: Accessor<DevicePreviewDimensions | undefined>;
  /** Rotation applied when presenting source pixels (not a device action rotation). */
  rotation?: Accessor<DevicePreviewRotation>;
  disabled?: Accessor<boolean>;
  /** Pixels remain visible but this viewer has no device-control lease. */
  viewOnly?: Accessor<boolean>;
  onTap: (event: DeviceInteractionTap) => void;
  onSwipe?: (event: DeviceInteractionSwipe) => void;
  onCursorKey?: (event: DeviceInteractionCursorEvent) => void;
  onGesture?: (event: DeviceInteractionGesture) => void;
  onWheel?: (event: DeviceInteractionWheel) => void;
  onInspect?: (event: DeviceInteractionInspect) => void;
  onHover?: (event: DeviceInteractionHover) => void;
  onLeave?: () => void;
  ariaLabel?: string;
  class?: string;
  elementRef?: (element: HTMLDivElement) => void;
}) {
  let surface: HTMLDivElement | undefined;
  let activePointer: ActivePointer | undefined;
  let lastPointerActionAt = -Infinity;
  let observer: ResizeObserver | undefined;
  const [viewport, setViewport] = createSignal<DeviceInteractionViewport>();
  const [cursor, setCursor] = createSignal({ x: 0.5, y: 0.5 });
  const [cursorActive, setCursorActive] = createSignal(false);

  const rotation = () => props.rotation?.() ?? "none";
  const declaredDisabled = () => props.disabled?.() ?? false;
  const viewOnly = () => props.viewOnly?.() ?? false;
  const canAim = () => hasDevicePreviewDimensions(props.sourceDimensions());
  const interactive = () => !declaredDisabled() && !viewOnly() && canAim();
  const accessibleLabel = () => {
    if (viewOnly()) return "Device preview. View only.";
    if (declaredDisabled()) return "Device preview unavailable.";
    if (!canAim()) return "Device preview is preparing its dimensions.";
    return (
      props.ariaLabel ??
      "Interactive device preview. Tap or drag the screen. Use arrow keys to move the cursor, then Enter to tap."
    );
  };
  const cursorPoint = createMemo(() => deviceInteractionDisplayedPoint(cursor(), rotation()));
  const cursorStyle = createMemo(() => {
    const currentViewport = viewport();
    if (!currentViewport) return undefined;
    return deviceInteractionPointStyle({
      point: cursorPoint(),
      viewport: currentViewport,
      source: props.sourceDimensions(),
      rotation: rotation(),
    });
  });

  const syncViewport = (element: HTMLElement): DeviceInteractionViewport | undefined => {
    const next = viewportFor(element);
    setViewport(next);
    return next;
  };

  const pointFromClient = (
    element: HTMLElement,
    clientX: number,
    clientY: number,
    clamp = false,
  ): DeviceInteractionPoint | undefined => {
    const currentViewport = syncViewport(element);
    if (!currentViewport) return undefined;
    return deviceInteractionPointAtClient({
      viewport: currentViewport,
      source: props.sourceDimensions(),
      rotation: rotation(),
      clientX,
      clientY,
      clamp,
    });
  };

  const clearPointer = (pointerId: number, phase: "cancel" | "up" = "cancel") => {
    const active = activePointer;
    if (!active || active.id !== pointerId) return undefined;
    activePointer = undefined;
    if (phase === "cancel") {
      props.onGesture?.({
        phase,
        point: active.start,
        start: active.start,
        pointerId,
      });
    }
    return active;
  };

  onMount(() => {
    if (!surface) return;
    syncViewport(surface);
    if (typeof ResizeObserver === "undefined") return;
    observer = new ResizeObserver(() => {
      if (surface) syncViewport(surface);
    });
    observer.observe(surface);
  });

  onCleanup(() => observer?.disconnect());

  return (
    <div
      ref={(element) => {
        surface = element;
        props.elementRef?.(element);
      }}
      role="group"
      aria-roledescription="interactive device preview"
      tabindex={interactive() ? 0 : -1}
      aria-label={accessibleLabel()}
      aria-disabled={!interactive()}
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space"
      title={
        interactive() ? "Tap, drag, or use the keyboard to interact with the device" : undefined
      }
      data-device-interaction-surface
      data-device-interaction-state={
        viewOnly()
          ? "view-only"
          : declaredDisabled()
            ? "disabled"
            : interactive()
              ? "ready"
              : "preparing"
      }
      class={cn(
        "absolute inset-0 z-[4] block select-none touch-none overscroll-contain outline-none",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-strong-focus",
        interactive() ? "cursor-pointer" : "cursor-default",
        props.class,
      )}
      onFocus={(event) => {
        if (!interactive()) return;
        syncViewport(event.currentTarget);
        setCursorActive(true);
      }}
      onBlur={() => setCursorActive(false)}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!interactive() || event.button !== 0) return;
        const point = pointFromClient(event.currentTarget, event.clientX, event.clientY);
        if (!point) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        const currentViewport = viewport();
        if (!currentViewport) return;
        const content = deviceInteractionContentBox({
          viewport: currentViewport,
          source: props.sourceDimensions(),
          rotation: rotation(),
        });
        if (!content) return;
        activePointer = {
          id: event.pointerId,
          start: point,
          startedAt: now(),
          contentWidth: content.width,
          contentHeight: content.height,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        props.onGesture?.({ phase: "down", point, start: point, pointerId: event.pointerId });
      }}
      onPointerMove={(event) => {
        const active = activePointer;
        if (!active || active.id !== event.pointerId) {
          if (!interactive() || !props.onHover) return;
          const point = pointFromClient(event.currentTarget, event.clientX, event.clientY);
          if (point) props.onHover({ point, event });
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        const point = pointFromClient(event.currentTarget, event.clientX, event.clientY, true);
        if (!point) return;
        props.onGesture?.({
          phase: "move",
          point,
          start: active.start,
          pointerId: event.pointerId,
        });
      }}
      onPointerUp={(event) => {
        const active = clearPointer(event.pointerId, "up");
        if (!active) return;
        event.stopPropagation();
        event.preventDefault();
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (!interactive()) {
          props.onGesture?.({
            phase: "cancel",
            point: active.start,
            start: active.start,
            pointerId: event.pointerId,
          });
          return;
        }
        const end = pointFromClient(event.currentTarget, event.clientX, event.clientY, true);
        if (!end) return;
        lastPointerActionAt = now();
        props.onGesture?.({
          phase: "up",
          point: end,
          start: active.start,
          pointerId: event.pointerId,
        });
        const distance = Math.hypot(
          (end.displayed.x - active.start.displayed.x) * active.contentWidth,
          (end.displayed.y - active.start.displayed.y) * active.contentHeight,
        );
        if (distance < TAP_DISTANCE_PX) {
          props.onTap({ point: active.start, source: "pointer" });
          return;
        }
        props.onSwipe?.({
          start: active.start,
          end,
          durationMs: Math.max(0, Math.round(now() - active.startedAt)),
        });
      }}
      onPointerCancel={(event) => {
        const active = clearPointer(event.pointerId);
        if (!active) return;
        event.stopPropagation();
        event.preventDefault();
      }}
      onPointerLeave={() => props.onLeave?.()}
      onLostPointerCapture={(event) => {
        const active = clearPointer(event.pointerId);
        if (!active) return;
        event.stopPropagation();
      }}
      onWheel={(event) => {
        event.stopPropagation();
        if (!interactive() || !props.onWheel || activePointer) return;
        const point = pointFromClient(event.currentTarget, event.clientX, event.clientY);
        if (!point) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        const currentViewport = viewport();
        const scale =
          event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (currentViewport?.height ?? 1) : 1;
        props.onWheel({ point, deltaX: event.deltaX * scale, deltaY: event.deltaY * scale });
      }}
      onContextMenu={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if (!interactive()) return;
        if (!props.onInspect) return;
        const point = pointFromClient(event.currentTarget, event.clientX, event.clientY);
        if (!point) return;
        props.onInspect({ point, event });
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (!interactive() || now() - lastPointerActionAt < CLICK_DEDUPLICATION_MS) return;
        const point =
          event.detail === 0
            ? deviceInteractionDisplayedPoint(cursor(), rotation())
            : pointFromClient(event.currentTarget, event.clientX, event.clientY);
        if (!point) return;
        event.preventDefault();
        props.onTap({ point, source: "activation" });
      }}
      onKeyDown={(event) => {
        if (!interactive() || event.metaKey || event.ctrlKey || event.altKey) return;
        if (isCursorKey(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const step = event.shiftKey ? 0.1 : 0.02;
          const point = moveDeviceInteractionCursor({
            point: cursor(),
            key: event.key,
            rotation: rotation(),
            step,
          });
          setCursor(point.logical);
          props.onCursorKey?.({ key: event.key, point, step });
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          props.onTap({
            point: deviceInteractionDisplayedPoint(cursor(), rotation()),
            source: "keyboard",
          });
        }
      }}
    >
      <Show when={cursorActive() && interactive() && cursorStyle()}>
        {(style) => (
          <span
            class="pointer-events-none absolute z-[1] size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--text-interactive-base)] shadow-sm"
            style={style()}
            aria-hidden="true"
          />
        )}
      </Show>
    </div>
  );
}
