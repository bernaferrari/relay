import type {
  EvidenceEvent,
  FailureCategory,
  CanvasGraph,
  CanvasScreen,
  CanvasTransition,
  RecipeStep,
} from "@relay/protocol";
import type { JobInfo, TraceStep } from "./api-types";

export type AppMapRunPresentationState =
  | "idle"
  | "running"
  | "passed"
  | "healed"
  | "failed"
  | "blocked"
  | "unknown";

export type AppMapRunMappingState = "mapped" | "partial" | "unmapped";

export type AppMapRunProjectionIssueCode =
  | "graph-step-missing-from-recipe"
  | "graph-step-ambiguous-in-recipe"
  | "graph-step-shared-by-transitions"
  | "recipe-step-missing-id"
  | "recipe-step-not-in-graph"
  | "job-recipe-mismatch"
  | "trace-index-duplicated"
  | "trace-step-without-recipe"
  | "trace-step-not-in-graph"
  | "transition-has-no-steps"
  | "transition-step-order-mismatch"
  | "transition-steps-noncontiguous"
  | "traversal-disconnected";

export type AppMapRunProjectionIssue = {
  code: AppMapRunProjectionIssueCode;
  message: string;
  transitionId?: string;
  recipeStepId?: string;
  recipeIndex?: number;
  traceStepId?: string;
  traceIndex?: number;
};

export type AppMapRunEvidenceScope = "before" | "after" | "step" | "unknown";

export type AppMapRunEvidenceReference =
  | {
      kind: "frame";
      scope: AppMapRunEvidenceScope;
      recipeStepId: string;
      traceStepId: string;
      path: string;
      caption: string;
      capturedAt: number;
    }
  | {
      kind: "event";
      scope: AppMapRunEvidenceScope;
      recipeStepId: string;
      traceStepId: string;
      sequence: number;
      channel: EvidenceEvent["channel"];
      eventKind: string;
      at: number;
      artifact?: string;
    }
  | {
      kind: "artifact";
      scope: AppMapRunEvidenceScope;
      recipeStepId: string;
      traceStepId: string;
      index: number;
      artifactKind: string;
      capturedAt: number;
    };

export type AppMapRunTiming = {
  completeness: "complete" | "partial" | "unknown";
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
};

export type AppMapRunFailureReference = {
  recipeStepId: string;
  traceStepId: string;
  message?: string;
  category?: FailureCategory;
};

export type AppMapRunStepReference = {
  recipeStepId: string;
  recipeIndex: number;
  traceStepId?: string;
  traceIndex?: number;
  state: AppMapRunPresentationState;
};

export type AppMapRunTransitionProjection = {
  transitionId: string;
  state: AppMapRunPresentationState;
  mapping: AppMapRunMappingState;
  traversalOrder?: number;
  stepReferences: AppMapRunStepReference[];
  timing: AppMapRunTiming;
  evidence: AppMapRunEvidenceReference[];
  failure?: AppMapRunFailureReference;
  issues: AppMapRunProjectionIssue[];
};

export type AppMapRunScreenVisit = {
  order: number;
  transitionId: string;
  role: "source" | "destination";
  state: AppMapRunPresentationState;
};

export type AppMapRunScreenProjection = {
  screenId: string;
  state: AppMapRunPresentationState;
  visits: AppMapRunScreenVisit[];
  evidence: AppMapRunEvidenceReference[];
};

export type AppMapRunTraversalEntry = {
  order: number;
  transitionId: string;
  fromScreenId: string;
  toScreenId?: string;
  recipeStepIds: string[];
  recipeIndexes: number[];
  state: AppMapRunPresentationState;
  connectedFromPrevious: boolean | null;
};

export type AppMapRunProjection = {
  transitions: Record<string, AppMapRunTransitionProjection>;
  screens: Record<string, AppMapRunScreenProjection>;
  traversal: AppMapRunTraversalEntry[];
  activeTraversalOrder?: number;
  unmapped: {
    graphStepReferences: AppMapRunProjectionIssue[];
    recipeSteps: AppMapRunProjectionIssue[];
    traceSteps: AppMapRunProjectionIssue[];
  };
  issues: AppMapRunProjectionIssue[];
};

