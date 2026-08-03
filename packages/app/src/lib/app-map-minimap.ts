import type { CanvasPoint, CanvasViewport } from "./app-map-canvas-layout";

export type AppMapMinimapBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function minimapPoint(
  point: CanvasPoint,
  content: { width: number; height: number; left?: number; top?: number },
): CanvasPoint {
  return {
    x: clampPercent(((point.x - (content.left ?? 0)) / Math.max(1, content.width)) * 100),
    y: clampPercent(((point.y - (content.top ?? 0)) / Math.max(1, content.height)) * 100),
  };
}

export function minimapViewportBounds(
  viewport: CanvasViewport,
  client: { width: number; height: number },
  content: { width: number; height: number; left?: number; top?: number },
): AppMapMinimapBounds {
  const worldLeft = -viewport.x / viewport.scale;
  const worldTop = -viewport.y / viewport.scale;
  const worldRight = worldLeft + client.width / viewport.scale;
  const worldBottom = worldTop + client.height / viewport.scale;
  const contentLeft = content.left ?? 0;
  const contentTop = content.top ?? 0;
  const left = clampPercent(((worldLeft - contentLeft) / Math.max(1, content.width)) * 100);
  const top = clampPercent(((worldTop - contentTop) / Math.max(1, content.height)) * 100);
  const right = clampPercent(((worldRight - contentLeft) / Math.max(1, content.width)) * 100);
  const bottom = clampPercent(((worldBottom - contentTop) / Math.max(1, content.height)) * 100);
  const width = Math.min(100, Math.max(3, right - left));
  const height = Math.min(100, Math.max(3, bottom - top));
  return {
    left: Math.min(left, 100 - width),
    top: Math.min(top, 100 - height),
    width,
    height,
  };
}

export function minimapWorldPoint(
  ratio: CanvasPoint,
  content: { width: number; height: number; left?: number; top?: number },
): CanvasPoint {
  return {
    x: (content.left ?? 0) + clampUnit(ratio.x) * content.width,
    y: (content.top ?? 0) + clampUnit(ratio.y) * content.height,
  };
}

export function centerCanvasViewport(
  viewport: CanvasViewport,
  client: { width: number; height: number },
  point: CanvasPoint,
): CanvasViewport {
  return {
    ...viewport,
    x: client.width / 2 - point.x * viewport.scale,
    y: client.height / 2 - point.y * viewport.scale,
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
