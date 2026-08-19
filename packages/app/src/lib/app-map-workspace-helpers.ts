import type { AppMapRunPresentationState } from "./app-map-run-projection";
import type {
  AppMap,
  AppMapBatchChange,
  AppMapCanvasState,
  CanvasNote,
  Flow,
  MapGroup,
  RecipeStep,
} from "@relay/protocol";
import type { DeviceReadiness } from "./device-readiness";
import type { MapTreeNode } from "./app-map-tree";
import type { CanvasConnection } from "./app-map-connection-draft";
import {
  canvasEdgeArrowPath,
  canvasEdgeGeometry,
  connectorTargetGapForViewport,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  type CanvasBounds,
  type CanvasPoint,
  type CanvasScreenRotation,
  type CanvasViewport,
  type ScreenCardGeometry,
} from "./app-map-canvas-layout";
import {
  DEFAULT_CANVAS_GRID_SPACING,
  snapCanvasPointToGrid,
  type CanvasGrid,
} from "./app-map-grid";
import type { TakeDestination } from "./app-map-canvas-graph";
import { mapGroupGeometry } from "./app-map-groups";
import { humanizeTitle } from "./humanize-identifier";
import { minimapPoint } from "./app-map-minimap";
import {
  connectorAutoLanes,
  connectorHasAutomaticSourceLane,
  connectorPresentationWithAutoLane,
} from "./app-map-connector-lanes";

export function appMapLoadFailure(error: unknown): {
  title: string;
  guidance: string;
  detail?: string;
} {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const message = error instanceof Error ? error.message.trim().slice(0, 280) : "";
  if (status === 401 || status === 403) {
    return {
      title: "Relay can’t access this map",
      guidance: "Check the project connection or permissions, then try again.",
      ...(message ? { detail: message } : {}),
    };
  }
  if (status === 404) {
    return {
      title: "This map is no longer available",
      guidance: "Choose another App Map or return to the project and create a new one.",
      ...(message ? { detail: message } : {}),
    };
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return {
      title: "Relay couldn’t read this map",
      guidance: "The saved map was left unchanged. Review the details or choose another map.",
      ...(message ? { detail: message } : {}),
    };
  }
  return {
    title: "Relay couldn’t reach this map",
    guidance: "Your saved map has not been replaced. Check the connection and try again.",
    ...(message ? { detail: message } : {}),
  };
}

export function latestScreenVariant(appMap: AppMap | null | undefined, screenId: string) {
  const screen = appMap?.screens[screenId];
  if (!appMap || !screen) return undefined;
  return screen.variantIds
    .flatMap((id) => (appMap.screenVariants[id] ? [appMap.screenVariants[id]!] : []))
    .toSorted((left, right) => right.updatedAt - left.updatedAt)[0];
}

export function canonicalNotesFor(notes: CanvasNote[], appMap: AppMap): AppMap["notes"] {
  return Object.fromEntries(
    notes.map((note) => [
      note.id,
      {
        id: note.id,
        organizationId: appMap.organizationId,
        projectId: appMap.projectId,
        appMapId: appMap.id,
        text: note.text.trim() || "Note",
        position: { x: note.x, y: note.y },
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      },
    ]),
  );
}

/**
 * Turn canvas note edits into independent entity writes. Replacing the full
 * notes record meant a delayed drag could erase a collaborator's new sticky;
 * one mutation per note keeps the write path aligned with the normalized App
 * Map and with a future CRDT map keyed by note id.
 */
export function noteChangesFor(
  notes: CanvasNote[],
  appMap: AppMap,
  previousNotes: CanvasNote[] = [],
): AppMapBatchChange[] {
  const desired = canonicalNotesFor(notes, appMap);
  const previous = canonicalNotesFor(previousNotes, appMap);
  const saves = Object.values(desired)
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((note): AppMapBatchChange[] => {
      // Only write entities this local gesture changed. A note that merely
      // exists in a stale renderer projection must never overwrite a newer
      // remote note on the server while CRDT sync is not attached yet.
      if (JSON.stringify(previous[note.id]) === JSON.stringify(note)) return [];
      return [{ kind: "note.save", note }];
    });
  const removals = Object.keys(previous)
    .filter((id) => !desired[id] && Boolean(appMap.notes[id]))
    .sort()
    .map((noteId): AppMapBatchChange => ({ kind: "note.remove", noteId }));
  return [...saves, ...removals];
}

