import type {
  JourneyGraph,
  JourneyGraphDestination,
  JourneyGraphScreen,
  JourneyGraphTransition,
  JourneyMetadata,
  JourneyScreenObservation,
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
  sourceObservation?: JourneyScreenObservation;
  destinationObservation?: JourneyScreenObservation;
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

function withObservation(
  screen: JourneyGraphScreen,
  observation: JourneyScreenObservation | undefined,
): JourneyGraphScreen {
  if (!observation) return screen;
  const observations = screen.observations ?? [];
  const next = observations.some((item) => item.id === observation.id)
    ? observations
    : [...observations, structuredClone(observation)];
  const aliases = new Set(screen.identity?.aliases ?? []);
  if (screen.identity?.fingerprint && screen.identity.fingerprint !== observation.fingerprint) {
    aliases.add(observation.fingerprint);
  }
  return {
    ...screen,
    identity: screen.identity ?? {
      schemaVersion: 1,
      fingerprint: observation.fingerprint,
    },
    ...(aliases.size
      ? {
          identity: {
            ...(screen.identity ?? {
              schemaVersion: 1 as const,
              fingerprint: observation.fingerprint,
            }),
            aliases: [...aliases].sort(),
          },
        }
      : {}),
    observations: next,
    updatedAt: Math.max(screen.updatedAt, observation.capturedAt),
  };
}

export function screenForObservation(
  graph: JourneyGraph,
  observation: JourneyScreenObservation | undefined,
): JourneyGraphScreen | undefined {
  if (!observation) return undefined;
  return graph.screens.find(
    (screen) =>
      screen.identity?.fingerprint === observation.fingerprint ||
      screen.identity?.aliases?.includes(observation.fingerprint) ||
      screen.observations?.some((item) => item.fingerprint === observation.fingerprint),
  );
}

export function observeJourneyGraphScreen(
  graph: JourneyGraph,
  screenId: string,
  observation: JourneyScreenObservation | undefined,
): JourneyGraph {
  if (!observation) return cloneGraph(graph);
  const copy = cloneGraph(graph);
  copy.screens = copy.screens.map((screen) =>
    screen.id === screenId ? withObservation(screen, observation) : screen,
  );
  return copy;
}

export function emptyJourneyGraph(): JourneyGraph {
  return { schemaVersion: 1, screens: [], transitions: [], flows: [] };
}

/** Remove one authored screen and the canvas-only routes that depend on it.
 * Executable recipe steps are deliberately left intact until their connection
 * is explicitly rewritten, so deleting layout never silently deletes test
 * behavior. The canonical App Map operation performs the final reference
 * safety check before the removal is shared. */
export function removeJourneyGraphScreen(graph: JourneyGraph, screenId: string): JourneyGraph {
  const copy = cloneGraph(graph);
  if (!copy.screens.some((screen) => screen.id === screenId)) return copy;
  copy.screens = copy.screens.filter((screen) => screen.id !== screenId);
  copy.transitions = copy.transitions.filter(
    (transition) =>
      transition.fromScreenId !== screenId &&
      !(transition.destination.kind === "screen" && transition.destination.screenId === screenId),
  );
  copy.flows = copy.flows.filter((flow) => flow.screenId !== screenId);
  return copy;
}

/** Establish the first canvas node without creating a fake transition or
 * executable screenshot step. The observation is the durable screen identity;
 * recording can begin later from this explicit entry point. */
export function addJourneyStartScreen(
  graph: JourneyGraph,
  observation: JourneyScreenObservation,
  input: { title?: string; at?: number } = {},
): { graph: JourneyGraph; screen: JourneyGraphScreen } {
  if (graph.screens.length || graph.flows.length) {
    throw new Error("A start screen can only be added to an empty App Map");
  }
  const at = input.at ?? Date.now();
  const copy = cloneGraph(graph);
  const screen: JourneyGraphScreen = {
    id: id("screen-start", at),
    title: input.title?.trim() || "Start",
    identity: { schemaVersion: 1, fingerprint: observation.fingerprint },
    observations: [structuredClone(observation)],
    createdAt: at,
    updatedAt: at,
  };
  copy.screens.push(screen);
  copy.flows.push({
    id: id("flow", at),
    name: "Main flow",
    screenId: screen.id,
    createdAt: at,
    updatedAt: at,
  });
  return { graph: copy, screen };
}

/** Capture a unique app state without inventing a transition. Re-observing a
 * known state enriches that screen instead of creating a duplicate node. */
export function addJourneyGraphScreen(
  graph: JourneyGraph,
  observation: JourneyScreenObservation,
  input: { title?: string; at?: number } = {},
): { graph: JourneyGraph; screen: JourneyGraphScreen; created: boolean } {
  if (!graph.screens.length) {
    const first = addJourneyStartScreen(graph, observation, input);
    return { ...first, created: true };
  }
  const existing = screenForObservation(graph, observation);
  if (existing) {
    const next = observeJourneyGraphScreen(graph, existing.id, observation);
    return {
      graph: next,
      screen: next.screens.find((screen) => screen.id === existing.id)!,
      created: false,
    };
  }
  const at = input.at ?? Date.now();
  const copy = cloneGraph(graph);
  const screen: JourneyGraphScreen = {
    id: id("screen", at),
    title: input.title?.trim() || `Screen ${copy.screens.length + 1}`,
    identity: { schemaVersion: 1, fingerprint: observation.fingerprint },
    observations: [structuredClone(observation)],
    createdAt: at,
    updatedAt: at,
  };
  copy.screens.push(screen);
  return { graph: copy, screen, created: true };
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
      review: {
        status: "verified",
        updatedAt: saved?.updatedAt ?? 0,
        verifiedAt: saved?.updatedAt ?? 0,
      },
      provenance: { source: "migration" },
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
      ...(connection.stepId
        ? {
            review: {
              status: "verified" as const,
              updatedAt: connection.updatedAt,
              verifiedAt: connection.updatedAt,
            },
          }
        : {}),
      provenance: { source: "migration" },
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
  observation: JourneyScreenObservation | undefined,
  at: number,
): {
  graph: JourneyGraph;
  source: JourneyGraphScreen;
} {
  const copy = cloneGraph(graph);
  const existing = requested ? copy.screens.find((screen) => screen.id === requested) : undefined;
  if (existing) {
    const source = withObservation(existing, observation);
    copy.screens = copy.screens.map((screen) => (screen.id === source.id ? source : screen));
    return { graph: copy, source };
  }
  const observed = screenForObservation(copy, observation);
  if (observed) {
    const source = withObservation(observed, observation);
    copy.screens = copy.screens.map((screen) => (screen.id === source.id ? source : screen));
    return { graph: copy, source };
  }
  const currentFlow = copy.flows[0];
  const flowScreen = currentFlow
    ? copy.screens.find((screen) => screen.id === currentFlow.screenId)
    : undefined;
  if (flowScreen) return { graph: copy, source: flowScreen };

  const source: JourneyGraphScreen = {
    id: id("screen-start", at),
    title: "Start",
    ...(observation
      ? {
          identity: { schemaVersion: 1, fingerprint: observation.fingerprint },
          observations: [structuredClone(observation)],
        }
      : {}),
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
  const { graph, source } = sourceForTake(
    current,
    input.sourceScreenId,
    input.sourceObservation,
    at,
  );
  const observedDestination = screenForObservation(graph, input.destinationObservation);
  const destination: TakeDestination =
    input.destination?.kind === "new-screen" && observedDestination
      ? { kind: "screen", screenId: observedDestination.id }
      : (input.destination ??
        (observedDestination
          ? { kind: "screen", screenId: observedDestination.id }
          : { kind: "new-screen" }));
  const lastStep = input.steps.at(-1);
  let target: JourneyGraphDestination;
  let destinationScreenId: string | undefined;

  if (destination.kind === "end") {
    target = { kind: "end" };
  } else if (destination.kind === "screen") {
    const destinationScreen = graph.screens.find((screen) => screen.id === destination.screenId);
    if (!destinationScreen) throw new Error("The selected destination screen no longer exists");
    const observed = withObservation(destinationScreen, input.destinationObservation);
    graph.screens = graph.screens.map((screen) => (screen.id === observed.id ? observed : screen));
    target = { kind: "screen", screenId: observed.id };
    destinationScreenId = destinationScreen.id;
  } else {
    const screen: JourneyGraphScreen = {
      id: id("screen", at),
      title: destination.title?.trim() || screenTitle(lastStep, graph.screens.length),
      ...(input.destinationObservation
        ? {
            identity: {
              schemaVersion: 1,
              fingerprint: input.destinationObservation.fingerprint,
            },
            observations: [structuredClone(input.destinationObservation)],
          }
        : {}),
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
    provenance: { source: "recording" },
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
    throw new Error("Connections can only join screens in this App Map");
  }
  const transition: JourneyGraphTransition = {
    id: id("transition", at),
    fromScreenId: input.fromScreenId,
    destination: { kind: "screen", screenId: input.toScreenId },
    stepIds: [],
    ...(input.label?.trim() ? { label: input.label.trim() } : {}),
    state: "needs-recording",
    provenance: { source: "manual" },
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
          ...(capture?.takeId ? { provenance: { source: "recording" as const } } : {}),
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
  review: Pick<JourneyTransitionReview, "status" | "error" | "targets">,
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
            ...(review.targets ? { targets: structuredClone(review.targets) } : {}),
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
        x: depth * 304,
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
