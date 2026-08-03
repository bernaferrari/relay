import type {
  ActionSpec,
  AppMap,
  Connection,
  ConnectionPatch,
  Flow,
  CanvasGraph,
  AppMapCanvasState,
  RecipeStep,
  Screen,
} from "@relay/protocol";

export type AppMapProjectionChange =
  | { kind: "screen.add"; screen: Screen }
  | {
      kind: "screen.update";
      screenId: string;
      patch: { title?: string; position?: { x: number; y: number } };
    }
  | { kind: "connection.create"; connection: Connection }
  | {
      kind: "connection.update";
      connectionId: string;
      patch: ConnectionPatch;
    }
  | { kind: "flow.save"; flow: Flow };

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function flowPath(graph: CanvasGraph, startScreenId: string): string[] {
  const connectionIds: string[] = [];
  const visited = new Set<string>();
  let screenId: string | undefined = startScreenId;
  while (screenId && !visited.has(screenId)) {
    visited.add(screenId);
    const outgoing = graph.transitions.filter((transition) => transition.fromScreenId === screenId);
    if (outgoing.length !== 1) break;
    const transition = outgoing[0]!;
    connectionIds.push(transition.id);
    screenId =
      transition.destination.kind === "screen" ? transition.destination.screenId : undefined;
  }
  return connectionIds;
}

function transitionActions(
  transition: CanvasGraph["transitions"][number],
  stepsById: ReadonlyMap<string, RecipeStep>,
): ActionSpec[] {
  const steps = transition.stepIds.flatMap((id) => {
    const step = stepsById.get(id);
    return step ? [structuredClone(step)] : [];
  });
  if (steps.length) {
    return [
      {
        id: `recorded:${transition.id}`,
        kind: "recorded",
        takeId: transition.takeId ?? transition.id,
        takeRevision: 1,
        steps,
        evidenceIds: [...(transition.evidenceIds ?? [])],
      },
    ];
  }
  if (transition.mode === "automatic" || transition.state === "recorded") {
    return [
      {
        id: `passive:${transition.id}`,
        kind: "passive",
        reason: transition.mode === "automatic" ? "automatic" : "observe-only",
      },
    ];
  }
  return [];
}

/**
 * Produces granular canonical operations from the current canvas projection.
 * Deletions intentionally require an explicit UI operation; synchronization
 * never erases an entity an agent or collaborator may have added concurrently.
 */
export function planAppMapProjection(input: {
  appMap: AppMap;
  graph: CanvasGraph;
  positions: Readonly<Record<string, { x: number; y: number }>>;
  recipeSteps: readonly RecipeStep[];
}): AppMapProjectionChange[] {
  const { appMap, graph, positions } = input;
  const changes: AppMapProjectionChange[] = [];
  const stepsById = new Map(
    input.recipeSteps.flatMap((step) => (step.id ? [[step.id, step] as const] : [])),
  );
  const scope = {
    organizationId: appMap.organizationId,
    projectId: appMap.projectId,
    appMapId: appMap.id,
  };

  for (const item of graph.screens) {
    const position = positions[item.id];
    const existing = appMap.screens[item.id];
    if (!existing) {
      changes.push({
        kind: "screen.add",
        screen: {
          ...scope,
          id: item.id,
          title: item.title,
          ...(item.identity ? { identity: structuredClone(item.identity) } : {}),
          ...(position ? { position: structuredClone(position) } : {}),
          variantIds: [],
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        },
      });
      continue;
    }
    const patch = {
      ...(existing.title !== item.title ? { title: item.title } : {}),
      ...(!same(existing.position, position) && position
        ? { position: structuredClone(position) }
        : {}),
    };
    if (Object.keys(patch).length)
      changes.push({ kind: "screen.update", screenId: item.id, patch });
  }

  for (const item of graph.transitions) {
    const actions = transitionActions(item, stepsById);
    const value = {
      fromScreenId: item.fromScreenId,
      destination: structuredClone(item.destination),
      ...(item.label ? { label: item.label } : {}),
      state: item.state === "recorded" ? ("ready" as const) : ("draft" as const),
      actions,
    };
    const existing = appMap.connections[item.id];
    if (!existing) {
      changes.push({
        kind: "connection.create",
        connection: {
          ...scope,
          id: item.id,
          ...value,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        },
      });
    } else if (
      !same(
        {
          fromScreenId: existing.fromScreenId,
          destination: existing.destination,
          ...(existing.label ? { label: existing.label } : {}),
          state: existing.state,
          actions: existing.actions,
        },
        value,
      )
    ) {
      changes.push({
        kind: "connection.update",
        connectionId: item.id,
        patch: { ...value, ...(!item.label && existing.label ? { label: null } : {}) },
      });
    }
  }

  for (const item of graph.flows) {
    const flow: Flow = {
      ...scope,
      id: item.id,
      name: item.name,
      startScreenId: item.screenId,
      connectionIds: flowPath(graph, item.screenId),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
    if (!same(appMap.flows[item.id], flow)) changes.push({ kind: "flow.save", flow });
  }
  return changes;
}

/** Read projection used by the canvas for approved human or agent changes. */
export function mergeAppMapProjection(
  metadata: AppMapCanvasState,
  appMap: AppMap,
): AppMapCanvasState {
  const screens = Object.values(appMap.screens)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((screen) => ({
      id: screen.id,
      title: screen.title,
      ...(screen.identity ? { identity: structuredClone(screen.identity) } : {}),
      createdAt: screen.createdAt,
      updatedAt: screen.updatedAt,
    }));
  const transitions = Object.values(appMap.connections)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((connection) => {
      const recordings = connection.actions.filter((action) => action.kind === "recorded");
      const stepIds = recordings.flatMap((action) =>
        action.steps.flatMap((step) => (step.id ? [step.id] : [])),
      );
      const evidenceIds = recordings.flatMap((action) => action.evidenceIds);
      const firstRecording = recordings[0];
      const mode = connection.actions.some((action) => action.kind === "routine")
        ? ("reusable" as const)
        : connection.actions.some((action) => action.kind === "passive")
          ? ("automatic" as const)
          : ("interaction" as const);
      return {
        id: connection.id,
        fromScreenId: connection.fromScreenId,
        destination: structuredClone(connection.destination),
        stepIds,
        ...(evidenceIds.length ? { evidenceIds: [...new Set(evidenceIds)] } : {}),
        ...(firstRecording ? { takeId: firstRecording.takeId } : {}),
        mode,
        ...(connection.label ? { label: connection.label } : {}),
        state: connection.state === "ready" ? ("recorded" as const) : ("needs-recording" as const),
        kind: "forward" as const,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      };
    });
  const flows = Object.values(appMap.flows)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((flow) => ({
      id: flow.id,
      name: flow.name,
      screenId: flow.startScreenId,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
    }));
  const positions = { ...metadata.positions };
  const screenTitles = { ...metadata.screenTitles };
  for (const screen of Object.values(appMap.screens)) {
    screenTitles[screen.id] = screen.title;
    if (screen.position) positions[screen.id] = structuredClone(screen.position);
  }
  return {
    ...metadata,
    notes: Object.values(appMap.notes)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((note) => ({
        id: note.id,
        text: note.text,
        x: note.position.x,
        y: note.position.y,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })),
    positions,
    screenTitles,
    graph: { schemaVersion: 1, screens, transitions, flows },
  };
}