/** Describe the authoring gesture instead of recording every atomic canvas
 * persistence operation as the meaningless "Updated map". */
export function appMapCommitSummary(input: {
  appMap: AppMap;
  changes: readonly AppMapBatchChange[];
  /** Kept for legacy callers that still use a whole-note patch. */
  notesChanged?: boolean;
}): string {
  const { appMap, changes, notesChanged = false } = input;
  const screenTitle = (screenId: string) => appMap.screens[screenId]?.title ?? "screen";
  const destinationTitle = (destination: { kind: "screen"; screenId: string } | { kind: "end" }) =>
    destination.kind === "screen" ? screenTitle(destination.screenId) : "End";
  const itemCount = changes.length + (notesChanged ? 1 : 0);

  if (changes.length === 0 && notesChanged) return "Edited a note";
  if (
    changes.length > 1 &&
    !notesChanged &&
    changes.every(
      (change) =>
        change.kind === "screen.update" &&
        change.input.patch.position !== undefined &&
        Object.keys(change.input.patch).length === 1 &&
        !change.input.upsertVariants?.length &&
        !change.input.removeVariantIds?.length,
    )
  ) {
    return `Moved ${changes.length} screens`;
  }
  if (itemCount !== 1) return `Updated ${itemCount} map items`;

  const change = changes[0];
  if (!change) return "Edited a note";
  switch (change.kind) {
    case "note.save":
      return appMap.notes[change.note.id] ? "Edited a note" : "Added a note";
    case "note.remove":
      return "Removed a note";
    case "screen.add":
      return `Added ${change.input.screen.title}`;
    case "screen.update": {
      const before = screenTitle(change.screenId);
      if (change.input.patch.title) return `Renamed ${before} to ${change.input.patch.title}`;
      if (change.input.upsertVariants?.length) return `Updated screenshot for ${before}`;
      if (change.input.patch.position !== undefined) return `Moved ${before}`;
      return `Updated ${before}`;
    }
    case "screen.remove":
      return `Removed ${screenTitle(change.screenId)}`;
    case "connection.create":
      return `Connected ${screenTitle(change.connection.fromScreenId)} to ${destinationTitle(change.connection.destination)}`;
    case "connection.update":
      return `Updated path from ${screenTitle(appMap.connections[change.connectionId]?.fromScreenId ?? "")}`;
    case "connection.remove":
      return `Removed path from ${screenTitle(appMap.connections[change.connectionId]?.fromScreenId ?? "")}`;
    case "group.save":
      return `${appMap.groups[change.group.id] ? "Updated" : "Created"} group ${change.group.name}`;
    case "group.remove":
      return `Removed group ${appMap.groups[change.groupId]?.name ?? "Group"}`;
    case "flow.save":
      return `Updated flow ${change.flow.name}`;
    case "flow.remove":
      return `Removed flow ${appMap.flows[change.flowId]?.name ?? "Flow"}`;
    case "test.save":
      return `${appMap.tests?.[change.test.id] ? "Updated" : "Created"} reusable test ${change.test.name}`;
  }
}

export function canvasRemovalChanges(
  previous: AppMapCanvasState,
  next: AppMapCanvasState,
  appMap: AppMap,
): AppMapBatchChange[] {
  const previousGraph = previous.graph;
  if (!previousGraph) return [];
  const nextGraph = next.graph;
  const nextFlowIds = new Set(nextGraph?.flows.map((flow) => flow.id) ?? []);
  const nextConnectionIds = new Set(
    nextGraph?.transitions.map((connection) => connection.id) ?? [],
  );
  const nextScreenIds = new Set(nextGraph?.screens.map((screen) => screen.id) ?? []);
  const nextGroupIds = new Set((next.groups ?? []).map((group) => group.id));
  return [
    ...(previous.groups ?? []).flatMap((group): AppMapBatchChange[] =>
      !nextGroupIds.has(group.id) && appMap.groups[group.id]
        ? [{ kind: "group.remove", groupId: group.id }]
        : [],
    ),
    ...previousGraph.flows.flatMap((flow): AppMapBatchChange[] =>
      !nextFlowIds.has(flow.id) && appMap.flows[flow.id]
        ? [{ kind: "flow.remove", flowId: flow.id }]
        : [],
    ),
    ...previousGraph.transitions.flatMap((connection): AppMapBatchChange[] =>
      !nextConnectionIds.has(connection.id) && appMap.connections[connection.id]
        ? [{ kind: "connection.remove", connectionId: connection.id }]
        : [],
    ),
    ...previousGraph.screens.flatMap((screen): AppMapBatchChange[] =>
      !nextScreenIds.has(screen.id) && appMap.screens[screen.id]
        ? [{ kind: "screen.remove", screenId: screen.id }]
        : [],
    ),
  ];
}

