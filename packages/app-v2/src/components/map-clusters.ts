import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import type { MapBounds, MapNodeSize, MapPoint } from "./map-canvas-geometry";

export type MapCluster = {
  id: string;
  /** The screen people enter this area from (nothing inside leads to it). */
  entryTitle: string;
  screenIds: string[];
  bounds: MapBounds;
};

/**
 * Screens that are connected to each other form one area of the app. Areas
 * of two or more screens get a region on the canvas; loose screens do not.
 */
export function mapClusters(
  screens: readonly ProductMapScreen[],
  paths: readonly ProductMapPath[],
  positions: ReadonlyMap<string, MapPoint>,
  node: MapNodeSize,
  padding = 40,
): MapCluster[] {
  const parent = new Map(screens.map((screen) => [screen.id, screen.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const incoming = new Set<string>();
  for (const path of paths) {
    if (!path.toScreenId || path.toScreenId === path.fromScreenId) continue;
    if (!parent.has(path.fromScreenId) || !parent.has(path.toScreenId)) continue;
    parent.set(find(path.fromScreenId), find(path.toScreenId));
    incoming.add(path.toScreenId);
  }
  const groups = new Map<string, ProductMapScreen[]>();
  for (const screen of screens) {
    const root = find(screen.id);
    groups.set(root, [...(groups.get(root) ?? []), screen]);
  }
  return [...groups.values()]
    .filter((members) => members.length > 1)
    .flatMap((members) => {
      const points = members.flatMap((screen) => {
        const point = positions.get(screen.id);
        return point ? [point] : [];
      });
      if (!points.length) return [];
      const entry = members.find((screen) => !incoming.has(screen.id)) ?? members[0]!;
      return [
        {
          id: members.map((screen) => screen.id).sort()[0]!,
          entryTitle: entry.title,
          screenIds: members.map((screen) => screen.id),
          bounds: {
            minX: Math.min(...points.map((point) => point.x)) - padding,
            minY: Math.min(...points.map((point) => point.y)) - padding,
            maxX: Math.max(...points.map((point) => point.x + node.width)) + padding,
            maxY: Math.max(...points.map((point) => point.y + node.height)) + padding,
          },
        },
      ];
    });
}
