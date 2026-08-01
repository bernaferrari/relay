import type {
  JourneyConnection,
  JourneyGraphTransition,
  JourneyMetadata,
  JourneyTake,
  JourneyTransitionReview,
  RecipeStep,
} from "@relay/protocol";
import type { JourneyTree } from "./journey-tree";
import { transitionLabel } from "./journey-tree";
import {
  addGraphConnection,
  addGraphScreenConnection,
  attachGraphConnectionSteps,
  ensureJourneyGraph,
  removeGraphConnection,
  reviewGraphTransition,
  withJourneyGraph,
} from "./journey-graph";

/**
 * The executable recipe and the visual prototype deliberately meet here, in
 * one small pure module. Canvas-only connections may be sketched before they
 * are recorded, while recorded connections retain the exact stable step id the
 * runner executes. Keeping this separate from rendering makes a new canvas or
 * a future collaboration transport a replaceable concern.
 */
export type CanvasConnection = JourneyConnection & {
  stepIds: string[];
  source: "derived" | "authored";
  kind: "forward" | "return";
  mode?: JourneyGraphTransition["mode"];
  review?: JourneyTransitionReview;
};

export function canvasConnections(
  tree: JourneyTree,
  steps: RecipeStep[],
  metadata: JourneyMetadata,
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
  metadata: JourneyMetadata,
  input: Pick<JourneyConnection, "fromScreenId" | "toScreenId"> & { label?: string },
  at = Date.now(),
  steps: RecipeStep[] = [],
): JourneyMetadata {
  const added = addGraphConnection(ensureJourneyGraph(metadata, steps), input, at);
  return withJourneyGraph(metadata, added.graph);
}

export function addPlannedScreenConnection(
  metadata: JourneyMetadata,
  input: {
    fromScreenId: string;
    title?: string;
    position: { x: number; y: number };
  },
  at = Date.now(),
  steps: RecipeStep[] = [],
): JourneyMetadata {
  const added = addGraphScreenConnection(ensureJourneyGraph(metadata, steps), input, at);
  return withJourneyGraph(
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

export function removeAuthoredConnection(metadata: JourneyMetadata, id: string): JourneyMetadata {
  return withJourneyGraph(metadata, removeGraphConnection(ensureJourneyGraph(metadata, []), id));
}

export function attachRecordedTake(
  metadata: JourneyMetadata,
  connectionId: string,
  take: Pick<JourneyTake, "id" | "steps" | "videoTakeId" | "videoClip">,
  at = Date.now(),
): JourneyMetadata {
  if (!take.steps.some((step) => step.id)) return metadata;
  return withJourneyGraph(
    metadata,
    attachGraphConnectionSteps(
      ensureJourneyGraph(metadata, []),
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
  metadata: JourneyMetadata,
  connectionId: string,
  steps: RecipeStep[],
  mode: NonNullable<JourneyGraphTransition["mode"]>,
  at = Date.now(),
): JourneyMetadata {
  if (!steps.some((step) => step.id)) return metadata;
  return withJourneyGraph(
    metadata,
    attachGraphConnectionSteps(ensureJourneyGraph(metadata, []), connectionId, steps, { mode }, at),
  );
}

export function reviewTransition(
  metadata: JourneyMetadata,
  connectionId: string,
  review: Pick<JourneyTransitionReview, "status" | "error" | "targets">,
  at = Date.now(),
): JourneyMetadata {
  return withJourneyGraph(
    metadata,
    reviewGraphTransition(ensureJourneyGraph(metadata, []), connectionId, review, at),
  );
}

export function setJourneyBaseline(
  metadata: JourneyMetadata,
  state: "draft" | "verifying" | "needs-review" | "baselined",
  at = Date.now(),
): JourneyMetadata {
  return {
    ...metadata,
    schemaVersion: metadata.graph ? 6 : 5,
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
