import type {
  PrototypeConnection,
  CanvasTransition,
  AppMapCanvasState,
  ConnectionTake,
  ConnectionTakeReview,
  RecipeStep,
} from "@relay/protocol";
import type { MapTree } from "./app-map-tree";
import { transitionLabel } from "./app-map-tree";
import {
  addGraphConnection,
  addGraphScreenConnection,
  attachGraphConnectionSteps,
  ensureCanvasGraph,
  removeGraphConnection,
  reviewGraphTransition,
  withCanvasGraph,
} from "./app-map-canvas-graph";

/**
 * The executable recipe and the visual prototype deliberately meet here, in
 * one small pure module. Canvas-only connections may be sketched before they
 * are recorded, while recorded connections retain the exact stable step id the
 * runner executes. Keeping this separate from rendering makes a new canvas or
 * a future collaboration transport a replaceable concern.
 */
export type CanvasConnection = PrototypeConnection & {
  stepIds: string[];
  source: "derived" | "authored";
  kind: "forward" | "return";
  mode?: CanvasTransition["mode"];
  review?: ConnectionTakeReview;
};

export function canvasConnections(
  tree: MapTree,
  steps: RecipeStep[],
  metadata: AppMapCanvasState,
): CanvasConnection[] {
  // v6 has one authored source of truth. Recipes remain executable data; the
  // graph tells the canvas which recipe actions make up each connection.
  if (metadata.graph) {
    return metadata.graph.transitions.flatMap((transition): CanvasConnection[] => {
      if (transition.destination.kind !== "screen") return [];
      const stepId = transition.stepIds[0];
      const step = steps.find((candidate) => candidate.id === stepId);
      return [
        {
          id: transition.id,
          fromScreenId: transition.fromScreenId,
          toScreenId: transition.destination.screenId,
          ...(stepId ? { stepId } : {}),
          stepIds: transition.stepIds,
          ...(transition.takeId ? { takeId: transition.takeId } : {}),
          ...(transition.videoTakeId ? { videoTakeId: transition.videoTakeId } : {}),
          ...(transition.videoClip ? { videoClip: { ...transition.videoClip } } : {}),
          ...(transition.mode ? { mode: transition.mode } : {}),
          ...(transition.review ? { review: { ...transition.review } } : {}),
          label: transition.label || (step ? transitionLabel(step) : "Record action"),
          state: transition.state,
          createdAt: transition.createdAt,
          updatedAt: transition.updatedAt,
          source: transition.state === "needs-recording" ? "authored" : "derived",
          kind: transition.kind,
        },
      ];
    });
  }
  const availableScreens = new Set(tree.nodes.map((node) => node.id));
  const authored = new Map(
    (metadata.prototype?.connections ?? [])
      .filter(
        (connection) =>
          availableScreens.has(connection.fromScreenId) &&
          availableScreens.has(connection.toScreenId),
      )
      .map((connection) => [connection.id, connection]),
  );

  const derived = tree.edges.map((edge): CanvasConnection => {
    const saved = authored.get(edge.id);
    authored.delete(edge.id);
    const step = steps[edge.stepIndex];
    return {
      id: edge.id,
      fromScreenId: edge.from,
      toScreenId: edge.to,
      ...(step?.id ? { stepId: step.id } : {}),
      stepIds: step?.id ? [step.id] : [],
      ...(saved?.takeId ? { takeId: saved.takeId } : {}),
      ...(saved?.videoTakeId ? { videoTakeId: saved.videoTakeId } : {}),
      ...(saved?.videoClip ? { videoClip: { ...saved.videoClip } } : {}),
      label: saved?.label?.trim() || metadata.edgeLabels[edge.id] || transitionLabel(step!),
      state: "recorded",
      createdAt: saved?.createdAt ?? 0,
      updatedAt: saved?.updatedAt ?? 0,
      source: saved ? "authored" : "derived",
      kind: edge.kind,
    };
  });

  // Only authored routes remain. They are intentional planning objects, so
  // they never pretend to be executable until a recorder attaches a step id.
  const planned = [...authored.values()].map(
    (connection): CanvasConnection => ({
      ...connection,
      stepIds: connection.stepId ? [connection.stepId] : [],
      state: connection.stepId ? "recorded" : "needs-recording",
      source: "authored",
      kind: "forward",
    }),
  );
  return [...derived, ...planned];
}

export function addPlannedConnection(
  metadata: AppMapCanvasState,
  input: Pick<PrototypeConnection, "fromScreenId" | "toScreenId"> & { label?: string },
  at = Date.now(),
  steps: RecipeStep[] = [],
): AppMapCanvasState {
  const added = addGraphConnection(ensureCanvasGraph(metadata, steps), input, at);
  return withCanvasGraph(metadata, added.graph);
}

export function addPlannedScreenConnection(
  metadata: AppMapCanvasState,
  input: {
    fromScreenId: string;
    title?: string;
    position: { x: number; y: number };
  },
  at = Date.now(),
  steps: RecipeStep[] = [],
): AppMapCanvasState {
  const added = addGraphScreenConnection(ensureCanvasGraph(metadata, steps), input, at);
  return withCanvasGraph(
    {
      ...metadata,
      positions: {
        ...metadata.positions,
        [added.screen.id]: added.position,
      },
    },
    added.graph,
  );
}

export function removeAuthoredConnection(
  metadata: AppMapCanvasState,
  id: string,
): AppMapCanvasState {
  return withCanvasGraph(metadata, removeGraphConnection(ensureCanvasGraph(metadata, []), id));
}

export function attachRecordedTake(
  metadata: AppMapCanvasState,
  connectionId: string,
  take: Pick<ConnectionTake, "id" | "steps" | "videoTakeId" | "videoClip">,
  at = Date.now(),
): AppMapCanvasState {
  if (!take.steps.some((step) => step.id)) return metadata;
  return withCanvasGraph(
    metadata,
    attachGraphConnectionSteps(
      ensureCanvasGraph(metadata, []),
      connectionId,
      take.steps,
      {
        takeId: take.id,
        ...(take.videoTakeId ? { videoTakeId: take.videoTakeId } : {}),
        ...(take.videoClip ? { videoClip: take.videoClip } : {}),
        mode: "interaction",
      },
      at,
    ),
  );
}

export function attachTransitionSteps(
  metadata: AppMapCanvasState,
  connectionId: string,
  steps: RecipeStep[],
  mode: NonNullable<CanvasConnection["mode"]>,
  at = Date.now(),
): AppMapCanvasState {
  if (!steps.some((step) => step.id)) return metadata;
  return withCanvasGraph(
    metadata,
    attachGraphConnectionSteps(ensureCanvasGraph(metadata, []), connectionId, steps, { mode }, at),
  );
}

export function reviewTransition(
  metadata: AppMapCanvasState,
  connectionId: string,
  review: Pick<ConnectionTakeReview, "status" | "error" | "targets">,
  at = Date.now(),
): AppMapCanvasState {
  return withCanvasGraph(
    metadata,
    reviewGraphTransition(ensureCanvasGraph(metadata, []), connectionId, review, at),
  );
}

export function setMapBaseline(
  metadata: AppMapCanvasState,
  state: "draft" | "verifying" | "needs-review" | "baselined",
  at = Date.now(),
): AppMapCanvasState {
  return {
    ...metadata,
    schemaVersion: 1,
    prototype: {
      ...metadata.prototype,
      verification: {
        state,
        updatedAt: at,
        ...(state === "baselined" ? { baselineAt: at } : {}),
      },
    },
  };
}