export function orderCanvasChanges(changes: AppMapBatchChange[]): AppMapBatchChange[] {
  const priority = (change: AppMapBatchChange): number => {
    if (change.kind === "note.save") return 0;
    if (change.kind === "screen.add" || change.kind === "screen.update") return 0;
    if (change.kind === "group.remove") return 1;
    if (change.kind === "group.save") return 2;
    if (change.kind === "connection.create" || change.kind === "connection.update") return 3;
    if (change.kind === "flow.save" || change.kind === "flow.remove") return 4;
    if (change.kind === "test.save") return 5;
    if (change.kind === "connection.remove") return 6;
    return 7;
  };
  return changes
    .map((change, index) => ({ change, index }))
    .sort((left, right) => {
      return priority(left.change) - priority(right.change) || left.index - right.index;
    })
    .map(({ change }) => change);
}

/** Map the shared device readiness model onto the capture empty-state contract. */
export function recordStateFromReadiness(
  readiness: DeviceReadiness,
):
  | "choose-device"
  | "device-unavailable"
  | "enable-developer-mode"
  | "preparing-ios"
  | "preparing-screen"
  | "checking-ios"
  | "setup-ios"
  | "capture-error"
  | "ready" {
  if (readiness.kind === "choose-device") return "choose-device";
  if (readiness.kind === "device-unavailable") return "device-unavailable";
  if (readiness.kind === "ios-developer-mode-disabled") return "enable-developer-mode";
  if (readiness.kind === "ios-preparing") return "preparing-ios";
  if (readiness.kind === "screen-preparing") return "preparing-screen";
  if (readiness.kind === "checking-ios") return "checking-ios";
  if (readiness.kind === "setup-ios") return "setup-ios";
  if (readiness.kind === "capture-error") return "capture-error";
  return "ready";
}

export function buildMinimapNodes(input: {
  nodes: MapTreeNode[];
  notes: CanvasNote[];
  matrices?: Array<{ id: string; position: CanvasPoint }>;
  bounds: CanvasBounds;
  positionFor: (node: MapTreeNode) => CanvasPoint;
  selectedNodeIds: readonly string[];
  screenStates: Record<string, AppMapRunPresentationState | undefined>;
}) {
  return [
    ...input.nodes.map((node) => {
      const position = input.positionFor(node);
      const point = minimapPoint(
        {
          x: position.x + SCREEN_CARD_WIDTH / 2,
          y: position.y + SCREEN_CARD_HEIGHT / 2,
        },
        input.bounds,
      );
      return {
        id: node.id,
        kind: "screen" as const,
        x: point.x,
        y: point.y,
        selected: input.selectedNodeIds.includes(node.id),
        state: input.screenStates[node.id],
      };
    }),
    ...input.notes.map((note) => {
      const point = minimapPoint({ x: note.x + 110, y: note.y + 66 }, input.bounds);
      return {
        id: note.id,
        kind: "note" as const,
        x: point.x,
        y: point.y,
        selected: false,
      };
    }),
    ...(input.matrices ?? []).map((matrix) => {
      const point = minimapPoint(
        { x: matrix.position.x + 142, y: matrix.position.y + 75 },
        input.bounds,
      );
      return {
        id: matrix.id,
        kind: "matrix" as const,
        x: point.x,
        y: point.y,
        selected: false,
      };
    }),
  ];
}

