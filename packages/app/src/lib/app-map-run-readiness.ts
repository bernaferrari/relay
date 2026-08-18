import type { AppMap, CanvasGraph, Flow, RecipeStep } from "@relay/protocol";

export type AppMapRunNext = "run" | "record" | "keep" | "pick" | "capture" | "fix";

export type AppMapRunReadiness = {
  visible: boolean;
  ready: boolean;
  reason: string;
  /** What the top-right button should do next on this map. */
  next: AppMapRunNext;
  label: string;
  transitionPath: string[] | null;
};

export type AppMapRunSelection = {
  screenId?: string | null;
  transitionId?: string | null;
};

export type AppMapRunTarget = {
  flow: Flow;
  transitionPath: readonly string[];
  title?: string;
};

function entryScreenId(graph: CanvasGraph): string | undefined {
  const destinations = new Set(
    graph.transitions.flatMap((transition) =>
      transition.destination.kind === "screen" ? [transition.destination.screenId] : [],
    ),
  );
  const flowStarts = [...new Set(graph.flows.map((flow) => flow.screenId))];
  const roots = flowStarts.filter((screenId) => !destinations.has(screenId));
  if (roots.length === 1) return roots[0];
  return [...graph.flows].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  )[0]?.screenId;
}

function pathToScreen(graph: CanvasGraph, screenId: string): string[] | null {
  const start = entryScreenId(graph);
  if (!start) return null;
  if (start === screenId) return [];

  const queue = [start];
  const previous = new Map<string, { screenId: string; transitionId: string }>();
  while (queue.length) {
    const current = queue.shift()!;
    for (const transition of graph.transitions) {
      if (transition.fromScreenId !== current || transition.destination.kind !== "screen") continue;
      const next = transition.destination.screenId;
      if (next === start || previous.has(next)) continue;
      previous.set(next, { screenId: current, transitionId: transition.id });
      if (next === screenId) {
        const path: string[] = [];
        let cursor = next;
        while (cursor !== start) {
          const entry = previous.get(cursor);
          if (!entry) return null;
          path.unshift(entry.transitionId);
          cursor = entry.screenId;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

function inferredPath(graph: CanvasGraph): { path: string[] | null; reason?: string } {
  const start = entryScreenId(graph);
  if (!start) return { path: null, reason: "Save the first screen, then record a path" };

  const path: string[] = [];
  const seen = new Set<string>();
  let screenId = start;
  while (true) {
    const outgoing = graph.transitions.filter((transition) => transition.fromScreenId === screenId);
    if (!outgoing.length) return { path };
    if (outgoing.length > 1) {
      return {
        path: null,
        reason: "Select the destination screen you want to run to",
      };
    }
    const transition = outgoing[0]!;
    if (seen.has(transition.id)) {
      return { path: null, reason: "Select a destination before running this loop" };
    }
    seen.add(transition.id);
    path.push(transition.id);
    if (transition.destination.kind === "end") return { path };
    screenId = transition.destination.screenId;
  }
}

function selectedPath(
  graph: CanvasGraph,
  selection: AppMapRunSelection,
): Pick<AppMapRunReadiness, "transitionPath" | "reason" | "label" | "next"> {
  if (selection.transitionId) {
    const transition = graph.transitions.find(({ id }) => id === selection.transitionId);
    const sourcePath = transition ? pathToScreen(graph, transition.fromScreenId) : null;
    return sourcePath && transition
      ? {
          transitionPath: [...sourcePath, transition.id],
          reason: "",
          label: "Run to here",
          next: "run",
        }
      : {
          transitionPath: null,
          reason: "This path isn’t reachable from the start screen",
          label: "Run",
          next: "pick",
        };
  }

  if (selection.screenId) {
    const screenPath = pathToScreen(graph, selection.screenId);
    return screenPath
      ? {
          transitionPath: screenPath,
          reason: "",
          label: screenPath.length ? "Run to here" : "Run path",
          next: "run",
        }
      : {
          transitionPath: null,
          reason: "This screen isn’t reachable from the start screen",
          label: "Run",
          next: "pick",
        };
  }

  const inferred = inferredPath(graph);
  return {
    transitionPath: inferred.path,
    reason: inferred.reason ?? "",
    label: "Run path",
    next: inferred.path ? "run" : "pick",
  };
}

/**
 * Resolves exactly what the graph primary button means for this map.
 * Prefer a concrete next step (record / keep / pick) over a disabled "Run".
 */
export function appMapRunReadiness(input: {
  graph: CanvasGraph;
  recipeSteps: RecipeStep[];
  selection?: AppMapRunSelection;
}): AppMapRunReadiness {
  const { graph, recipeSteps, selection = {} } = input;
  if (!graph.flows[0]) {
    return {
      visible: true,
      ready: false,
      reason: "Save the first screen to start your map",
      next: "capture",
      label: "Save first screen",
      transitionPath: null,
    };
  }
  if (graph.transitions.length === 0) {
    return {
      visible: true,
      ready: false,
      reason: "Record taps between screens, or keep capturing screenshots for the map",
      next: "record",
      label: "Record path",
      transitionPath: null,
    };
  }

  const selected = selectedPath(graph, selection);
  if (!selected.transitionPath) {
    return {
      visible: true,
      ready: false,
      reason: selected.reason,
      next: selected.next,
      label: selected.next === "pick" ? "Choose a destination" : selected.label,
      transitionPath: null,
    };
  }
  if (!selected.transitionPath.length) {
    return {
      visible: true,
      ready: false,
      reason: "Click a destination screen to replay the app up to it",
      next: "pick",
      label: "Choose a destination",
      transitionPath: selected.transitionPath,
    };
  }

  const availableStepIds = new Set(recipeSteps.flatMap((step) => (step.id ? [step.id] : [])));
  for (const transitionId of selected.transitionPath) {
    const transition = graph.transitions.find(({ id }) => id === transitionId);
    if (!transition) {
      return {
        visible: true,
        ready: false,
        reason: "This path has a missing step — remove it or record again",
        next: "fix",
        label: "Fix path",
        transitionPath: selected.transitionPath,
      };
    }
    if (transition.state === "needs-recording") {
      return {
        visible: true,
        ready: false,
        reason: "Finish recording every step on this path first",
        next: "record",
        label: "Record path",
        transitionPath: selected.transitionPath,
      };
    }
    if (transition.review?.status !== "verified") {
      return {
        visible: true,
        ready: false,
        reason: "Try this path on the device, then keep it before running",
        next: "keep",
        label: "Keep",
        transitionPath: selected.transitionPath,
      };
    }
    if (transition.stepIds.some((id) => !availableStepIds.has(id))) {
      return {
        visible: true,
        ready: false,
        reason: "A recorded step is missing from this path — record it again",
        next: "fix",
        label: "Fix path",
        transitionPath: selected.transitionPath,
      };
    }
  }

  return {
    visible: true,
    ready: true,
    reason: "",
    next: "run",
    label: selected.label,
    transitionPath: selected.transitionPath,
  };
}

export function findRunnableFlow(
  appMap: AppMap | undefined,
  transitionPath: readonly string[] | null | undefined,
): Flow | undefined {
  if (!appMap || !transitionPath?.length) return undefined;
  return Object.values(appMap.flows)
    .filter(
      (flow) =>
        flow.connectionIds.length >= transitionPath.length &&
        transitionPath.every((connectionId, index) => flow.connectionIds[index] === connectionId),
    )
    .sort(
      (left, right) =>
        left.connectionIds.length - right.connectionIds.length ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id),
    )[0];
}

export function gateGraphRunReadiness<
  T extends { ready: boolean; reason?: string; label?: string; next?: string },
>(
  readiness: T,
  hasRunnableFlow: boolean,
): T | (T & { ready: false; reason: string; label: "Choose a destination"; next: "pick" }) {
  if (!readiness.ready || hasRunnableFlow) return readiness;
  return {
    ...readiness,
    ready: false,
    reason: "Select the last screen on a kept path to run it",
    label: "Choose a destination" as const,
    next: "pick" as const,
  };
}

/** Resolve a selected graph destination into the exact saved flow prefix to execute. */
export function appMapRunTarget(input: {
  appMap: AppMap | undefined;
  graph: CanvasGraph;
  recipeSteps: RecipeStep[];
  selection: AppMapRunSelection;
}): AppMapRunTarget | undefined {
  const readiness = appMapRunReadiness(input);
  const flow = findRunnableFlow(input.appMap, readiness.transitionPath);
  const gated = gateGraphRunReadiness(readiness, Boolean(flow));
  return gated.ready && flow && gated.transitionPath?.length
    ? { flow, transitionPath: gated.transitionPath }
    : undefined;
}
