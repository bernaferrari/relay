import {
  createCollaborativeJourneyDoc,
  createCollaborativeJourneyUndoManager,
  materializeCollaborativeJourney,
  reconcileCollaborativeJourney,
} from "@relay/collaboration";
import type { JourneyGraphScreen, JourneyMetadata } from "@relay/protocol";
import * as Y from "yjs";

export type JourneyDocumentListener = (value: JourneyMetadata, origin: unknown) => void;

/**
 * Canvas-facing adapter over Relay's canonical, safe collaborative Journey.
 *
 * The Y.Doc contains only editable graph structure. Executable steps, takes,
 * evidence, review state, leases, and recording state remain in the private
 * authoritative overlay supplied by the server and are never encoded in Yjs.
 */
export type JourneyDocument = {
  doc: Y.Doc;
  undo: Y.UndoManager;
  localOrigin: unknown;
  read: () => JourneyMetadata;
  replace: (value: JourneyMetadata, origin?: unknown) => JourneyMetadata;
  subscribe: (listener: JourneyDocumentListener) => () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undoOnce: () => JourneyMetadata;
  redoOnce: () => JourneyMetadata;
  destroy: () => void;
};

function safeCollaborativeProjection(value: JourneyMetadata): Y.Doc {
  const projected = createCollaborativeJourneyDoc(value);
  try {
    // Default materialization strips every server-owned executable field.
    const editable = materializeCollaborativeJourney(projected);
    return createCollaborativeJourneyDoc(editable);
  } finally {
    projected.destroy();
  }
}

function mergeObservations(
  authoritative: JourneyGraphScreen["observations"],
  editable: JourneyGraphScreen["observations"],
): JourneyGraphScreen["observations"] {
  if (!editable) return editable;
  const byId = new Map((authoritative ?? []).map((observation) => [observation.id, observation]));
  return editable.map((observation) => ({ ...byId.get(observation.id), ...observation }));
}

function mergeAuthoritativeOverlay(
  authoritative: JourneyMetadata,
  editable: JourneyMetadata,
): JourneyMetadata {
  const authoritativeScreens = new Map(
    (authoritative.graph?.screens ?? []).map((screen) => [screen.id, screen]),
  );
  const authoritativeConnections = new Map(
    (authoritative.graph?.transitions ?? []).map((connection) => [connection.id, connection]),
  );
  const authoritativeFlows = new Map(
    (authoritative.graph?.flows ?? []).map((flow) => [flow.id, flow]),
  );
  return {
    ...structuredClone(authoritative),
    ...structuredClone(editable),
    positions: structuredClone(editable.positions),
    screenTitles: structuredClone(editable.screenTitles),
    edgeLabels: structuredClone(editable.edgeLabels),
    edgeKinds: structuredClone(editable.edgeKinds),
    notes: structuredClone(editable.notes),
    graph: {
      schemaVersion: 1,
      screens: (editable.graph?.screens ?? []).map((screen) => {
        const server = authoritativeScreens.get(screen.id);
        return {
          ...server,
          ...screen,
          ...(screen.observations
            ? { observations: mergeObservations(server?.observations, screen.observations) }
            : {}),
        };
      }),
      transitions: (editable.graph?.transitions ?? []).map((connection) => {
        const server = authoritativeConnections.get(connection.id);
        return {
          ...server,
          ...connection,
          stepIds: structuredClone(server?.stepIds ?? connection.stepIds),
          state: server?.state ?? connection.state,
          ...(server?.evidenceIds ? { evidenceIds: structuredClone(server.evidenceIds) } : {}),
          ...(server?.takeId ? { takeId: server.takeId } : {}),
          ...(server?.videoTakeId ? { videoTakeId: server.videoTakeId } : {}),
          ...(server?.videoClip ? { videoClip: structuredClone(server.videoClip) } : {}),
          ...(server?.review ? { review: structuredClone(server.review) } : {}),
        };
      }),
      flows: (editable.graph?.flows ?? []).map((flow) => ({
        ...authoritativeFlows.get(flow.id),
        ...flow,
      })),
    },
  };
}

export function createJourneyDocument(initial: JourneyMetadata): JourneyDocument {
  let authoritative = structuredClone(initial);
  const doc = safeCollaborativeProjection(initial);
  const localOrigin = Object.freeze({ type: "relay-journey-local-edit" });
  const undo = createCollaborativeJourneyUndoManager(doc, localOrigin, 500);
  const listeners = new Set<JourneyDocumentListener>();

  const read = (): JourneyMetadata =>
    mergeAuthoritativeOverlay(authoritative, materializeCollaborativeJourney(doc));

  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    const value = read();
    for (const listener of listeners) listener(value, origin);
  };
  doc.on("update", onUpdate);

  const replace = (value: JourneyMetadata, origin: unknown = localOrigin): JourneyMetadata => {
    authoritative = structuredClone(value);
    reconcileCollaborativeJourney(doc, value, { origin });
    return read();
  };

  return {
    doc,
    undo,
    localOrigin,
    read,
    replace,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    canUndo: () => undo.undoStack.length > 0,
    canRedo: () => undo.redoStack.length > 0,
    undoOnce: () => {
      undo.undo();
      return read();
    },
    redoOnce: () => {
      undo.redo();
      return read();
    },
    destroy: () => {
      listeners.clear();
      doc.off("update", onUpdate);
      undo.destroy();
      doc.destroy();
    },
  };
}