export function buildMinimapGroups(input: {
  groups: readonly MapGroup[];
  bounds: CanvasBounds;
  positions: Readonly<Record<string, CanvasPoint>>;
  selectedGroupId: string | null;
}) {
  return input.groups.flatMap((group) => {
    const geometry = mapGroupGeometry(group, input.positions);
    if (!geometry) return [];
    const topLeft = minimapPoint({ x: geometry.left, y: geometry.top }, input.bounds);
    const bottomRight = minimapPoint({ x: geometry.right, y: geometry.bottom }, input.bounds);
    return [
      {
        id: group.id,
        x: topLeft.x,
        y: topLeft.y,
        width: Math.max(0.8, bottomRight.x - topLeft.x),
        height: Math.max(0.8, bottomRight.y - topLeft.y),
        selected: group.id === input.selectedGroupId,
      },
    ];
  });
}

export function buildMinimapEdges(input: {
  nodes: MapTreeNode[];
  connections: CanvasConnection[];
  positionFor: (node: MapTreeNode) => CanvasPoint;
  geometryForNode?: (node: MapTreeNode) => ScreenCardGeometry;
  sourceRotationFor?: (screenId: string) => CanvasScreenRotation;
  viewportScale?: number;
  selectedConnectionId: string | null;
  transitionStates: Record<string, AppMapRunPresentationState | undefined>;
}) {
  const nodes = new Map(input.nodes.map((node) => [node.id, node]));
  const lanes = connectorAutoLanes(
    input.connections,
    (screenId) => {
      const node = nodes.get(screenId);
      return node ? input.positionFor(node) : undefined;
    },
    (screenId) => {
      const node = nodes.get(screenId);
      return node ? input.geometryForNode?.(node) : undefined;
    },
  );
  return input.connections.flatMap((connection) => {
    const selected = input.selectedConnectionId === connection.id;
    const from = nodes.get(connection.fromScreenId);
    const to = nodes.get(connection.toScreenId);
    if (!from || !to) return [];
    const presentation = connectorPresentationWithAutoLane(connection, lanes);
    const geometry = canvasEdgeGeometry(
      {
        from: connection.fromScreenId,
        to: connection.toScreenId,
        kind: connection.kind,
        sourceAnchor: connection.sourceAnchor,
        sourceRotation: input.sourceRotationFor?.(connection.fromScreenId),
        presentation,
        automaticSourceLane: connectorHasAutomaticSourceLane(connection, lanes),
        targetGap: connectorTargetGapForViewport(input.viewportScale),
      },
      input.nodes,
      input.positionFor,
      nodes,
      input.geometryForNode,
    );
    return [
      {
        id: connection.id,
        path: geometry.path,
        arrowPath: presentation?.arrow === "none" ? null : canvasEdgeArrowPath(geometry, 2),
        selected,
        state: input.transitionStates[connection.id],
      },
    ];
  });
}

export function buildPresenceGeometry(input: {
  nodes: MapTreeNode[];
  connections: CanvasConnection[];
  positionFor: (node: MapTreeNode) => CanvasPoint;
  geometryForNode?: (node: MapTreeNode) => ScreenCardGeometry;
  sourceRotationFor?: (screenId: string) => CanvasScreenRotation;
  viewportScale?: number;
}) {
  const nodes = new Map(input.nodes.map((node) => [node.id, node]));
  const lanes = connectorAutoLanes(
    input.connections,
    (screenId) => {
      const node = nodes.get(screenId);
      return node ? input.positionFor(node) : undefined;
    },
    (screenId) => {
      const node = nodes.get(screenId);
      return node ? input.geometryForNode?.(node) : undefined;
    },
  );
  return {
    screenPositions: Object.fromEntries(
      input.nodes.map((node) => [node.id, { ...input.positionFor(node) }]),
    ),
    connectionPaths: Object.fromEntries(
      input.connections.map((connection) => [
        connection.id,
        canvasEdgeGeometry(
          {
            from: connection.fromScreenId,
            to: connection.toScreenId,
            kind: connection.kind,
            sourceAnchor: connection.sourceAnchor,
            sourceRotation: input.sourceRotationFor?.(connection.fromScreenId),
            presentation: connectorPresentationWithAutoLane(connection, lanes),
            automaticSourceLane: connectorHasAutomaticSourceLane(connection, lanes),
            targetGap: connectorTargetGapForViewport(input.viewportScale),
          },
          input.nodes,
          input.positionFor,
          undefined,
          input.geometryForNode,
        ).path,
      ]),
    ),
  };
}

