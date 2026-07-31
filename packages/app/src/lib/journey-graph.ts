import type {
  JourneyGraph,
  JourneyGraphDestination,
  JourneyGraphScreen,
  JourneyGraphTransition,
  JourneyMetadata,
  JourneyTransitionReview,
  JourneyVideoClip,
  RecipeStep,
} from "@relay/protocol";
import {
  buildJourneyTree,
  hasScreenIdentity,
  transitionLabel,
  type JourneyTree,
} from "./journey-tree";

/**
 * The FigJam-facing authoring model for a journey.
 *
 * A recipe is still the compact, target-neutral program Relay executes. This
 * module owns the separate document people arrange: screens, transitions, and
 * explicit flow starts. Keeping the seam pure makes migrations, a future Yjs
 * provider, and alternate canvas UIs straightforward to swap in.
 */

export type TakeDestination =
  | { kind: "new-screen"; title?: string }
  | { kind: "screen"; screenId: string }
  | { kind: "end" };

export type CommitTakeInput = {
  sourceScreenId?: string | null;
  destination?: TakeDestination;
  steps: RecipeStep[];
  takeId?: string;
  videoTakeId?: string;
  videoClip?: JourneyVideoClip;
  mode?: JourneyGraphTransition["mode"];
  review?: JourneyTransitionReview;
  at?: number;
};

