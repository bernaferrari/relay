export type CanvasConnectionFocus = {
  selectedConnectionId: string | null;
  selectedGroupId: string | null;
  selectedScreenIds: ReadonlySet<string>;
};

type VisibleConnection = {
  id: string;
  fromScreenId: string;
  toScreenId: string;
};

export type CanvasConnectionPresentation = "full" | "summary" | "hidden";

/**
 * Pick one real connection for every directed group pair. These canonical
 * bridges keep the compound graph legible at rest without inventing aggregate
 * edges or rendering every internal route between the two groups.
 */
export function crossGroupConnectionRepresentatives(
  connections: readonly VisibleConnection[],
  groupForScreen: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const representatives = new Set<string>();
  const representedPairs = new Set<string>();

  for (const connection of connections) {
    const fromGroupId = groupForScreen.get(connection.fromScreenId);
    const toGroupId = groupForScreen.get(connection.toScreenId);
    if (!fromGroupId || !toGroupId || fromGroupId === toGroupId) continue;
    const pair = `${fromGroupId}\u0000${toGroupId}`;
    if (representedPairs.has(pair)) continue;
    representedPairs.add(pair);
    representatives.add(connection.id);
  }

  return representatives;
}

/**
 * Local routes are always visible. Cross-group structure is summarized as a
 * compound bundle per group pair; selecting a screen reveals only its exact
 * incident routes. Selecting a group never explodes the overview into a wire
 * diagram—the group inspector provides that detail without visual noise.
 */
export function canvasConnectionPresentation(
  connection: VisibleConnection,
  groupForScreen: ReadonlyMap<string, string>,
  focus: CanvasConnectionFocus,
): CanvasConnectionPresentation {
  const fromGroupId = groupForScreen.get(connection.fromScreenId);
  const toGroupId = groupForScreen.get(connection.toScreenId);
  if (!fromGroupId || !toGroupId || fromGroupId === toGroupId) return "full";

  if (
    connection.id === focus.selectedConnectionId ||
    focus.selectedScreenIds.has(connection.fromScreenId) ||
    focus.selectedScreenIds.has(connection.toScreenId)
  ) {
    return "full";
  }

  return "summary";
}