export type AppMapRunProjectionInput = {
  graph: CanvasGraph;
  recipeSteps: RecipeStep[];
  job?: JobInfo | null;
};

type IndexedRecipeStep = { id: string; index: number; step: RecipeStep };

type IndexedTraceStep = {
  recipeStepId: string;
  recipeIndex: number;
  trace: TraceStep;
};

type TransitionWork = {
  transition: CanvasTransition;
  recipeSteps: IndexedRecipeStep[];
  traces: IndexedTraceStep[];
  issues: AppMapRunProjectionIssue[];
  structurallyMapped: boolean;
};

function issue(
  code: AppMapRunProjectionIssueCode,
  message: string,
  details: Omit<AppMapRunProjectionIssue, "code" | "message"> = {},
): AppMapRunProjectionIssue {
  return { code, message, ...details };
}

function evidenceScope(value: string): AppMapRunEvidenceScope {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("before") || normalized.endsWith(".before")) return "before";
  if (normalized.startsWith("after") || normalized.endsWith(".after")) return "after";
  return "unknown";
}

function traceState(trace: TraceStep): AppMapRunPresentationState {
  if (trace.status === "error" || trace.tone === "fail" || trace.tone === "danger") {
    return "failed";
  }
  if (trace.status === "healed" || Boolean(trace.heal)) return "healed";
  if (trace.status === "running" && trace.finishedAt === undefined) return "running";
  if (trace.status === "ok" || trace.finishedAt !== undefined) return "passed";
  return "unknown";
}

function isTerminalJob(job: JobInfo | null | undefined): boolean {
  return Boolean(job && ["ok", "error", "healed", "cancelled"].includes(job.status));
}

function timingFor(
  traces: IndexedTraceStep[],
  expectedCount: number,
  terminal: boolean,
): AppMapRunTiming {
  if (traces.length === 0) return { completeness: "unknown" };

  const startedAt = Math.min(...traces.map(({ trace }) => trace.startedAt));
  const finished = traces
    .map(({ trace }) => trace.finishedAt)
    .filter((value): value is number => value !== undefined);
  const durations = traces.map(({ trace }) =>
    trace.durationMs !== undefined
      ? Math.max(0, trace.durationMs)
      : trace.finishedAt !== undefined
        ? Math.max(0, trace.finishedAt - trace.startedAt)
        : undefined,
  );
  const allDurationsKnown = durations.every((value) => value !== undefined);
  const allFinished = finished.length === traces.length;
  const complete = traces.length === expectedCount && (allFinished || terminal);

  return {
    completeness: complete ? "complete" : "partial",
    startedAt,
    ...(allFinished ? { finishedAt: Math.max(...finished) } : {}),
    ...(allDurationsKnown
      ? { durationMs: durations.reduce<number>((sum, value) => sum + (value ?? 0), 0) }
      : {}),
  };
}

function evidenceForTrace(
  job: JobInfo | null | undefined,
  item: IndexedTraceStep,
): AppMapRunEvidenceReference[] {
  const references: AppMapRunEvidenceReference[] = item.trace.frames.map((frame) => ({
    kind: "frame",
    scope: evidenceScope(frame.caption),
    recipeStepId: item.recipeStepId,
    traceStepId: item.trace.id,
    path: frame.path,
    caption: frame.caption,
    capturedAt: frame.capturedAt,
  }));

  for (const event of job?.evidence?.events ?? []) {
    if (event.stepId !== item.trace.id) continue;
    references.push({
      kind: "event",
      scope: evidenceScope(event.kind),
      recipeStepId: item.recipeStepId,
      traceStepId: item.trace.id,
      sequence: event.sequence,
      channel: event.channel,
      eventKind: event.kind,
      at: event.at,
      ...(event.artifact ? { artifact: event.artifact } : {}),
    });
  }

  for (const [index, artifact] of (job?.artifacts ?? []).entries()) {
    if (!artifact.data || typeof artifact.data !== "object") continue;
    const data = artifact.data as { stepId?: unknown; phase?: unknown };
    if (data.stepId !== item.trace.id) continue;
    references.push({
      kind: "artifact",
      scope: typeof data.phase === "string" ? evidenceScope(data.phase) : "unknown",
      recipeStepId: item.recipeStepId,
      traceStepId: item.trace.id,
      index,
      artifactKind: artifact.kind,
      capturedAt: artifact.capturedAt,
    });
  }

  return references;
}

