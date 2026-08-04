import type { AppMap, Connection, Flow, Screen } from "@relay/protocol";

export type AppMapArea = {
  id: string;
  title: string;
  rootScreenId: string;
  screenIds: string[];
};

type AreaProjection = Pick<AppMap, "screens" | "connections" | "flows"> & {
  groups?: AppMap["groups"];
};

function orderedScreens(screens: Record<string, Screen>): Screen[] {
  return Object.values(screens).sort(
    (left, right) =>
      left.createdAt - right.createdAt ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
}

function screenDestinations(connections: Record<string, Connection>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const connection of Object.values(connections)) {
    if (connection.destination.kind !== "screen") continue;
    const destinations = result.get(connection.fromScreenId) ?? [];
    if (!destinations.includes(connection.destination.screenId)) {
      destinations.push(connection.destination.screenId);
      result.set(connection.fromScreenId, destinations);
    }
  }
  for (const destinations of result.values()) destinations.sort();
  return result;
}

function rootScreenIds(input: AreaProjection, screens: Screen[]): string[] {
  const flowRoots = Object.values(input.flows)
    .sort(
      (left: Flow, right: Flow) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    )
    .map((flow) => flow.startScreenId)
    .filter((id, index, values) => values.indexOf(id) === index && Boolean(input.screens[id]));
  if (flowRoots.length) return flowRoots;

  const incoming = new Set(
    Object.values(input.connections).flatMap((connection) =>
      connection.destination.kind === "screen" ? [connection.destination.screenId] : [],
    ),
  );
  const structuralRoots = screens
    .filter((screen) => !incoming.has(screen.id))
    .map((screen) => screen.id);
  return structuralRoots.length ? structuralRoots : screens[0] ? [screens[0].id] : [];
}

/**
 * Turn a graph into the quieter hierarchy people expect in a screen browser.
 * Each first-level destination becomes an area and owns its reachable branch.
 * The graph remains canonical: this is a deterministic projection, so an agent,
 * CLI client, and the desktop app always agree without another hidden store.
 */
export function deriveAppMapAreas(input: AreaProjection): AppMapArea[] {
  const screens = orderedScreens(input.screens);
  if (!screens.length) return [];
  const explicitGroups = Object.values(input.groups ?? {}).sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
  if (explicitGroups.length) {
    const roots = new Set(rootScreenIds(input, screens));
    const grouped = new Set(explicitGroups.flatMap((group) => group.screenIds));
    const groups = explicitGroups.flatMap((group): AppMapArea[] => {
      const screenIds = group.screenIds
        .filter((id) => Boolean(input.screens[id]))
        // A marquee records pointer order, which is useful for editing but not
        // for reading a product area. Keep the map entry first so the Screens
        // view starts where a person or agent would actually begin.
        .sort((left, right) => Number(roots.has(right)) - Number(roots.has(left)));
      return screenIds.length
        ? [{ id: `group:${group.id}`, title: group.name, rootScreenId: screenIds[0]!, screenIds }]
        : [];
    });
    const remainderScreens = Object.fromEntries(
      Object.entries(input.screens).filter(([id]) => !grouped.has(id)),
    );
    if (!Object.keys(remainderScreens).length) return groups;
    const remainderConnections = Object.fromEntries(
      Object.entries(input.connections).filter(([, connection]) => {
        const destinationId =
          connection.destination.kind === "screen" ? connection.destination.screenId : undefined;
        return (
          Boolean(remainderScreens[connection.fromScreenId]) &&
          (!destinationId || Boolean(remainderScreens[destinationId]))
        );
      }),
    );
    const remainderFlows = Object.fromEntries(
      Object.entries(input.flows).filter(([, flow]) =>
        Boolean(remainderScreens[flow.startScreenId]),
      ),
    );
    const remainder = deriveAppMapAreas({
      screens: remainderScreens,
      connections: remainderConnections,
      flows: remainderFlows,
    });
    const rootGroups = groups.filter((area) => area.screenIds.some((id) => roots.has(id)));
    const otherGroups = groups.filter((area) => !area.screenIds.some((id) => roots.has(id)));
    const rootRemainder = remainder.filter((area) => roots.has(area.rootScreenId));
    const otherRemainder = remainder.filter((area) => !roots.has(area.rootScreenId));
    return [...rootGroups, ...rootRemainder, ...otherGroups, ...otherRemainder];
  }
  const destinations = screenDestinations(input.connections);
  const roots = rootScreenIds(input, screens);
  const seeds: Array<{ id: string; title: string; root: string; order: number }> = [];
  const seenSeeds = new Set<string>();

  for (const rootId of roots) {
    const root = input.screens[rootId];
    if (!root) continue;
    if (!seenSeeds.has(rootId)) {
      seenSeeds.add(rootId);
      seeds.push({
        id: `area:${rootId}`,
        title: roots.length === 1 ? "Start" : root.title,
        root: rootId,
        order: seeds.length,
      });
    }
    for (const childId of destinations.get(rootId) ?? []) {
      const child = input.screens[childId];
      if (!child || seenSeeds.has(childId)) continue;
      seenSeeds.add(childId);
      seeds.push({ id: `area:${childId}`, title: child.title, root: childId, order: seeds.length });
    }
  }

  const assignment = new Map<string, { seed: (typeof seeds)[number]; distance: number }>();
  const queue = seeds.map((seed) => ({ screenId: seed.root, seed, distance: 0 }));
  while (queue.length) {
    const current = queue.shift()!;
    const previous = assignment.get(current.screenId);
    if (
      previous &&
      (previous.distance < current.distance ||
        (previous.distance === current.distance && previous.seed.order <= current.seed.order))
    ) {
      continue;
    }
    assignment.set(current.screenId, { seed: current.seed, distance: current.distance });
    for (const childId of destinations.get(current.screenId) ?? []) {
      // A first-level branch is its own area even though the start node also reaches it.
      const childSeed = seeds.find((seed) => seed.root === childId);
      queue.push({
        screenId: childId,
        seed: childSeed ?? current.seed,
        distance: childSeed ? 0 : current.distance + 1,
      });
    }
  }

  const groups = new Map<string, AppMapArea>();
  for (const screen of screens) {
    const selected = assignment.get(screen.id)?.seed;
    const id = selected?.id ?? "area:other";
    const group = groups.get(id) ?? {
      id,
      title: selected?.title ?? "Other screens",
      rootScreenId: selected?.root ?? screen.id,
      screenIds: [],
    };
    group.screenIds.push(screen.id);
    groups.set(id, group);
  }

  return [...groups.values()].sort((left, right) => {
    const leftOrder = seeds.find((seed) => seed.id === left.id)?.order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = seeds.find((seed) => seed.id === right.id)?.order ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.title.localeCompare(right.title);
  });
}

export type BrowseRunOutcome =
  | "passed"
  | "product-failure"
  | "harness-failure"
  | "uncertain"
  | "cancelled"
  | "running";

export function browseOutcomeLabel(outcome: BrowseRunOutcome): string {
  switch (outcome) {
    case "passed":
      return "Passed";
    case "product-failure":
      return "Product issue";
    case "harness-failure":
      return "Setup issue";
    case "uncertain":
      return "Needs review";
    case "cancelled":
      return "Cancelled";
    case "running":
      return "Running";
  }
}
