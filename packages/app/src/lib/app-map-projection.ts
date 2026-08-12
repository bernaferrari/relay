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
  Screen,
  ScreenVariant,
} from "@relay/protocol";
import { normalizedAnchorForStep } from "./app-map-interaction-anchor";

export type AppMapProjectionChange = AppMapBatchChange;

/**
 * Canonical screen data retained only by a local undo transaction. The canvas
 * is deliberately a lightweight projection, so screenshot variants cannot be
 * reconstructed from it after a screen removal has deleted them server-side.
 */
export type AppMapScreenRestoreSnapshot = {
  screensById: Readonly<Record<string, Screen>>;
  variantsByScreen: Readonly<Record<string, readonly ScreenVariant[]>>;
};

/**
 * Capture the small canonical pre-image needed to undo a screen deletion.
 * Values are cloned at the history boundary so an asynchronous canonical
 * refresh cannot mutate an already-recorded undo step.
 */
export function screenRestoreSnapshotFor(
  appMap: AppMap,
  screenIds: readonly string[],
): AppMapScreenRestoreSnapshot | undefined {
  const screensById: Record<string, Screen> = {};
  const variantsByScreen: Record<string, ScreenVariant[]> = {};
  for (const screenId of [...new Set(screenIds)].sort()) {
    const screen = appMap.screens[screenId];
    if (!screen) continue;
    screensById[screenId] = structuredClone(screen);
    variantsByScreen[screenId] = screen.variantIds.flatMap((variantId) => {
      const variant = appMap.screenVariants[variantId];
      return variant ? [structuredClone(variant)] : [];
    });
  }
  return Object.keys(screensById).length ? { screensById, variantsByScreen } : undefined;
}

/** Reduce canonical connection actions to the recipe steps the canvas needs
 * for interaction labels and source anchors. Deterministic taps are real
 * interactions too; treating only recorded takes as steps made ordinary
 * `Menu`/`Settings` paths look like complex, permanently labelled flows. */
export function connectionStepsFromActions(actions: readonly ActionSpec[]): RecipeStep[] {
  return actions.flatMap((action): RecipeStep[] => {
    if (action.kind === "recorded" || action.kind === "steps") return action.steps;
    if (action.kind === "tap") {
      return [{ id: action.id, kind: "tap", target: structuredClone(action.target) }];
    }
    if (action.kind === "wait") return [{ id: action.id, kind: "sleep", ms: action.ms }];
    if (action.kind === "gesture" && action.gesture.kind === "swipe") {
      return [
        {
          id: action.id,
          kind: "swipe",
          from: structuredClone(action.gesture.from),
          to: structuredClone(action.gesture.to),
          durationMs: action.gesture.durationMs,
        },
      ];
    }
    return [];
  });
}

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
  for (const step of steps) {
    const anchor = normalizedAnchorForStep(step);
    if (anchor) return anchor;
  }
  return undefined;
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
  /** Canonical pre-image from a local delete undo. It is not persisted canvas
   * state and is used only when the current canonical map no longer has the
   * screen that the restored graph reintroduces. */
  restore?: AppMapScreenRestoreSnapshot;
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
    const restored = input.restore?.screensById[item.id];
    const variants = (
      input.variantsByScreen?.[item.id] ?? input.restore?.variantsByScreen[item.id]
    )?.map((variant) => structuredClone(variant));
    if (!existing) {
      changes.push({
        kind: "screen.add",
        input: {
          screen: {
            ...(restored ? structuredClone(restored) : {}),
            ...scope,
            id: item.id,
            title: item.title,
            ...(item.identity
              ? { identity: structuredClone(item.identity) }
              : restored?.identity
                ? { identity: structuredClone(restored.identity) }
                : {}),
            ...(position
              ? { position: structuredClone(position) }
              : restored?.position
                ? { position: structuredClone(restored.position) }
                : {}),
            variantIds: variants?.map((variant) => variant.id).sort() ?? restored?.variantIds ?? [],
            createdAt: restored?.createdAt ?? item.createdAt,
            updatedAt: restored?.updatedAt ?? item.updatedAt,
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
      ...(item.presentation ? { presentation: structuredClone(item.presentation) } : {}),
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
          ...(existing.presentation ? { presentation: existing.presentation } : {}),
          state: existing.state,
          actions: existing.actions,
        },
        value,
      )
    ) {
      changes.push({
        kind: "connection.update",
        connectionId: item.id,
        patch: {
          ...value,
          ...(!item.label && existing.label ? { label: null } : {}),
          ...(!item.presentation && existing.presentation ? { presentation: null } : {}),
        },
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
      const connectionSteps = connectionStepsFromActions(connection.actions);
      const recordings = connection.actions.filter((action) => action.kind === "recorded");
      const stepIds = connectionSteps.flatMap((step) => (step.id ? [step.id] : []));
      const sourceAnchor: CanvasInteractionAnchor | undefined = connection.sourceAnchor
        ? structuredClone(connection.sourceAnchor)
        : sourceAnchorForSteps(connectionSteps);
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
        ...(connection.presentation
          ? { presentation: structuredClone(connection.presentation) }
          : {}),
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
