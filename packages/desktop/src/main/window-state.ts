export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PersistedWindowState = {
  version: 1;
  bounds: WindowBounds;
  maximized: boolean;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWindowBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const bounds = value as Record<string, unknown>;
  return (
    isFiniteNumber(bounds.x) &&
    isFiniteNumber(bounds.y) &&
    isFiniteNumber(bounds.width) &&
    bounds.width > 0 &&
    isFiniteNumber(bounds.height) &&
    bounds.height > 0
  );
}

function roundedBounds(bounds: WindowBounds): WindowBounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

export function parseWindowState(contents: string): PersistedWindowState | null {
  try {
    const value = JSON.parse(contents) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const state = value as Record<string, unknown>;
    if (state.version !== 1 || !isWindowBounds(state.bounds)) return null;
    if (typeof state.maximized !== "boolean") return null;
    return {
      version: 1,
      bounds: roundedBounds(state.bounds),
      maximized: state.maximized,
    };
  } catch {
    return null;
  }
}

function intersectionArea(first: WindowBounds, second: WindowBounds): number {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y),
  );
  return width * height;
}

function centerDistance(first: WindowBounds, second: WindowBounds): number {
  const firstX = first.x + first.width / 2;
  const firstY = first.y + first.height / 2;
  const secondX = second.x + second.width / 2;
  const secondY = second.y + second.height / 2;
  return Math.hypot(firstX - secondX, firstY - secondY);
}

function targetWorkArea(bounds: WindowBounds, workAreas: WindowBounds[]): WindowBounds | null {
  const candidates = workAreas.filter(isWindowBounds).map(roundedBounds);
  if (candidates.length === 0) return null;

  let target = candidates[0]!;
  let targetIntersection = intersectionArea(bounds, target);
  let targetDistance = centerDistance(bounds, target);
  for (const candidate of candidates.slice(1)) {
    const candidateIntersection = intersectionArea(bounds, candidate);
    const candidateDistance = centerDistance(bounds, candidate);
    if (
      candidateIntersection > targetIntersection ||
      (candidateIntersection === targetIntersection && candidateDistance < targetDistance)
    ) {
      target = candidate;
      targetIntersection = candidateIntersection;
      targetDistance = candidateDistance;
    }
  }
  return target;
}

/**
 * Fit persisted DIP coordinates inside the best current display work area.
 * The closest display is used when none overlap, which safely handles a
 * monitor being disconnected between launches.
 */
export function clampWindowBounds(
  savedBounds: WindowBounds,
  workAreas: WindowBounds[],
): WindowBounds {
  const bounds = roundedBounds(savedBounds);
  const workArea = targetWorkArea(bounds, workAreas);
  if (!workArea) return bounds;

  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height),
    width,
    height,
  };
}