export function applyScreenRemovalToCanvas(
  current: AppMapCanvasState,
  screenId: string,
): Omit<AppMapCanvasState, "graph"> & { graph?: AppMapCanvasState["graph"] } {
  const nextPositions = { ...current.positions };
  const nextTitles = { ...current.screenTitles };
  delete nextPositions[screenId];
  delete nextTitles[screenId];
  return {
    ...current,
    positions: nextPositions,
    screenTitles: nextTitles,
    groups: (current.groups ?? []).flatMap((group) => {
      const screenIds = group.screenIds.filter((id) => id !== screenId);
      return screenIds.length ? [{ ...group, screenIds, updatedAt: Date.now() }] : [];
    }),
  };
}

export function applyScreenRenameToCanvas(
  current: AppMapCanvasState,
  graph: NonNullable<AppMapCanvasState["graph"]>,
  screenId: string,
  title: string,
): AppMapCanvasState {
  const nextGraph = structuredClone(graph);
  const screen = nextGraph.screens.find((entry) => entry.id === screenId);
  if (screen) {
    screen.title = title;
    screen.updatedAt = Date.now();
  }
  return {
    ...current,
    screenTitles: { ...current.screenTitles, [screenId]: title },
    graph: nextGraph,
  };
}

export type AppMapReplayState = "idle" | "running" | "passed" | "failed";

export function entryFlowsForScreen(appMap: AppMap | undefined, screenId: string | null): Flow[] {
  return appMap && screenId
    ? Object.values(appMap.flows).filter((flow) => flow.startScreenId === screenId)
    : [];
}

export function selectedFlowSetupSummary(
  flows: Flow[],
  routines: AppMap["routines"] | undefined,
):
  | {
      flowCount: number;
      mixed: boolean;
      routineId: string | undefined;
      routines: { id: string; name: string }[];
    }
  | undefined {
  if (!flows.length) return undefined;
  const values = new Set(flows.map((flow) => flow.setup?.routineId ?? ""));
  return {
    flowCount: flows.length,
    mixed: values.size > 1,
    routineId: values.size === 1 ? [...values][0] || undefined : undefined,
    routines: Object.values(routines ?? {})
      .filter((routine) =>
        routine.parameters.every(
          (parameter) => !parameter.required || parameter.default !== undefined,
        ),
      )
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((routine) => ({ id: routine.id, name: routine.name })),
  };
}

export function listReusableBehaviors(appMap: AppMap | undefined): {
  id: string;
  label: string;
  actionCount: number;
}[] {
  return Object.values(appMap?.routines ?? {})
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((routine) => ({
      id: routine.id,
      label: routine.name,
      actionCount: routine.actions.reduce(
        (count, action) =>
          count + (action.kind === "recorded" || action.kind === "steps" ? action.steps.length : 1),
        0,
      ),
    }));
}

export function stepsForConnectionIds(
  steps: readonly RecipeStep[],
  stepIds: readonly string[],
): RecipeStep[] {
  const byId = new Map(steps.flatMap((step) => (step.id ? [[step.id, step]] : [])));
  return stepIds.flatMap((id) => {
    const step = byId.get(id);
    return step ? [step] : [];
  });
}

export function connectionReplayState(
  connection: CanvasConnection,
  current: { connectionId: string | null; state: AppMapReplayState },
): AppMapReplayState {
  if (current.connectionId === connection.id && current.state !== "idle") return current.state;
  if (connection.review?.status === "verified") return "passed";
  if (connection.review?.status === "failed") return "failed";
  return "idle";
}

export function connectionReplayError(
  connection: CanvasConnection,
  current: { connectionId: string | null; error?: string },
): string | undefined {
  return current.connectionId === connection.id
    ? current.error
    : connection.review?.status === "failed"
      ? connection.review.error
      : undefined;
}

