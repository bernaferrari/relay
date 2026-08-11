import {
  APP_MAP_COLLABORATION_DOCUMENT_VERSION,
  APP_MAP_SCHEMA_VERSION,
  type AppMap,
  type AppMapBatchChange,
  type AppMapCanvasCollaborationEntities,
  type AppMapCollaborationChange,
  type AppMapCollaborationDocument,
  type ConnectionPresentation,
  type ConnectionPresentationPatch,
} from "./model.js";
import { appMapFail } from "./errors.js";
import { validateAppMap } from "./validation.js";

/**
 * A provider-neutral serialization boundary for live canvas collaboration.
 *
 * Yjs is deliberately not a dependency of core: an adapter converts each
 * record in `entities` into Y.Maps/Y.Arrays (or an equivalent CRDT shape),
 * while Relay validates and persists only field-level intents through the
 * ordinary App Map mutation path. This prevents a stale document snapshot
 * from replacing a whole graph or carrying execution authority.
 */
export function appMapToCollaborationDocument(value: AppMap): AppMapCollaborationDocument {
  const map = validateAppMap(value);
  return {
    format: "relay.app-map-authoring",
    formatVersion: APP_MAP_COLLABORATION_DOCUMENT_VERSION,
    schemaVersion: APP_MAP_SCHEMA_VERSION,
    id: map.id,
    organizationId: map.organizationId,
    projectId: map.projectId,
    createdAt: map.createdAt,
    entities: collaborationEntitiesFor(map),
  };
}

/**
 * Converts one merged provider transaction into ordinary App Map changes.
 * The caller submits these through `app-map.commit`, where the server assigns
 * timestamps and rejects missing references. Do not materialize a CRDT
 * snapshot by replacing `AppMap` collections—independent remote edits would
 * otherwise be deleted by stale local state.
 */
export function collaborationChangesToBatchChanges(
  value: AppMap,
  changes: readonly AppMapCollaborationChange[],
  at: number,
): AppMapBatchChange[] {
  const map = validateAppMap(value);
  if (!Number.isFinite(at)) appMapFail("invalid-map", "collaboration change timestamp is invalid");
  return changes.map((change): AppMapBatchChange => {
    switch (change.kind) {
      case "note.save": {
        const existing = map.notes[change.id];
        return {
          kind: "note.save",
          note: {
            id: change.id,
            organizationId: map.organizationId,
            projectId: map.projectId,
            appMapId: map.id,
            text: change.text,
            position: structuredClone(change.position),
            createdAt: existing?.createdAt ?? at,
            updatedAt: at,
          },
        };
      }
      case "note.remove":
        return { kind: "note.remove", noteId: change.noteId };
      case "group.save": {
        const existing = map.groups[change.id];
        return {
          kind: "group.save",
          group: {
            id: change.id,
            organizationId: map.organizationId,
            projectId: map.projectId,
            appMapId: map.id,
            name: change.name,
            screenIds: [...change.screenIds],
            createdAt: existing?.createdAt ?? at,
            updatedAt: at,
          },
        };
      }
      case "group.remove":
        return { kind: "group.remove", groupId: change.groupId };
      case "screen.layout":
        return {
          kind: "screen.update",
          screenId: change.screenId,
          input: { patch: { position: change.position ? structuredClone(change.position) : null } },
        };
      case "connection.presentation":
        return {
          kind: "connection.update",
          connectionId: change.connectionId,
          patch: {
            presentation:
              "reset" in change
                ? null
                : mergeConnectionPresentation(
                    map.connections[change.connectionId]?.presentation,
                    change.patch,
                  ),
          },
        };
    }
  });
}

function mergeConnectionPresentation(
  current: ConnectionPresentation | undefined,
  patch: ConnectionPresentationPatch,
): ConnectionPresentation | null {
  const next = structuredClone(current ?? {}) as ConnectionPresentation;
  for (const [field, value] of Object.entries(patch)) {
    if (value === null) {
      delete (next as Record<string, unknown>)[field];
    } else if (value !== undefined) {
      (next as Record<string, unknown>)[field] = structuredClone(value);
    }
  }
  return Object.keys(next).length ? next : null;
}

/** Returns a fresh, stable-id keyed canvas entity map suitable for a CRDT root. */
export function collaborationEntitiesFor(map: AppMap): AppMapCanvasCollaborationEntities {
  return {
    notes: Object.fromEntries(
      Object.values(map.notes).map((note) => [
        note.id,
        { id: note.id, text: note.text, position: structuredClone(note.position) },
      ]),
    ),
    groups: Object.fromEntries(
      Object.values(map.groups).map((group) => [
        group.id,
        { id: group.id, name: group.name, screenIds: [...group.screenIds] },
      ]),
    ),
    screenLayouts: Object.fromEntries(
      Object.values(map.screens).map((screen) => [
        screen.id,
        { id: screen.id, position: screen.position ? structuredClone(screen.position) : null },
      ]),
    ),
    connectionPresentations: Object.fromEntries(
      Object.values(map.connections).map((connection) => [
        connection.id,
        {
          id: connection.id,
          presentation: connection.presentation ? structuredClone(connection.presentation) : null,
        },
      ]),
    ),
  };
}
