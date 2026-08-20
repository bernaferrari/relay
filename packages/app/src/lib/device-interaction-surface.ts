import {
  companionDisplayedPointToLogical,
  companionLogicalPointToDisplayed,
  type CompanionFramePresentation,
} from "../components/app-map-device-companion-geometry";

/** Native dimensions of the pixels behind an interaction surface. */
export type DevicePreviewDimensions = { width: number; height: number };

/**
 * The presentation rotation is shared with the screenshot/AX overlay code.
 * It is intentionally not a CSS concern: every input is first mapped through
 * it before it reaches a device.
 */
export type DevicePreviewRotation = CompanionFramePresentation["rotation"];

export type DeviceInteractionViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** The fitted, visible part of an object-contain preview inside its host. */
export type DeviceInteractionContentBox = DeviceInteractionViewport & {
  /** Ratio of the source pixels after presentation rotation. */
  aspectRatio: number;
};

/**
 * One point in both coordinate systems. `logical` is always what a device
 * action receives; `displayed` is where the person saw the point.
 */
export type DeviceInteractionPoint = {
  logical: { x: number; y: number };
  displayed: { x: number; y: number };
};

export type DeviceInteractionCursorKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

const isFinitePositive = (value: number) => Number.isFinite(value) && value > 0;

function validViewport(value: DeviceInteractionViewport): boolean {
  return (
    Number.isFinite(value.left) &&
    Number.isFinite(value.top) &&
    isFinitePositive(value.width) &&
    isFinitePositive(value.height)
  );
}

export function hasDevicePreviewDimensions(
  value: DevicePreviewDimensions | null | undefined,
): value is DevicePreviewDimensions {
  return Boolean(value && isFinitePositive(value.width) && isFinitePositive(value.height));
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function displayedDimensions(
  source: DevicePreviewDimensions,
  rotation: DevicePreviewRotation,
): DevicePreviewDimensions {
  return rotation === "none" ? source : { width: source.height, height: source.width };
}

/**
 * Resolve the exact object-contain rectangle rather than treating transparent
 * letterboxing as tappable device pixels. This works for a canvas, image, or
 * any other preview which presents the same source pixels with object-contain.
 */
export function deviceInteractionContentBox(input: {
  viewport: DeviceInteractionViewport;
  source: DevicePreviewDimensions | null | undefined;
  rotation?: DevicePreviewRotation;
}): DeviceInteractionContentBox | undefined {
  const rotation = input.rotation ?? "none";
  if (!validViewport(input.viewport) || !hasDevicePreviewDimensions(input.source)) return undefined;
  const displayed = displayedDimensions(input.source, rotation);
  const scale = Math.min(
    input.viewport.width / displayed.width,
    input.viewport.height / displayed.height,
  );
  if (!isFinitePositive(scale)) return undefined;
  const width = displayed.width * scale;
  const height = displayed.height * scale;
  return {
    left: input.viewport.left + (input.viewport.width - width) / 2,
    top: input.viewport.top + (input.viewport.height - height) / 2,
    width,
    height,
    aspectRatio: displayed.width / displayed.height,
  };
}

/**
 * Map an input point in browser client pixels to the normalized logical device
 * plane. The default is deliberately strict: a click in a letterbox is not a
 * click on the device. Gesture endpoints may opt into clamping after a valid
 * drag has begun, so an edge swipe still reaches the edge.
 */
export function deviceInteractionPointAtClient(input: {
  viewport: DeviceInteractionViewport;
  source: DevicePreviewDimensions | null | undefined;
  rotation?: DevicePreviewRotation;
  clientX: number;
  clientY: number;
  clamp?: boolean;
}): DeviceInteractionPoint | undefined {
  const box = deviceInteractionContentBox(input);
  if (!box || !Number.isFinite(input.clientX) || !Number.isFinite(input.clientY)) return undefined;
  const rawX = (input.clientX - box.left) / box.width;
  const rawY = (input.clientY - box.top) / box.height;
  if (!input.clamp && (rawX < 0 || rawX > 1 || rawY < 0 || rawY > 1)) return undefined;
  const displayed = { x: clampUnit(rawX), y: clampUnit(rawY) };
  return {
    displayed,
    logical: companionDisplayedPointToLogical(displayed, input.rotation ?? "none"),
  };
}

/** Project a logical cursor into the visible presentation plane. */
export function deviceInteractionDisplayedPoint(
  logical: { x: number; y: number },
  rotation: DevicePreviewRotation = "none",
): DeviceInteractionPoint {
  const safeLogical = { x: clampUnit(logical.x), y: clampUnit(logical.y) };
  return {
    logical: safeLogical,
    displayed: companionLogicalPointToDisplayed(safeLogical, rotation),
  };
}

/**
 * Keyboard arrows follow the direction people see, including a rotated iPad
 * presentation. Converting visual movement back to logical coordinates keeps
 * keyboard and pointer actions exactly aligned.
 */
export function moveDeviceInteractionCursor(input: {
  point: { x: number; y: number };
  key: DeviceInteractionCursorKey;
  rotation?: DevicePreviewRotation;
  step?: number;
}): DeviceInteractionPoint {
  const rotation = input.rotation ?? "none";
  const displayed = companionLogicalPointToDisplayed(
    { x: clampUnit(input.point.x), y: clampUnit(input.point.y) },
    rotation,
  );
  const step = Number.isFinite(input.step) && (input.step ?? 0) > 0 ? input.step! : 0.02;
  const moved = {
    x: clampUnit(
      displayed.x + (input.key === "ArrowLeft" ? -step : input.key === "ArrowRight" ? step : 0),
    ),
    y: clampUnit(
      displayed.y + (input.key === "ArrowUp" ? -step : input.key === "ArrowDown" ? step : 0),
    ),
  };
  return {
    displayed: moved,
    logical: companionDisplayedPointToLogical(moved, rotation),
  };
}

/** CSS-safe percentage placement for an optional cursor/gesture decoration. */
export function deviceInteractionPointStyle(input: {
  point: DeviceInteractionPoint;
  viewport: DeviceInteractionViewport;
  source: DevicePreviewDimensions | null | undefined;
  rotation?: DevicePreviewRotation;
}): { left: string; top: string } | undefined {
  const box = deviceInteractionContentBox(input);
  if (!box) return undefined;
  const left =
    ((box.left - input.viewport.left + input.point.displayed.x * box.width) /
      input.viewport.width) *
    100;
  const top =
    ((box.top - input.viewport.top + input.point.displayed.y * box.height) /
      input.viewport.height) *
    100;
  return { left: `${Number(left.toFixed(6))}%`, top: `${Number(top.toFixed(6))}%` };
}