function transitionState(
  work: TransitionWork,
  job: JobInfo | null | undefined,
  failedRecipeIndex: number | undefined,
): AppMapRunPresentationState {
  if (work.transition.state === "needs-recording") return "blocked";
  if (!work.structurallyMapped || work.recipeSteps.length === 0) return "unknown";
  if (!job || job.status === "queued") return "idle";

  const states = work.traces.map(({ trace }) => traceState(trace));
  if (states.includes("failed")) return "failed";

  const lastTrace = work.traces.at(-1)?.trace;
  if (
    job.status === "paused" &&
    lastTrace &&
    lastTrace.index === (job.steps?.at(-1)?.index ?? -1)
  ) {
    return "blocked";
  }
  if (states.includes("running")) return "running";

  const observedAll = work.traces.length === work.recipeSteps.length;
  if (observedAll && states.every((state) => state === "passed" || state === "healed")) {
    return states.includes("healed") ? "healed" : "passed";
  }

  if (work.traces.length > 0 && (job.status === "running" || job.status === "paused")) {
    return job.status === "paused" ? "blocked" : "running";
  }

  const firstIndex = work.recipeSteps[0]?.index;
  if (
    failedRecipeIndex !== undefined &&
    firstIndex !== undefined &&
    failedRecipeIndex < firstIndex
  ) {
    return "blocked";
  }
  if (job.status === "cancelled" && !observedAll) return "blocked";
  if (isTerminalJob(job) && !observedAll) return "unknown";
  return "idle";
}

function aggregateScreenState(states: AppMapRunPresentationState[]): AppMapRunPresentationState {
  const priority: AppMapRunPresentationState[] = [
    "failed",
    "blocked",
    "running",
    "healed",
    "passed",
    "unknown",
    "idle",
  ];
  return priority.find((state) => states.includes(state)) ?? "idle";
}

function destinationScreenId(transition: CanvasTransition): string | undefined {
  return transition.destination.kind === "screen" ? transition.destination.screenId : undefined;
}

function screenProjection(screen: CanvasScreen): AppMapRunScreenProjection {
  return { screenId: screen.id, state: "idle", visits: [], evidence: [] };
}

/**
 * Project an ordered recipe run onto its authored App Map without
 * inventing attribution. Runtime trace UUIDs are joined to graph step IDs only
 * through their explicit recipe index. Any missing, duplicated, or conflicting
 * link is returned in `unmapped` and leaves the affected graph state unknown.
 */
