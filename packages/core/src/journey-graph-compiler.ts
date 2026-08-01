import type {
  JourneyGraph,
  JourneyGraphDestination,
  JourneyGraphFlow,
  JourneyGraphTransition,
  RecipeStep,
} from "@relay/protocol";

const DEFAULT_MAX_TRANSITIONS = 1_000;

export type JourneyGraphCompileErrorCode =
  | "invalid-graph"
  | "ambiguous-flow"
  | "missing-flow"
  | "missing-transition"
  | "discontinuous-path"
  | "ambiguous-branch"
  | "implicit-cycle"
  | "path-too-long"
  | "needs-recording"
  | "unverified-transition"
  | "missing-step"
  | "ambiguous-step";

export class JourneyGraphCompileError extends Error {
  readonly code: JourneyGraphCompileErrorCode;

  constructor(code: JourneyGraphCompileErrorCode, message: string) {
    super(message);
    this.name = "JourneyGraphCompileError";
    this.code = code;
  }
}

export type JourneyGraphCompileInput = {
  graph: JourneyGraph;
  /** Flow names are human-facing and therefore selected by name, not by id. */
  flowName: string;
  recipeSteps: readonly RecipeStep[];
  /**
   * A finite, ordered list of transition ids. When omitted, the compiler may
   * infer a path only while every visited screen has at most one outgoing edge.
   * An empty list deliberately compiles the flow's start screen and no edges.
   */
  transitionPath?: readonly string[];
  /** Safety bound for both explicit and inferred paths. */
  maxTransitions?: number;
};

export type JourneyGraphStepProvenance = {
  compiledStepIndex: number;
  transitionPathIndex: number;
  transitionStepIndex: number;
  stepId: string;
  transitionId: string;
  fromScreenId: string;
  destination: JourneyGraphDestination;
};

export type JourneyGraphTransitionProvenance = {
  transitionPathIndex: number;
  transitionId: string;
  fromScreenId: string;
  destination: JourneyGraphDestination;
  /** Half-open range into `steps`: [start, end). Empty edges have equal values. */
  compiledStepRange: readonly [start: number, end: number];
};

export type CompiledJourneyGraph = {
  flow: {
    id: string;
    name: string;
    startScreenId: string;
  };
  transitionIds: string[];
  /** Compatibility output consumed by the existing recipe runner. */
  steps: RecipeStep[];
  stepProvenance: JourneyGraphStepProvenance[];
  transitionProvenance: JourneyGraphTransitionProvenance[];
  terminal: JourneyGraphDestination;
};

type GraphIndex = {
  flowByName: Map<string, JourneyGraphFlow>;
  transitionById: Map<string, JourneyGraphTransition>;
  outgoingByScreenId: Map<string, JourneyGraphTransition[]>;
};

function fail(code: JourneyGraphCompileErrorCode, message: string): never {
  throw new JourneyGraphCompileError(code, message);
}

function requireNonEmptyId(value: string, description: string): void {
  if (!value.trim()) fail("invalid-graph", `${description} must have a non-empty id`);
}

function requireUniqueId(id: string, seen: Set<string>, description: string): void {
  requireNonEmptyId(id, description);
  if (seen.has(id)) fail("invalid-graph", `${description} id "${id}" is duplicated`);
  seen.add(id);
}

/**
 * Validates the graph's structural integrity and returns deterministic lookup
 * indexes. Recipe step references are checked only for the selected path, so a
 * draft on an unrelated branch cannot prevent a valid flow from compiling.
 */
