import type { DiscoverySession, ObservedScreen, ObservedTransition } from "@relay/protocol";

export type DiscoveryCanvasPosition = {
  x: number;
  y: number;
  level: number;
  reachable: boolean;
};

export type DiscoveryCanvasDimensions = {
  width: number;
  height: number;
  columnGap: number;
  rowGap: number;
};

export type DiscoveryPathRow = {
  screen: ObservedScreen;
  depth: number;
  path: ObservedTransition[];
  incoming: ObservedTransition | null;
  reachable: boolean;
};

/**
 * Project the observed graph into deterministic canvas columns.
 *
 * A breadth-first walk gives every screen its shortest stable depth. Marking
 * screens visited when they are queued makes back-edges harmless and keeps
 * sibling branches together in the order they were observed. Unlinked
 * captures are placed after the reachable graph instead of pretending to be
 * roots, which makes them visible without corrupting the journey.
 */
export function discoveryCanvasLayout(
  session: DiscoverySession,
  dimensions: DiscoveryCanvasDimensions,
): Record<string, DiscoveryCanvasPosition> {
  const root = session.screens[0];
  if (!root) return {};

  const screens = new Map(session.screens.map((screen) => [screen.id, screen]));
  const outgoing = new Map<string, ObservedTransition[]>();
  for (const transition of session.transitions) {
    if (!transition.changedScreen || !transition.toScreenId || !screens.has(transition.toScreenId))
      continue;
    const list = outgoing.get(transition.fromScreenId) ?? [];
    list.push(transition);
    outgoing.set(transition.fromScreenId, list);
  }
  for (const list of outgoing.values())
    list.sort((a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id));

  const levelById = new Map<string, number>([[root.id, 0]]);
  const order: string[] = [root.id];
  for (let index = 0; index < order.length; index += 1) {
    const current = order[index]!;
    const level = levelById.get(current) ?? 0;
    for (const transition of outgoing.get(current) ?? []) {
      const next = transition.toScreenId!;
      if (levelById.has(next)) continue;
      levelById.set(next, level + 1);
      order.push(next);
    }
  }

  const maxReachableLevel = Math.max(...levelById.values());
  const unreachable = session.screens
    .filter((screen) => !levelById.has(screen.id))
    .map((screen) => screen.id);
  const byLevel = new Map<number, string[]>();
  for (const id of [...order, ...unreachable]) {
    const level = levelById.get(id) ?? maxReachableLevel + 1;
    const list = byLevel.get(level) ?? [];
    list.push(id);
    byLevel.set(level, list);
  }

  const positions: Record<string, DiscoveryCanvasPosition> = {};
  for (const [level, ids] of byLevel) {
    ids.forEach((id, row) => {
      positions[id] = {
        x: level * (dimensions.width + dimensions.columnGap),
        y: row * (dimensions.height + dimensions.rowGap),
        level,
        reachable: levelById.has(id),
      };
    });
  }
  return positions;
}

/** Turn the observed graph into a stable, keyboard-friendly reading order. */
export function discoveryPathRows(session: DiscoverySession): DiscoveryPathRow[] {
  const root = session.screens[0];
  if (!root) return [];

  const screens = new Map(session.screens.map((screen) => [screen.id, screen]));
  const outgoing = new Map<string, ObservedTransition[]>();
  for (const transition of session.transitions) {
    if (!transition.changedScreen || !transition.toScreenId || !screens.has(transition.toScreenId))
      continue;
    const current = outgoing.get(transition.fromScreenId) ?? [];
    current.push(transition);
    outgoing.set(transition.fromScreenId, current);
  }
  for (const transitions of outgoing.values())
    transitions.sort((a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id));

  const rows: DiscoveryPathRow[] = [];
  const visited = new Set<string>();
  const queue: Array<{ screen: ObservedScreen; path: ObservedTransition[] }> = [
    { screen: root, path: [] },
  ];
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (visited.has(item.screen.id)) continue;
    visited.add(item.screen.id);
    rows.push({
      screen: item.screen,
      depth: item.path.length,
      path: item.path,
      incoming: item.path.at(-1) ?? null,
      reachable: true,
    });
    for (const transition of outgoing.get(item.screen.id) ?? []) {
      const next = screens.get(transition.toScreenId!);
      if (next && !visited.has(next.id))
        queue.push({ screen: next, path: [...item.path, transition] });
    }
  }
  for (const screen of session.screens) {
    if (!visited.has(screen.id))
      rows.push({ screen, depth: 0, path: [], incoming: null, reachable: false });
  }
  return rows;
}
