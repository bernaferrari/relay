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

export function canvasMapPaths(
  paths: readonly ProductMapPath[],
  selectedPathId?: string,
): PresentedMapPath[] {
  return mapPathGroups(paths).map((group) => {
    const path = group.find((item) => item.id === selectedPathId) ?? group[0]!;
    return { ...path, ...(group.length > 1 ? { parallelPaths: group } : {}) };
  });
}