export function validateJourneyGraphIntegrity(graph: JourneyGraph): GraphIndex {
  if (graph.schemaVersion !== 1) {
    fail(
      "invalid-graph",
      `Unsupported journey graph schema version ${String(graph.schemaVersion)}`,
    );
  }

  const screenIds = new Set<string>();
  for (const screen of graph.screens) requireUniqueId(screen.id, screenIds, "Screen");

  const flowIds = new Set<string>();
  const flowByName = new Map<string, JourneyGraphFlow>();
  for (const flow of graph.flows) {
    requireUniqueId(flow.id, flowIds, "Flow");
    if (!flow.name.trim()) fail("invalid-graph", `Flow "${flow.id}" must have a non-empty name`);
    if (!screenIds.has(flow.screenId)) {
      fail("invalid-graph", `Flow "${flow.name}" starts at missing screen "${flow.screenId}"`);
    }
    if (flowByName.has(flow.name)) {
      fail("ambiguous-flow", `More than one flow is named "${flow.name}"`);
    }
    flowByName.set(flow.name, flow);
  }

  const transitionIds = new Set<string>();
  const transitionById = new Map<string, JourneyGraphTransition>();
  const outgoingByScreenId = new Map<string, JourneyGraphTransition[]>();
  for (const transition of graph.transitions) {
    requireUniqueId(transition.id, transitionIds, "Transition");
    if (!screenIds.has(transition.fromScreenId)) {
      fail(
        "invalid-graph",
        `Transition "${transition.id}" starts at missing screen "${transition.fromScreenId}"`,
      );
    }
    if (
      transition.destination.kind === "screen" &&
      !screenIds.has(transition.destination.screenId)
    ) {
      fail(
        "invalid-graph",
        `Transition "${transition.id}" ends at missing screen "${transition.destination.screenId}"`,
      );
    }
    for (const stepId of transition.stepIds) {
      if (!stepId.trim()) {
        fail("invalid-graph", `Transition "${transition.id}" contains an empty step id`);
      }
    }
    transitionById.set(transition.id, transition);
    const outgoing = outgoingByScreenId.get(transition.fromScreenId) ?? [];
    outgoing.push(transition);
    outgoingByScreenId.set(transition.fromScreenId, outgoing);
  }

  return { flowByName, transitionById, outgoingByScreenId };
}

function transitionLimit(input: JourneyGraphCompileInput): number {
  const limit = input.maxTransitions ?? DEFAULT_MAX_TRANSITIONS;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    fail("path-too-long", "maxTransitions must be a non-negative safe integer");
  }
  return limit;
}

function explicitPath(
  ids: readonly string[],
  startScreenId: string,
  index: GraphIndex,
  maxTransitions: number,
): JourneyGraphTransition[] {
  if (ids.length > maxTransitions) {
    fail(
      "path-too-long",
      `Explicit path has ${ids.length} transitions; the limit is ${maxTransitions}`,
    );
  }

  const path: JourneyGraphTransition[] = [];
  let current: JourneyGraphDestination = { kind: "screen", screenId: startScreenId };
  for (let pathIndex = 0; pathIndex < ids.length; pathIndex += 1) {
    const transitionId = ids[pathIndex]!;
    const transition = index.transitionById.get(transitionId);
    if (!transition) fail("missing-transition", `Transition "${transitionId}" does not exist`);
    if (current.kind === "end") {
      fail(
        "discontinuous-path",
        `Transition "${transitionId}" appears after the path already reached its end`,
      );
    }
    if (transition.fromScreenId !== current.screenId) {
      fail(
        "discontinuous-path",
        `Transition "${transitionId}" starts at screen "${transition.fromScreenId}", expected "${current.screenId}"`,
      );
    }
    path.push(transition);
    current = transition.destination;
  }
  return path;
}

function inferredPath(
  startScreenId: string,
  index: GraphIndex,
  maxTransitions: number,
): JourneyGraphTransition[] {
  const path: JourneyGraphTransition[] = [];
  const visitedTransitionIds = new Set<string>();
  let currentScreenId = startScreenId;

  while (true) {
    const outgoing = index.outgoingByScreenId.get(currentScreenId) ?? [];
    if (outgoing.length === 0) return path;
    if (outgoing.length > 1) {
      fail(
        "ambiguous-branch",
        `Screen "${currentScreenId}" has ${outgoing.length} outgoing transitions; provide an explicit transitionPath`,
      );
    }
    if (path.length >= maxTransitions) {
      fail("path-too-long", `Inferred path exceeds the limit of ${maxTransitions} transitions`);
    }

    const transition = outgoing[0]!;
    if (visitedTransitionIds.has(transition.id)) {
      fail(
        "implicit-cycle",
        `Inferred path repeats transition "${transition.id}"; provide a finite explicit transitionPath`,
      );
    }
    visitedTransitionIds.add(transition.id);
    path.push(transition);
    if (transition.destination.kind === "end") return path;
    currentScreenId = transition.destination.screenId;
  }
}

