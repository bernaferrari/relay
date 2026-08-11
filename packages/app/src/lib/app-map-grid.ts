import type { CanvasPoint, CanvasViewport } from "./app-map-canvas-layout";

/**
 * A grid is deliberately just serializable geometry. Keeping it free of DOM
 * state makes the same placement rule safe to run locally today and inside a
 * future CRDT transaction or remote peer tomorrow.
 */
export type CanvasGrid = Readonly<{
  /** World-space distance between legal placement lanes. */
  spacing: number;
  /** Optional world-space grid origin. Defaults to the document origin. */
  origin?: CanvasPoint;
}>;

export type CanvasGridPresentation = Readonly<{
  grid: CanvasGrid;
  /** World-space separation between the visible major-grid dots. */
  visualSpacing: number;
  /** Dot separation in CSS pixels at the current viewport scale. */
  screenSpacing: number;
  /** Repeating-background phase in CSS pixels. */
  offset: CanvasPoint;
}>;

export const DEFAULT_CANVAS_GRID_SPACING = 20;
// Dense enough to make the constrained lattice legible at the default view,
// without turning far-away maps into a field of visual noise.
export const MIN_CANVAS_GRID_SCREEN_SPACING = 14;

const DEFAULT_GRID_ORIGIN: CanvasPoint = { x: 0, y: 0 };

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function gridOrigin(grid: CanvasGrid): CanvasPoint {
  return {
    x: finite(grid.origin?.x ?? DEFAULT_GRID_ORIGIN.x),
    y: finite(grid.origin?.y ?? DEFAULT_GRID_ORIGIN.y),
  };
}

function gridSpacing(grid: CanvasGrid): number {
  return positiveFinite(grid.spacing, DEFAULT_CANVAS_GRID_SPACING);
}

function repeatOffset(value: number, period: number): number {
  const remainder = value % period;
  return remainder < 0 ? remainder + period : remainder;
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/**
 * The snap lattice never changes with zoom. Figma-style grids may hide minor
 * divisions while zoomed out, but changing the actual lattice would make an
 * object jump to a different legal position just because the user zoomed.
 *
 * Keep the scale parameter so callers have one stable factory API; it is
 * intentionally not part of the persisted placement rule.
 */
export function canvasGridForScale(_scale: number): CanvasGrid {
  return { spacing: DEFAULT_CANVAS_GRID_SPACING };
}

/**
 * Choose which multiple of the fixed minor lattice to show as dots. This is a
 * presentation-only major grid: all intermediate legal snap lanes remain
 * available while their dots are hidden at lower zoom levels.
 */
function visibleGridSpacing(grid: CanvasGrid, scale: number): number {
  const spacing = gridSpacing(grid);
  const ratio = MIN_CANVAS_GRID_SCREEN_SPACING / (spacing * scale);
  const detailLevel = Math.max(0, Math.ceil(Math.log2(ratio)));
  return spacing * 2 ** detailLevel;
}

/** Quantize an absolute world-space point to the nearest legal grid lane. */
export function snapCanvasPointToGrid(point: CanvasPoint, grid: CanvasGrid): CanvasPoint {
  const spacing = gridSpacing(grid);
  const origin = gridOrigin(grid);
  return {
    x: canonicalNumber(origin.x + Math.round((finite(point.x) - origin.x) / spacing) * spacing),
    y: canonicalNumber(origin.y + Math.round((finite(point.y) - origin.y) / spacing) * spacing),
  };
}

/**
 * Quantize a drag delta by snapping its resulting absolute point. Quantizing
 * the delta itself would move identical objects onto different lattices when
 * they began at different origins.
 */
export function snapCanvasDeltaToGrid(
  origin: CanvasPoint,
  candidateDelta: CanvasPoint,
  grid: CanvasGrid,
): CanvasPoint {
  const snapped = snapCanvasPointToGrid(
    {
      x: finite(origin.x) + finite(candidateDelta.x),
      y: finite(origin.y) + finite(candidateDelta.y),
    },
    grid,
  );
  return {
    x: snapped.x - finite(origin.x),
    y: snapped.y - finite(origin.y),
  };
}

/**
 * Convert world grid geometry into the CSS repeating-background values used by
 * the canvas. Phase derives from the exact viewport transform, so panning and
 * dragging share a single coordinate system.
 */
export function canvasGridPresentation(
  viewport: CanvasViewport,
  grid = canvasGridForScale(viewport.scale),
): CanvasGridPresentation {
  const scale = positiveFinite(viewport.scale, 1);
  const spacing = gridSpacing(grid);
  const visualSpacing = visibleGridSpacing(grid, scale);
  const origin = gridOrigin(grid);
  const screenSpacing = visualSpacing * scale;
  return {
    grid: { spacing, ...(grid.origin ? { origin } : {}) },
    visualSpacing,
    screenSpacing,
    offset: {
      x: repeatOffset(finite(viewport.x) + origin.x * scale, screenSpacing),
      y: repeatOffset(finite(viewport.y) + origin.y * scale, screenSpacing),
    },
  };
}
