import type { CanvasGraph, RecipeStep } from "@relay/protocol";

export type AppMapRunReadiness = {
  visible: boolean;
  ready: boolean;
  reason: string;
  label: "Run flow" | "Run to here" | "Run";
  transitionPath: string[] | null;
};

type AppMapRunSelection = {
  screenId?: string | null;
  transitionId?: string | null;
};

function pathToScreen(graph: CanvasGraph, screenId: string): string[] | null {
  const start = graph.flows[0]?.screenId;
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
  const start = graph.flows[0]?.screenId;
  if (!start) return { path: null, reason: "Capture the entry screen first" };

  const path: string[] = [];
  const seen = new Set<string>();
  let screenId = start;
  while (true) {
    const outgoing = graph.transitions.filter((transition) => transition.fromScreenId === screenId);
    if (!outgoing.length) return { path };
    if (outgoing.length > 1) {
      return {
        path: null,
        reason: "Select a destination screen to choose which path to run",
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
): Pick<AppMapRunReadiness, "transitionPath" | "reason" | "label"> {
  if (selection.transitionId) {
    const transition = graph.transitions.find(({ id }) => id === selection.transitionId);
    const sourcePath = transition ? pathToScreen(graph, transition.fromScreenId) : null;
    return sourcePath && transition
      ? {
          transitionPath: [...sourcePath, transition.id],
          reason: "",
          label: "Run to here",
        }
      : {
          transitionPath: null,
          reason: "This connection is not reachable from the entry screen",
          label: "Run",
        };
  }

  if (selection.screenId) {
    const screenPath = pathToScreen(graph, selection.screenId);
    return screenPath
      ? {
          transitionPath: screenPath,
          reason: "",
          label: screenPath.length ? "Run to here" : "Run flow",
        }
      : {
          transitionPath: null,
          reason: "This screen is not reachable from the entry screen",
          label: "Run",
        };
  }

  const inferred = inferredPath(graph);
  return {
    transitionPath: inferred.path,
    reason: inferred.reason ?? "",
    label: "Run flow",
  };
}

/**
 * Resolves exactly what the graph Run button means. A connection can be a
 * verified no-op/automatic edge, so readiness is based on the selected graph
 * path—not on unrelated actions in the compiled recipe.
 */
export function appMapRunReadiness(input: {
  graph: CanvasGraph;
  recipeSteps: RecipeStep[];
  selection?: AppMapRunSelection;
}): AppMapRunReadiness {
  const { graph, recipeSteps, selection = {} } = input;
  if (!graph.flows[0] || graph.transitions.length === 0) {
    return {
      visible: false,
      ready: false,
      reason: "Record a connection before running this flow",
      label: "Run flow",
      transitionPath: null,
    };
  }

  const selected = selectedPath(graph, selection);
  if (!selected.transitionPath) {
    return { visible: true, ready: false, ...selected };
  }
  if (!selected.transitionPath.length) {
    return {
      visible: true,
      ready: false,
      reason: "Select a destination screen or connection",
      label: selected.label,
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
        reason: "This path has a missing connection",
        label: selected.label,
        transitionPath: selected.transitionPath,
      };
    }
    if (transition.state === "needs-recording") {
      return {
        visible: true,
        ready: false,
        reason: "Record every connection on this path first",
        label: selected.label,
        transitionPath: selected.transitionPath,
      };
    }
    if (transition.review?.status !== "verified") {
      return {
        visible: true,
        ready: false,
        reason: "Try and approve every connection on this path",
        label: selected.label,
        transitionPath: selected.transitionPath,
      };
    }
    if (transition.stepIds.some((id) => !availableStepIds.has(id))) {
      return {
        visible: true,
        ready: false,
        reason: "A recorded action is missing from this path",
        label: selected.label,
        transitionPath: selected.transitionPath,
      };
    }
  }

  return {
    visible: true,
    ready: true,
    reason: "",
    label: selected.label,
    transitionPath: selected.transitionPath,
  };
}
