import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { isRoutineReturn } from "./map-edge-paths";

/** Pick one stable entry per connected area. Saved flow origins win; cycles use their navigation hub. */
export function mapEntryScreenIds(
  screens: readonly ProductMapScreen[],
  paths: readonly ProductMapPath[],
): string[] {
  const known = new Set(screens.map((screen) => screen.id));
  const neighbors = new Map(screens.map((screen) => [screen.id, new Set<string>()]));
  const incoming = new Set<string>();
  const exits = new Map<string, Set<string>>();
  for (const path of paths) {
    if (!known.has(path.fromScreenId) || path.toScreenId === path.fromScreenId) continue;
    if (path.toScreenId && known.has(path.toScreenId)) {
      neighbors.get(path.fromScreenId)!.add(path.toScreenId);
      neighbors.get(path.toScreenId)!.add(path.fromScreenId);
      if (!isRoutineReturn(path)) incoming.add(path.toScreenId);
    }
    if (!isRoutineReturn(path)) {
      const targets = exits.get(path.fromScreenId) ?? new Set<string>();
      targets.add(path.toScreenId ?? path.id);
      exits.set(path.fromScreenId, targets);
    }
  }
  const visited = new Set<string>();
  const roots: string[] = [];
  for (const screen of [...screens].sort((a, b) => a.id.localeCompare(b.id))) {
    if (visited.has(screen.id)) continue;
    const ids = [screen.id];
    visited.add(screen.id);
    for (let i = 0; i < ids.length; i++)
      for (const id of neighbors.get(ids[i]!)!)
        if (!visited.has(id)) {
          visited.add(id);
          ids.push(id);
        }
    const candidates = screens.filter((item) => ids.includes(item.id));
    candidates.sort(
      (a, b) =>
        Number(Boolean(b.entryPoint)) - Number(Boolean(a.entryPoint)) ||
        Number(incoming.has(a.id)) - Number(incoming.has(b.id)) ||
        (exits.get(b.id)?.size ?? 0) - (exits.get(a.id)?.size ?? 0) ||
        a.id.localeCompare(b.id),
    );
    roots.push(candidates[0]!.id);
  }
  return roots;
}