function id(prefix: string, at: number): string {
  const suffix =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}-${at.toString(36)}-${suffix}`;
}

function cloneGraph(graph: JourneyGraph): JourneyGraph {
  return structuredClone(graph);
}

export function emptyJourneyGraph(): JourneyGraph {
  return { schemaVersion: 1, screens: [], transitions: [], flows: [] };
}

function screenTitle(step: RecipeStep | undefined, number: number): string {
  if (step?.kind === "tap") {
    const target = step.target.label ?? step.target.text ?? step.target.ref;
    if (target) return target.replace(/^@/, "");
  }
  if (step?.kind === "key" && step.key === "back") return "Previous screen";
  return `Screen ${number}`;
}

/**
 * Import pre-v6 inferred data once. The migration is intentionally tolerant:
 * older recipes without screenshots remain usable as an ordered captured path
 * without claiming that two anonymous actions represent the same screen.
 */
export function ensureJourneyGraph(metadata: JourneyMetadata, steps: RecipeStep[]): JourneyGraph {
  if (metadata.graph?.schemaVersion === 1) return cloneGraph(metadata.graph);

  const legacy = buildJourneyTree(steps);
  const screens: JourneyGraphScreen[] = legacy.nodes.map((node) => {
    const step = steps[node.representativeStepIndex];
    return {
      id: node.id,
      title: metadata.screenTitles?.[node.id]?.trim() || node.title,
      ...(step?.id ? { representativeStepId: step.id } : {}),
      createdAt: 0,
      updatedAt: 0,
    };
  });
  const knownScreenIds = new Set(screens.map((screen) => screen.id));
  const transitions: JourneyGraphTransition[] = legacy.edges.map((edge) => {
    const step = steps[edge.stepIndex];
    const saved = metadata.prototype?.connections?.find((connection) => connection.id === edge.id);
    return {
      id: edge.id,
      fromScreenId: edge.from,
      destination: { kind: "screen", screenId: edge.to },
      stepIds: step?.id ? [step.id] : [],
      label: saved?.label?.trim() || metadata.edgeLabels[edge.id] || edge.label,
      state: "recorded",
      kind: edge.kind,
      createdAt: saved?.createdAt ?? 0,
      updatedAt: saved?.updatedAt ?? 0,
    };
  });

  // A planned legacy connector is still an authored intent. Bring it forward
  // rather than silently deleting a person's unfinished route.
  for (const connection of metadata.prototype?.connections ?? []) {
    if (!knownScreenIds.has(connection.fromScreenId) || !knownScreenIds.has(connection.toScreenId))
      continue;
    if (transitions.some((transition) => transition.id === connection.id)) continue;
    transitions.push({
      id: connection.id,
      fromScreenId: connection.fromScreenId,
      destination: { kind: "screen", screenId: connection.toScreenId },
      stepIds: connection.stepId ? [connection.stepId] : [],
      ...(connection.takeId ? { takeId: connection.takeId } : {}),
      ...(connection.videoTakeId ? { videoTakeId: connection.videoTakeId } : {}),
      ...(connection.videoClip ? { videoClip: { ...connection.videoClip } } : {}),
      ...(connection.label?.trim() ? { label: connection.label.trim() } : {}),
      state: connection.stepId ? "recorded" : "needs-recording",
      kind: "forward",
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    });
  }

  const start = legacy.nodes[0];
  return {
    schemaVersion: 1,
    screens,
    transitions,
    flows: start
      ? [{ id: "flow-main", name: "Main flow", screenId: start.id, createdAt: 0, updatedAt: 0 }]
      : [],
  };
}

export function withJourneyGraph(metadata: JourneyMetadata, graph: JourneyGraph): JourneyMetadata {
  return { ...metadata, schemaVersion: 6, graph: cloneGraph(graph) };
}

function sourceForTake(
  graph: JourneyGraph,
  requested: string | null | undefined,
  at: number,
): {
  graph: JourneyGraph;
  source: JourneyGraphScreen;
} {
  const copy = cloneGraph(graph);
  const existing = requested ? copy.screens.find((screen) => screen.id === requested) : undefined;
  if (existing) return { graph: copy, source: existing };
  const currentFlow = copy.flows[0];
  const flowScreen = currentFlow
    ? copy.screens.find((screen) => screen.id === currentFlow.screenId)
    : undefined;
  if (flowScreen) return { graph: copy, source: flowScreen };

  const source: JourneyGraphScreen = {
    id: id("screen-start", at),
    title: "Start",
    createdAt: at,
    updatedAt: at,
  };
  copy.screens.push(source);
  copy.flows.push({
    id: id("flow", at),
    name: "Main flow",
    screenId: source.id,
    createdAt: at,
    updatedAt: at,
  });
  return { graph: copy, source };
}

/**
 * Make a reviewed take permanent in one atomic graph mutation. The recipe
 * append happens separately, but callers pass its final stable step ids here
 * so the graph can never refer to ephemeral recorder ids.
 */
export function commitTakeToJourneyGraph(
  current: JourneyGraph,
  input: CommitTakeInput,
): { graph: JourneyGraph; transition: JourneyGraphTransition; destinationScreenId?: string } {
  const at = input.at ?? Date.now();
  const { graph, source } = sourceForTake(current, input.sourceScreenId, at);
  const destination = input.destination ?? { kind: "new-screen" as const };
  const lastStep = input.steps.at(-1);
  let target: JourneyGraphDestination;
  let destinationScreenId: string | undefined;

  if (destination.kind === "end") {
    target = { kind: "end" };
  } else if (destination.kind === "screen") {
    const destinationScreen = graph.screens.find((screen) => screen.id === destination.screenId);
    if (!destinationScreen) throw new Error("The selected destination screen no longer exists");
    target = { kind: "screen", screenId: destinationScreen.id };
    destinationScreenId = destinationScreen.id;
  } else {
    const screen: JourneyGraphScreen = {
      id: id("screen", at),
      title: destination.title?.trim() || screenTitle(lastStep, graph.screens.length),
      ...(lastStep?.id ? { representativeStepId: lastStep.id } : {}),
      createdAt: at,
      updatedAt: at,
    };
    graph.screens.push(screen);
    target = { kind: "screen", screenId: screen.id };
    destinationScreenId = screen.id;
  }

  const isReturn =
    target.kind === "screen" &&
    graph.transitions.some(
      (transition) =>
        transition.fromScreenId === target.screenId &&
        transition.destination.kind === "screen" &&
        transition.destination.screenId === source.id,
    );
  const transition: JourneyGraphTransition = {
    id: id("transition", at),
    fromScreenId: source.id,
    destination: target,
    stepIds: input.steps.flatMap((step) => (step.id ? [step.id] : [])),
    ...(input.takeId ? { takeId: input.takeId } : {}),
    ...(input.videoTakeId ? { videoTakeId: input.videoTakeId } : {}),
    ...(input.videoClip ? { videoClip: { ...input.videoClip } } : {}),
    mode: input.mode ?? "interaction",
    ...(input.review ? { review: { ...input.review } } : {}),
    label: lastStep ? transitionLabel(lastStep) : "Continue",
    state: input.steps.length ? "recorded" : "needs-recording",
    kind: isReturn ? "return" : "forward",
    createdAt: at,
    updatedAt: at,
  };
  graph.transitions.push(transition);
  return { graph, transition, ...(destinationScreenId ? { destinationScreenId } : {}) };
}

export function addGraphConnection(
  graph: JourneyGraph,
  input: { fromScreenId: string; toScreenId: string; label?: string },
  at = Date.now(),
): { graph: JourneyGraph; transition: JourneyGraphTransition } {
  const copy = cloneGraph(graph);
  const known = new Set(copy.screens.map((screen) => screen.id));
  if (!known.has(input.fromScreenId) || !known.has(input.toScreenId)) {
    throw new Error("Connections can only join screens in this journey");
  }
  const transition: JourneyGraphTransition = {
    id: id("transition", at),
    fromScreenId: input.fromScreenId,
    destination: { kind: "screen", screenId: input.toScreenId },
    stepIds: [],
    ...(input.label?.trim() ? { label: input.label.trim() } : {}),
    state: "needs-recording",
    kind: "forward",
    createdAt: at,
    updatedAt: at,
  };
  copy.transitions.push(transition);
  return { graph: copy, transition };
}

export function addGraphScreenConnection(
  graph: JourneyGraph,
  input: {
    fromScreenId: string;
    title?: string;
    position: { x: number; y: number };
  },
  at = Date.now(),
): {
  graph: JourneyGraph;
  transition: JourneyGraphTransition;
  screen: JourneyGraphScreen;
  position: { x: number; y: number };
} {
  const copy = cloneGraph(graph);
  if (!copy.screens.some((screen) => screen.id === input.fromScreenId)) {
    throw new Error("A new screen must connect from an existing screen");
  }
  const screen: JourneyGraphScreen = {
    id: id("screen", at),
    title: input.title?.trim() || "New screen",
    createdAt: at,
    updatedAt: at,
  };
  copy.screens.push(screen);
  const connected = addGraphConnection(
    copy,
    { fromScreenId: input.fromScreenId, toScreenId: screen.id },
    at,
  );
  return {
    ...connected,
    screen,
    position: input.position,
  };
}

export function removeGraphConnection(graph: JourneyGraph, id: string): JourneyGraph {
  return {
    ...cloneGraph(graph),
    transitions: graph.transitions.filter((transition) => transition.id !== id),
  };
}

export function attachGraphConnectionSteps(
  graph: JourneyGraph,
  id: string,
  steps: RecipeStep[],
  capture?: {
    takeId?: string;
    videoTakeId?: string;
    videoClip?: JourneyVideoClip;
    mode?: JourneyGraphTransition["mode"];
  },
  at = Date.now(),
): JourneyGraph {
  const copy = cloneGraph(graph);
  copy.transitions = copy.transitions.map((transition) =>
    transition.id === id
      ? {
          ...transition,
          stepIds: steps.flatMap((step) => (step.id ? [step.id] : [])),
          ...(capture?.takeId ? { takeId: capture.takeId } : {}),
          ...(capture?.videoTakeId ? { videoTakeId: capture.videoTakeId } : {}),
          ...(capture?.videoClip ? { videoClip: { ...capture.videoClip } } : {}),
          mode: capture?.mode ?? transition.mode ?? "interaction",
          review: { status: "draft", updatedAt: at },
          label: transition.label || (steps[0] ? transitionLabel(steps[0]) : "Continue"),
          state: steps.length ? "recorded" : "needs-recording",
          updatedAt: at,
        }
      : transition,
  );
  return copy;
}

export function reviewGraphTransition(
  graph: JourneyGraph,
  id: string,
  review: Pick<JourneyTransitionReview, "status" | "error">,
  at = Date.now(),
): JourneyGraph {
  const copy = cloneGraph(graph);
  copy.transitions = copy.transitions.map((transition) =>
    transition.id === id
      ? {
          ...transition,
          review: {
            status: review.status,
            updatedAt: at,
            ...(review.status === "verified" ? { verifiedAt: at } : {}),
            ...(review.error ? { error: review.error } : {}),
          },
          updatedAt: at,
        }
      : transition,
  );
  return copy;
}

/** Adapt the explicit document to the existing canvas card primitives. */
export function buildJourneyGraphTree(graph: JourneyGraph, steps: RecipeStep[]): JourneyTree {
  const stepIndexById = new Map(steps.map((step, index) => [step.id, index]));
  const screenById = new Map(graph.screens.map((screen) => [screen.id, screen]));
  const startIds = graph.flows.map((flow) => flow.screenId).filter((id) => screenById.has(id));
  const depths = new Map<string, number>();
  const queue = [
    ...new Set(startIds.length ? startIds : graph.screens.slice(0, 1).map((screen) => screen.id)),
  ];
  for (const id of queue) depths.set(id, 0);
  for (let index = 0; index < queue.length; index += 1) {
    const from = queue[index]!;
    const depth = depths.get(from) ?? 0;
    for (const transition of graph.transitions) {
      if (transition.fromScreenId !== from || transition.destination.kind !== "screen") continue;
      const target = transition.destination.screenId;
      if (!screenById.has(target) || depths.has(target)) continue;
      depths.set(target, depth + 1);
      queue.push(target);
    }
  }
  for (const screen of graph.screens) {
    if (!depths.has(screen.id)) {
      depths.set(screen.id, Math.max(0, ...depths.values(), -1) + 1);
      queue.push(screen.id);
    }
  }
  const rowsByDepth = new Map<number, number>();
  const nodes = graph.screens
    .map((screen) => {
      const representativeStepIndex =
        (screen.representativeStepId
          ? stepIndexById.get(screen.representativeStepId)
          : undefined) ?? -1;
      const depth = depths.get(screen.id) ?? 0;
      const row = rowsByDepth.get(depth) ?? 0;
      rowsByDepth.set(depth, row + 1);
      return {
        id: screen.id,
        screenKey: screen.id,
        title: screen.title,
        representativeStepIndex,
        stepIndexes: [representativeStepIndex].filter(
          (value) => value >= 0 && value < steps.length,
        ),
        depth,
        x: depth * 284,
        y: row * 328,
      };
    })
    .sort((a, b) => a.depth - b.depth || a.y - b.y);

  return {
    nodes,
    edges: graph.transitions.flatMap((transition) => {
      if (transition.destination.kind !== "screen") return [];
      const stepIndex = transition.stepIds
        .map((stepId) => stepIndexById.get(stepId))
        .find((value): value is number => value !== undefined);
      return [
        {
          id: transition.id,
          from: transition.fromScreenId,
          to: transition.destination.screenId,
          stepIndex: stepIndex ?? 0,
          label:
            transition.label ||
            (stepIndex !== undefined ? transitionLabel(steps[stepIndex]!) : "Record action"),
          kind: transition.kind,
        },
      ];
    }),
    hasScreenIdentity: graph.screens.some((screen) => {
      const index = screen.representativeStepId
        ? stepIndexById.get(screen.representativeStepId)
        : undefined;
      return index !== undefined && hasScreenIdentity(steps[index]!);
    }),
  };
}
