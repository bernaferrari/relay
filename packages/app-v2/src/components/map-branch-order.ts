import type { ProductMapPath } from "@relay/product/map-exploration";

/** Order complete control groups without guessing where uncaptured controls belong. */
export function orderMapBranches(paths: readonly ProductMapPath[], horizontal: boolean) {
  const groups = new Map<string, ProductMapPath[]>();
  for (const path of paths) {
    const group = groups.get(path.fromScreenId) ?? [];
    group.push(path);
    groups.set(path.fromScreenId, group);
  }
  return [...groups.values()].flatMap((group) => {
    if (group.length < 2 || group.some((path) => !path.sourceAnchor)) return group;
    const ordered = [...group].sort(
      (a, b) =>
        a.sourceAnchor!.point.y - b.sourceAnchor!.point.y ||
        a.sourceAnchor!.point.x - b.sourceAnchor!.point.x ||
        a.id.localeCompare(b.id),
    );
    // The highest controls take the outermost branches. Lower controls stay
    // nearest the stem, so their vertical routes don't cross earlier exits.
    return horizontal
      ? [
          ...ordered.filter((_, index) => index % 2 === 0),
          ...ordered.filter((_, index) => index % 2 === 1).reverse(),
        ]
      : ordered;
  });
}