export function projectAppMapRun(input: AppMapRunProjectionInput): AppMapRunProjection {
  const { graph, recipeSteps, job } = input;
  const allIssues: AppMapRunProjectionIssue[] = [];
  const graphStepReferences: AppMapRunProjectionIssue[] = [];
  const unmappedRecipeSteps: AppMapRunProjectionIssue[] = [];
  const unmappedTraceSteps: AppMapRunProjectionIssue[] = [];

  const recipeById = new Map<string, IndexedRecipeStep[]>();
  recipeSteps.forEach((step, index) => {
    const id = step.id?.trim();
    if (!id) {
      const missing = issue("recipe-step-missing-id", `Recipe step ${index} has no stable id.`, {
        recipeIndex: index,
      });
      unmappedRecipeSteps.push(missing);
      allIssues.push(missing);
      return;
    }
    const indexed = { id, index, step };
    recipeById.set(id, [...(recipeById.get(id) ?? []), indexed]);
  });

  const ownersByStepId = new Map<string, string[]>();
  for (const transition of graph.transitions) {
    for (const stepId of transition.stepIds) {
      ownersByStepId.set(stepId, [...(ownersByStepId.get(stepId) ?? []), transition.id]);
    }
  }

  const unsafeRecipeIndexes = new Set<number>();
  const snapshotSteps = job?.recipeSnapshot?.steps;
  if (snapshotSteps) {
    const count = Math.max(recipeSteps.length, snapshotSteps.length);
    for (let index = 0; index < count; index += 1) {
      const supplied = recipeSteps[index];
      const frozen = snapshotSteps[index];
      if (supplied?.id === frozen?.id && supplied?.kind === frozen?.kind) continue;
      unsafeRecipeIndexes.add(index);
      const mismatch = issue(
        "job-recipe-mismatch",
        `Run snapshot and supplied recipe disagree at step ${index}.`,
        { recipeIndex: index, ...(supplied?.id ? { recipeStepId: supplied.id } : {}) },
      );
      allIssues.push(mismatch);
      unmappedRecipeSteps.push(mismatch);
    }
  }

  const traceByIndex = new Map<number, TraceStep>();
  for (const trace of job?.steps ?? []) {
    if (!Number.isInteger(trace.index) || trace.index < 0 || trace.index >= recipeSteps.length) {
      const missing = issue(
        "trace-step-without-recipe",
        `Trace step ${trace.id} points to recipe index ${trace.index}, which does not exist.`,
        { traceStepId: trace.id, traceIndex: trace.index },
      );
      unmappedTraceSteps.push(missing);
      allIssues.push(missing);
      continue;
    }
    const existing = traceByIndex.get(trace.index);
    if (existing) {
      traceByIndex.delete(trace.index);
      unsafeRecipeIndexes.add(trace.index);
      for (const duplicate of [existing, trace]) {
        const duplicated = issue(
          "trace-index-duplicated",
          `Multiple trace steps claim recipe index ${trace.index}.`,
          { traceStepId: duplicate.id, traceIndex: trace.index, recipeIndex: trace.index },
        );
        unmappedTraceSteps.push(duplicated);
        allIssues.push(duplicated);
      }
      continue;
    }
    traceByIndex.set(trace.index, trace);
  }

  const works = new Map<string, TransitionWork>();
  for (const transition of graph.transitions) {
    const transitionIssues: AppMapRunProjectionIssue[] = [];
    const indexedSteps: IndexedRecipeStep[] = [];

    if (transition.stepIds.length === 0) {
      transitionIssues.push(
        issue(
          "transition-has-no-steps",
          `Transition ${transition.id} has no recipe steps and cannot be attributed to this run.`,
          { transitionId: transition.id },
        ),
      );
    }

    for (const stepId of transition.stepIds) {
      const matches = recipeById.get(stepId) ?? [];
      if (matches.length === 0) {
        transitionIssues.push(
          issue(
            "graph-step-missing-from-recipe",
            `Graph step ${stepId} does not exist in the supplied recipe.`,
            { transitionId: transition.id, recipeStepId: stepId },
          ),
        );
        continue;
      }
      if (matches.length > 1) {
        transitionIssues.push(
          issue(
            "graph-step-ambiguous-in-recipe",
            `Graph step ${stepId} is duplicated in the supplied recipe.`,
            { transitionId: transition.id, recipeStepId: stepId },
          ),
        );
        continue;
      }
      const owners = ownersByStepId.get(stepId) ?? [];
      if (owners.length > 1) {
        transitionIssues.push(
          issue(
            "graph-step-shared-by-transitions",
            `Graph step ${stepId} is owned by more than one transition.`,
            { transitionId: transition.id, recipeStepId: stepId },
          ),
        );
        continue;
      }
      const match = matches[0]!;
      if (unsafeRecipeIndexes.has(match.index)) continue;
      indexedSteps.push(match);
    }

    const indexes = indexedSteps.map(({ index }) => index);
    if (indexes.some((value, index) => index > 0 && value <= indexes[index - 1]!)) {
      transitionIssues.push(
        issue(
          "transition-step-order-mismatch",
          `Transition ${transition.id} step order disagrees with recipe order.`,
          { transitionId: transition.id },
        ),
      );
    }
    if (indexes.some((value, index) => index > 0 && value !== indexes[index - 1]! + 1)) {
      transitionIssues.push(
        issue(
          "transition-steps-noncontiguous",
          `Transition ${transition.id} steps are not contiguous in the recipe.`,
          { transitionId: transition.id },
        ),
      );
    }

    const invalidCodes: AppMapRunProjectionIssueCode[] = [
      "transition-has-no-steps",
      "graph-step-missing-from-recipe",
      "graph-step-ambiguous-in-recipe",
      "graph-step-shared-by-transitions",
      "transition-step-order-mismatch",
      "transition-steps-noncontiguous",
    ];
    const structurallyMapped =
      indexedSteps.length === transition.stepIds.length &&
      !transitionIssues.some(({ code }) => invalidCodes.includes(code));
    const traces = structurallyMapped
      ? indexedSteps.flatMap((step) => {
          const trace = traceByIndex.get(step.index);
          return trace ? [{ recipeStepId: step.id, recipeIndex: step.index, trace }] : [];
        })
      : [];

    works.set(transition.id, {
      transition,
      recipeSteps: indexedSteps,
      traces,
      issues: transitionIssues,
      structurallyMapped,
    });
    graphStepReferences.push(...transitionIssues);
    allIssues.push(...transitionIssues);
  }

  for (const [id, entries] of recipeById) {
    for (const entry of entries) {
      const owners = ownersByStepId.get(id) ?? [];
      if (owners.length === 1 && !unsafeRecipeIndexes.has(entry.index)) continue;
      const code: AppMapRunProjectionIssueCode =
        owners.length === 0 ? "recipe-step-not-in-graph" : "graph-step-shared-by-transitions";
      const unmapped = issue(
        code,
        owners.length === 0
          ? `Recipe step ${id} is not owned by a graph transition.`
          : `Recipe step ${id} is owned by more than one graph transition.`,
        { recipeStepId: id, recipeIndex: entry.index },
      );
      unmappedRecipeSteps.push(unmapped);
      allIssues.push(unmapped);
    }
  }

  for (const [traceIndex, trace] of traceByIndex) {
    const step = recipeSteps[traceIndex];
    const id = step?.id?.trim();
    const owners = id ? (ownersByStepId.get(id) ?? []) : [];
    if (id && owners.length === 1 && !unsafeRecipeIndexes.has(traceIndex)) continue;
    const unmapped = issue(
      owners.length === 0 ? "trace-step-not-in-graph" : "trace-step-without-recipe",
      id
        ? `Trace step ${trace.id} maps to recipe step ${id}, which has no unique graph owner.`
        : `Trace step ${trace.id} has no stable recipe step id.`,
      {
        traceStepId: trace.id,
        traceIndex,
        recipeIndex: traceIndex,
        ...(id ? { recipeStepId: id } : {}),
      },
    );
    unmappedTraceSteps.push(unmapped);
    allIssues.push(unmapped);
  }

  const failedRecipeIndex = [...traceByIndex.entries()]
    .filter(([, trace]) => traceState(trace) === "failed")
    .map(([index]) => index)
    .sort((a, b) => a - b)[0];

  const executableWorks = [...works.values()]
    .filter((work) => work.structurallyMapped && work.recipeSteps.length > 0)
    .sort((a, b) => a.recipeSteps[0]!.index - b.recipeSteps[0]!.index);

  const traversal: AppMapRunTraversalEntry[] = executableWorks.map((work, order) => {
    const previous = executableWorks[order - 1];
    const previousDestination = previous ? destinationScreenId(previous.transition) : undefined;
    const connectedFromPrevious = previous
      ? previousDestination === work.transition.fromScreenId
      : null;
    if (connectedFromPrevious === false) {
      const disconnected = issue(
        "traversal-disconnected",
        `Transition ${work.transition.id} does not continue from the previous recipe transition.`,
        { transitionId: work.transition.id },
      );
      work.issues.push(disconnected);
      allIssues.push(disconnected);
    }
    return {
      order,
      transitionId: work.transition.id,
      fromScreenId: work.transition.fromScreenId,
      ...(destinationScreenId(work.transition)
        ? { toScreenId: destinationScreenId(work.transition) }
        : {}),
      recipeStepIds: work.recipeSteps.map(({ id }) => id),
      recipeIndexes: work.recipeSteps.map(({ index }) => index),
      state: transitionState(work, job, failedRecipeIndex),
      connectedFromPrevious,
    };
  });

  const orderByTransition = new Map(traversal.map((entry) => [entry.transitionId, entry.order]));
  const transitions: Record<string, AppMapRunTransitionProjection> = {};
  for (const work of works.values()) {
    const state = transitionState(work, job, failedRecipeIndex);
    const evidence = work.traces.flatMap((trace) => evidenceForTrace(job, trace));
    const failed = work.traces.find(({ trace }) => traceState(trace) === "failed");
    const mapping: AppMapRunMappingState = work.structurallyMapped
      ? "mapped"
      : work.recipeSteps.length > 0
        ? "partial"
        : "unmapped";
    transitions[work.transition.id] = {
      transitionId: work.transition.id,
      state,
      mapping,
      ...(orderByTransition.has(work.transition.id)
        ? { traversalOrder: orderByTransition.get(work.transition.id) }
        : {}),
      stepReferences: work.recipeSteps.map((step) => {
        const trace = traceByIndex.get(step.index);
        return {
          recipeStepId: step.id,
          recipeIndex: step.index,
          ...(trace ? { traceStepId: trace.id, traceIndex: trace.index } : {}),
          state: trace ? traceState(trace) : "idle",
        };
      }),
      timing: timingFor(work.traces, work.recipeSteps.length, isTerminalJob(job)),
      evidence,
      ...(failed
        ? {
            failure: {
              recipeStepId: failed.recipeStepId,
              traceStepId: failed.trace.id,
              ...(job?.error || failed.trace.log
                ? { message: job?.error ?? failed.trace.log }
                : {}),
              ...(job?.failureCategory ? { category: job.failureCategory } : {}),
            },
          }
        : {}),
      issues: work.issues,
    };
  }

  const screens: Record<string, AppMapRunScreenProjection> = Object.fromEntries(
    graph.screens.map((screen) => [screen.id, screenProjection(screen)]),
  );
  let visitOrder = 0;
  for (const entry of traversal) {
    const transition = transitions[entry.transitionId]!;
    const source = screens[entry.fromScreenId];
    const hasObservation = transition.stepReferences.some(({ traceStepId }) => traceStepId);
    if (source) {
      const sourceState: AppMapRunPresentationState = hasObservation ? "passed" : "idle";
      source.visits.push({
        order: visitOrder++,
        transitionId: entry.transitionId,
        role: "source",
        state: sourceState,
      });
      source.evidence.push(...transition.evidence.filter(({ scope }) => scope === "before"));
    }

    if (!entry.toScreenId) continue;
    const destination = screens[entry.toScreenId];
    if (!destination) continue;
    const destinationState: AppMapRunPresentationState =
      transition.state === "failed" || transition.state === "blocked"
        ? "blocked"
        : transition.state;
    destination.visits.push({
      order: visitOrder++,
      transitionId: entry.transitionId,
      role: "destination",
      state: destinationState,
    });
    destination.evidence.push(...transition.evidence.filter(({ scope }) => scope === "after"));
  }

  for (const screen of Object.values(screens)) {
    screen.state = aggregateScreenState(screen.visits.map(({ state }) => state));
  }

  const active = traversal.find(
    ({ state }) => state === "running" || (job?.status === "paused" && state === "blocked"),
  );
  return {
    transitions,
    screens,
    traversal,
    ...(active ? { activeTraversalOrder: active.order } : {}),
    unmapped: {
      graphStepReferences,
      recipeSteps: unmappedRecipeSteps,
      traceSteps: unmappedTraceSteps,
    },
    issues: allIssues,
  };
}