export function resolveTakeReviewDestination(input: {
  matchedScreenId?: string;
  plannedToScreenId?: string;
}): TakeDestination {
  if (input.matchedScreenId) return { kind: "screen", screenId: input.matchedScreenId };
  if (input.plannedToScreenId) return { kind: "screen", screenId: input.plannedToScreenId };
  return { kind: "new-screen" };
}

export function takeReplayFromLatest(input: {
  takeId: string | null | undefined;
  outcome?: "passed" | "failed" | string;
  error?: string;
}): { takeId: string | null; state: AppMapReplayState; error?: string } {
  if (input.outcome === "passed") {
    return { takeId: input.takeId ?? null, state: "passed" };
  }
  if (input.outcome === "failed") {
    return {
      takeId: input.takeId ?? null,
      state: "failed",
      ...(input.error ? { error: input.error } : {}),
    };
  }
  return { takeId: input.takeId ?? null, state: "idle" };
}

/**
 * The name a screen shows everywhere: canvas frame label, Screens grid,
 * inspector, run and path descriptions. A recorded screen can be saved under
 * the identifier of whatever was tapped to reach it, so `settings_button` was
 * reaching the canvas as a title; humanizing here rather than at each call site
 * is what keeps those surfaces from disagreeing about what a screen is called.
 */
export function resolveScreenTitle(
  node: MapTreeNode,
  screenTitles: Record<string, string> | undefined,
): string {
  return humanizeTitle(screenTitles?.[node.id]?.trim() || node.title);
}

export function captureContextLabel(input: {
  pendingConnectionId: string | null;
  connections: CanvasConnection[];
  nodes: MapTreeNode[];
  titleFor: (node: MapTreeNode) => string;
}): string | undefined {
  const transition = input.pendingConnectionId
    ? input.connections.find((connection) => connection.id === input.pendingConnectionId)
    : null;
  if (!transition) return undefined;
  const source = input.nodes.find((node) => node.id === transition.fromScreenId);
  const target = input.nodes.find((node) => node.id === transition.toScreenId);
  return source && target ? `${input.titleFor(source)} → ${input.titleFor(target)}` : undefined;
}

export function visibleCanvasBoundsFromViewport(input: {
  viewport: CanvasViewport;
  client: { width: number; height: number };
  overscan?: number;
}): { left: number; top: number; right: number; bottom: number } {
  const overscan = input.overscan ?? 480;
  const { viewport, client } = input;
  return {
    left: -viewport.x / viewport.scale - overscan,
    top: -viewport.y / viewport.scale - overscan,
    right: (-viewport.x + client.width) / viewport.scale + overscan,
    bottom: (-viewport.y + client.height) / viewport.scale + overscan,
  };
}

export function applyTargetSetToActiveFlow(
  graph: NonNullable<AppMapCanvasState["graph"]>,
  flowId: string,
  targetSetId: string | undefined,
  at = Date.now(),
): NonNullable<AppMapCanvasState["graph"]> {
  return {
    ...graph,
    flows: graph.flows.map((candidate) => {
      if (candidate.id !== flowId) return candidate;
      const { targetSetId: _previousTargetSetId, ...withoutTargetSet } = candidate;
      return {
        ...withoutTargetSet,
        ...(targetSetId ? { targetSetId } : {}),
        updatedAt: at,
      };
    }),
  };
}

export function connectionReviewTarget(input: {
  serial?: string | null;
  selectedDeviceSerial?: string | null;
  deviceName?: string;
  platform?: "android" | "browser" | "ios";
  passed: boolean;
  checkedAt: number;
  error?: string;
}): {
  targetId: string;
  targetName?: string;
  platform?: "android" | "browser" | "ios";
  status: "passed" | "failed";
  checkedAt: number;
  error?: string;
} {
  return {
    targetId: input.serial ?? input.selectedDeviceSerial ?? "current-device",
    ...(input.deviceName ? { targetName: input.deviceName } : {}),
    ...(input.platform ? { platform: input.platform } : {}),
    status: input.passed ? ("passed" as const) : ("failed" as const),
    checkedAt: input.checkedAt,
    ...(input.error ? { error: input.error } : {}),
  };
}

export type NotePlacement = {
  id: string;
  text: string;
  x: number;
  y: number;
  createdAt: number;
  updatedAt: number;
};