function recipeStepIndex(recipeSteps: readonly RecipeStep[]): Map<string, RecipeStep> {
  const byId = new Map<string, RecipeStep>();
  for (const step of recipeSteps) {
    if (!step.id) continue;
    if (byId.has(step.id)) {
      fail("ambiguous-step", `Recipe step id "${step.id}" is duplicated`);
    }
    byId.set(step.id, step);
  }
  return byId;
}

function assertExecutable(transition: JourneyGraphTransition): void {
  if (transition.state === "needs-recording") {
    fail("needs-recording", `Transition "${transition.id}" still needs recording`);
  }
  if (transition.review?.status !== "verified") {
    fail("unverified-transition", `Transition "${transition.id}" has not been verified`);
  }
}

/**
 * Compiles a named graph flow into the ordered RecipeStep[] expected by the
 * existing runner. The operation is pure: it neither mutates nor normalizes the
 * graph or recipe collection supplied by the caller.
 */
export function compileJourneyGraph(input: JourneyGraphCompileInput): CompiledJourneyGraph {
  const index = validateJourneyGraphIntegrity(input.graph);
  const flow = index.flowByName.get(input.flowName);
  if (!flow) fail("missing-flow", `Flow "${input.flowName}" does not exist`);

  const maxTransitions = transitionLimit(input);
  const transitions =
    input.transitionPath === undefined
      ? inferredPath(flow.screenId, index, maxTransitions)
      : explicitPath(input.transitionPath, flow.screenId, index, maxTransitions);
  const stepsById = recipeStepIndex(input.recipeSteps);
  const steps: RecipeStep[] = [];
  const stepProvenance: JourneyGraphStepProvenance[] = [];
  const transitionProvenance: JourneyGraphTransitionProvenance[] = [];

  for (
    let transitionPathIndex = 0;
    transitionPathIndex < transitions.length;
    transitionPathIndex += 1
  ) {
    const transition = transitions[transitionPathIndex]!;
    assertExecutable(transition);
    const rangeStart = steps.length;
    for (
      let transitionStepIndex = 0;
      transitionStepIndex < transition.stepIds.length;
      transitionStepIndex += 1
    ) {
      const stepId = transition.stepIds[transitionStepIndex]!;
      const step = stepsById.get(stepId);
      if (!step) {
        fail(
          "missing-step",
          `Transition "${transition.id}" references missing recipe step "${stepId}"`,
        );
      }
      const compiledStepIndex = steps.length;
      steps.push(step);
      stepProvenance.push({
        compiledStepIndex,
        transitionPathIndex,
        transitionStepIndex,
        stepId,
        transitionId: transition.id,
        fromScreenId: transition.fromScreenId,
        destination: { ...transition.destination },
      });
    }
    transitionProvenance.push({
      transitionPathIndex,
      transitionId: transition.id,
      fromScreenId: transition.fromScreenId,
      destination: { ...transition.destination },
      compiledStepRange: [rangeStart, steps.length],
    });
  }

  const lastTransition = transitions.at(-1);
  const terminal = lastTransition?.destination ?? { kind: "screen", screenId: flow.screenId };
  return {
    flow: { id: flow.id, name: flow.name, startScreenId: flow.screenId },
    transitionIds: transitions.map((transition) => transition.id),
    steps,
    stepProvenance,
    transitionProvenance,
    terminal: { ...terminal },
  };
}
