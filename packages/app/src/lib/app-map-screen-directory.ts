import type { AppMap } from "@relay/protocol";

export type ScreenDirectoryEntry = {
  incoming: number;
  outgoing: number;
  /** Titles a person can arrive from, in map order, without repeats. */
  reachedFrom: string[];
  /**
   * Only set when another screen carries the same title. Four tiles called
   * "Ask" are four indistinguishable objects until each says how it differs.
   */
  qualifier?: string;
};

export type ScreenDirectory = Record<string, ScreenDirectoryEntry>;

/** A screen graph reduced to what disambiguation needs: names and edges. */
export type ScreenGraph = {
  screenIds: readonly string[];
  /** The name the surface actually paints, so two surfaces cannot disagree
   * about which screens are duplicates of each other. */
  titleFor: (screenId: string) => string;
  edges: Iterable<{ from: string; to?: string }>;
};

/**
 * Connectivity for every screen in one pass. Counting per tile re-scanned the
 * whole connection table once per screen, which is a quadratic walk on the
 * 44-screen maps this view exists to show.
 */
export function screenDirectoryFromGraph(graph: ScreenGraph): ScreenDirectory {
  const directory: ScreenDirectory = {};
  for (const id of graph.screenIds) directory[id] = { incoming: 0, outgoing: 0, reachedFrom: [] };

  for (const edge of graph.edges) {
    const source = directory[edge.from];
    if (source) source.outgoing += 1;
    const destination = edge.to ? directory[edge.to] : undefined;
    if (!destination) continue;
    destination.incoming += 1;
    const sourceTitle = graph.titleFor(edge.from).trim();
    if (sourceTitle && !destination.reachedFrom.includes(sourceTitle)) {
      destination.reachedFrom.push(sourceTitle);
    }
  }

  const byTitle = new Map<string, string[]>();
  for (const id of graph.screenIds) {
    const title = graph.titleFor(id).trim();
    byTitle.set(title, [...(byTitle.get(title) ?? []), id]);
  }
  for (const ids of byTitle.values()) {
    if (ids.length < 2) continue;
    // Where a screen is reached from is the difference a person can act on.
    // An ordinal is the last resort, and only because two identical tiles with
    // no ordinal are worse than two tiles labelled 1 and 2.
    const sources = ids.map((id) => directory[id]!.reachedFrom[0]);
    const distinct = new Set(sources.filter(Boolean)).size === ids.length;
    ids.forEach((id, index) => {
      const source = sources[index];
      directory[id]!.qualifier =
        distinct && source ? `from ${source}` : `${index + 1} of ${ids.length}`;
    });
  }
  return directory;
}

/** The saved map's own screens, named the way the Screens grid names them. */
export function screenDirectory(
  appMap: AppMap,
  titleFor: (screenId: string) => string = (id) => appMap.screens[id]?.title ?? "",
): ScreenDirectory {
  return screenDirectoryFromGraph({
    screenIds: Object.keys(appMap.screens),
    titleFor,
    edges: Object.values(appMap.connections).map((connection) => ({
      from: connection.fromScreenId,
      to: connection.destination.kind === "screen" ? connection.destination.screenId : undefined,
    })),
  });
}

/** The quiet line under a screen name: how a person gets in, and where it goes.
 *
 * Both halves are kept short enough to survive a tile only as wide as the phone
 * it shows. "Leads nowhere yet" was the one phrase that pushed the line past a
 * portrait tile and truncated it to "Leads nowhere …", which hid the very word
 * that made it worth reading. */
export function screenConnectivityLabel(entry: {
  incoming: number;
  outgoing: number;
  isStart: boolean;
  handoffReturn?: "back" | string;
}): string {
  const into = entry.isStart
    ? "Start screen"
    : entry.incoming
      ? `Reached from ${entry.incoming}`
      : "Not reached yet";
  const outOf = entry.outgoing ? `Leads to ${entry.outgoing}` : "No exits yet";
  return `${into} · ${outOf}`;
}