export function createCanvasNote(input: {
  viewport: CanvasViewport;
  clientWidth?: number;
  clientHeight?: number;
  /** The fixed minor lattice; optional for callers outside the canvas. */
  grid?: CanvasGrid;
  at?: number;
}): NotePlacement {
  const at = input.at ?? Date.now();
  const x = input.clientWidth
    ? (input.clientWidth * 0.52 - input.viewport.x) / input.viewport.scale
    : 320;
  const y = input.clientHeight
    ? (input.clientHeight * 0.42 - input.viewport.y) / input.viewport.scale
    : 180;
  const position = snapCanvasPointToGrid(
    { x, y },
    input.grid ?? { spacing: DEFAULT_CANVAS_GRID_SPACING },
  );
  const id = `note-${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? at.toString(36)}`;
  return {
    id,
    text: "Add context for this part of the map",
    x: position.x,
    y: position.y,
    createdAt: at,
    updatedAt: at,
  };
}

export function recipeStepsForRunReadiness(
  draftSteps: readonly RecipeStep[],
  connections: AppMap["connections"] | undefined,
): RecipeStep[] {
  return [
    ...draftSteps,
    ...Object.values(connections ?? {}).flatMap((connection) =>
      connection.actions.flatMap((action) =>
        action.kind === "recorded" || action.kind === "steps" ? action.steps : [],
      ),
    ),
  ];
}

export function canvasProjectionUnchanged(
  value: AppMapCanvasState,
  current: AppMapCanvasState,
): boolean {
  // A local canvas gesture intentionally stamps its transition before the
  // server commits it. The canonical projection then arrives with the
  // server's `updatedAt`, even though its visible graph is identical. Treat
  // that acknowledgement as unchanged: otherwise every connector appearance
  // edit clears local canvas history before Cmd/Ctrl+Z can restore it.
  const comparableGraph = (graph: AppMapCanvasState["graph"]): unknown => {
    const visit = (item: unknown): unknown => {
      if (Array.isArray(item)) return item.map(visit);
      if (!item || typeof item !== "object") return item;
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .filter(([key]) => key !== "updatedAt")
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, visit(value)]),
      );
    };
    return visit(graph);
  };
  return (
    JSON.stringify(comparableGraph(value.graph)) ===
      JSON.stringify(comparableGraph(current.graph)) &&
    JSON.stringify(value.positions) === JSON.stringify(current.positions) &&
    JSON.stringify(value.groups) === JSON.stringify(current.groups) &&
    JSON.stringify(value.screenTitles) === JSON.stringify(current.screenTitles) &&
    JSON.stringify(value.notes) === JSON.stringify(current.notes)
  );
}

export function clampGroupMenuPosition(input: {
  clientX: number;
  clientY: number;
  rect: { left: number; top: number; width: number; height: number };
  menuWidth?: number;
  menuHeight?: number;
}): { x: number; y: number } {
  const menuWidth = input.menuWidth ?? 196;
  const menuHeight = input.menuHeight ?? 136;
  return {
    x: Math.min(input.rect.width - menuWidth, Math.max(8, input.clientX - input.rect.left)),
    y: Math.min(input.rect.height - menuHeight, Math.max(8, input.clientY - input.rect.top)),
  };
}

export function connectionPathTitle(
  connection: CanvasConnection,
  nodes: MapTreeNode[],
  titleFor: (node: MapTreeNode) => string,
  fallback = { source: "Screen", target: "Next screen" },
): string {
  const source = nodes.find((node) => node.id === connection.fromScreenId);
  const target = nodes.find((node) => node.id === connection.toScreenId);
  return `${source ? titleFor(source) : fallback.source} → ${target ? titleFor(target) : fallback.target}`;
}

export function recordedActionFromConnection(
  connection: CanvasConnection,
  steps: RecipeStep[],
): {
  id: string;
  kind: "recorded";
  takeId: string;
  takeRevision: number;
  steps: RecipeStep[];
  evidenceIds: [];
} {
  return {
    id: `recorded-${crypto.randomUUID()}`,
    kind: "recorded",
    takeId: connection.takeId ?? connection.id,
    takeRevision: 1,
    steps: steps.map((step) => structuredClone(step)),
    evidenceIds: [],
  };
}
