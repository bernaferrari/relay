import type {
  ActionSpec,
  AppMap,
  AppMapBatchChange,
  Flow,
  MapGroup,
  CanvasGraph,
  AppMapCanvasState,
  RecipeStep,
  CanvasInteractionAnchor,
  ScreenVariant,
} from "@relay/protocol";

export type AppMapProjectionChange = AppMapBatchChange;

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, comparable(item)]),
  );
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function sourceAnchorForSteps(steps: readonly RecipeStep[]): CanvasInteractionAnchor | undefined {
  const step = steps.find((candidate) => candidate.kind === "tap");
  if (!step || step.kind !== "tap") return undefined;
  const point = step.target.point;
  const bounds = point?.referenceBounds;
  if (!point || !bounds?.width || !bounds.height) return undefined;
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
  return {
    point: {
      x: clamp(point.x, bounds.width) / bounds.width,
      y: clamp(point.y, bounds.height) / bounds.height,
    },
  };
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
  groups?: readonly MapGroup[];
  recipeSteps: readonly RecipeStep[];
  variantsByScreen?: Readonly<Record<string, readonly ScreenVariant[]>>;
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
    const variants = input.variantsByScreen?.[item.id]?.map((variant) => structuredClone(variant));
    if (!existing) {
      changes.push({
        kind: "screen.add",
        input: {
          screen: {
            ...scope,
            id: item.id,
            title: item.title,
            ...(item.identity ? { identity: structuredClone(item.identity) } : {}),
            ...(position ? { position: structuredClone(position) } : {}),
            variantIds: variants?.map((variant) => variant.id).sort() ?? [],
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          },
          ...(variants?.length ? { variants } : {}),
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
    if (Object.keys(patch).length || variants?.length)
      changes.push({
        kind: "screen.update",
        screenId: item.id,
        input: { patch, ...(variants?.length ? { upsertVariants: variants } : {}) },
      });
  }

  for (const group of input.groups ?? []) {
    if (!same(appMap.groups[group.id], group)) {
      changes.push({ kind: "group.save", group: structuredClone(group) });
    }
  }

  for (const item of graph.transitions) {
    const existing = appMap.connections[item.id];
    // The canvas is a spatial projection, not an execution editor. Existing
    // actions and review state are canonical App Map data and may have richer
    // recording evidence than the currently open UI has loaded.
    const actions = existing
      ? structuredClone(existing.actions)
      : transitionActions(item, stepsById);
    const value = {
      fromScreenId: item.fromScreenId,
      destination: structuredClone(item.destination),
      ...(item.label ? { label: item.label } : {}),
      state:
        existing?.state ?? (item.state === "recorded" ? ("ready" as const) : ("draft" as const)),
      actions,
    };
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
    const existing = appMap.flows[item.id];
    const flow: Flow = {
      ...scope,
      id: item.id,
      name: item.name,
      startScreenId: item.screenId,
      ...(item.setup || existing?.setup
        ? { setup: structuredClone(item.setup ?? existing!.setup) }
        : {}),
      // A graph node only knows where a Flow begins. Branch-aware canonical
      // paths cannot be reconstructed by following visually unique edges.
      connectionIds: existing ? [...existing.connectionIds] : flowPath(graph, item.screenId),
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
    // IDs are intentionally opaque and must never decide visual reading order.
    // Preserve the order in which states were observed so sibling branches and
    // their descendants stay aligned; stable IDs only break timestamp ties.
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map((screen) => ({
      id: screen.id,
      title: screen.title,
      ...(screen.identity ? { identity: structuredClone(screen.identity) } : {}),
      createdAt: screen.createdAt,
      updatedAt: screen.updatedAt,
    }));
  const transitions = Object.values(appMap.connections)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map((connection) => {
      const stepActions = connection.actions.filter(
        (action) => action.kind === "recorded" || action.kind === "steps",
      );
      const recordings = connection.actions.filter((action) => action.kind === "recorded");
      const stepIds = stepActions.flatMap((action) =>
        action.steps.flatMap((step) => (step.id ? [step.id] : [])),
      );
      const sourceAnchor = sourceAnchorForSteps(stepActions.flatMap((action) => action.steps));
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
        ...(sourceAnchor ? { sourceAnchor } : {}),
        mode,
        ...(connection.label ? { label: connection.label } : {}),
        state: connection.state === "ready" ? ("recorded" as const) : ("needs-recording" as const),
        ...(connection.state === "ready"
          ? {
              review: {
                status: "verified" as const,
                updatedAt: connection.updatedAt,
                verifiedAt: connection.updatedAt,
              },
            }
          : {}),
        kind: "forward" as const,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      };
    });
  const flows = Object.values(appMap.flows)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map((flow) => ({
      id: flow.id,
      name: flow.name,
      screenId: flow.startScreenId,
      ...(flow.setup ? { setup: structuredClone(flow.setup) } : {}),
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
    }));
  // Canonical App Map positions are the only persisted geometry. Retaining
  // recipe-era canvas metadata here made an unpositioned canonical screen
  // inherit stale coordinates and defeated automatic layout indefinitely.
  const positions: AppMapCanvasState["positions"] = {};
  const screenTitles = { ...metadata.screenTitles };
  for (const screen of Object.values(appMap.screens)) {
    screenTitles[screen.id] = screen.title;
    if (screen.position) positions[screen.id] = structuredClone(screen.position);
  }
  return {
    ...metadata,
    groups: Object.values(appMap.groups)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map((group) => structuredClone(group)),
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
