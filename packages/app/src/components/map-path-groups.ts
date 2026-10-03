import type { ProductMapPath } from "@relay/product/map-exploration";
import type { PresentedMapPath } from "./map-presentation";

/** One visual wire per pair of screens; every saved path stays available for inspection. */
export function mapPathGroups(paths: readonly ProductMapPath[]): ProductMapPath[][] {
  const groups = new Map<string, ProductMapPath[]>();
  for (const path of paths) {
    const key = path.toScreenId ? `${path.fromScreenId}\u0000${path.toScreenId}` : path.id;
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  return [...groups.values()];
}

/** Collapse repeated display rows, retaining every recorded identity inside.
 * Exact action labels keep checks, wait durations, and different actions apart. */
export function mapActionGroups(paths: readonly ProductMapPath[]): ProductMapPath[][] {
  const groups = new Map<string, ProductMapPath[]>();
  for (const path of paths) {
    const key = JSON.stringify([path.fromScreenId, path.toScreenId ?? null, path.label]);
    const group = groups.get(key) ?? [];
    group.push(path);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function canvasMapPaths(
  paths: readonly ProductMapPath[],
  selectedPathId?: string,
): PresentedMapPath[] {
  return mapPathGroups(paths).map((group) => {
    const path = group.find((item) => item.id === selectedPathId) ?? group[0]!;
    return { ...path, ...(group.length > 1 ? { parallelPaths: group } : {}) };
  });
}
