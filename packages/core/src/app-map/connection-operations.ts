import { appMapFail } from "./errors.js";
import type { AppMap, AppMapMutationContext, Connection, ConnectionPatch } from "./model.js";
import { mutateAppMap } from "./mutation.js";
import { assertConnection, assertConnectionPatch, identifier } from "./validation-shapes.js";

function scopeFor(map: AppMap) {
  return { organizationId: map.organizationId, projectId: map.projectId, appMapId: map.id };
}

export function putConnection(draft: AppMap, connection: Connection): void {
  assertConnection(connection, scopeFor(draft), "connection");
  if (draft.connections[connection.id]) {
    appMapFail("duplicate-id", `Connection ${connection.id} already exists`);
  }
  draft.connections[connection.id] = structuredClone(connection);
}

export function patchConnection(
  draft: AppMap,
  connectionId: string,
  patch: ConnectionPatch,
  at: number,
): void {
  identifier(connectionId, "connectionId");
  const connection = draft.connections[connectionId];
  if (!connection) {
    appMapFail("missing-reference", `Connection ${connectionId} does not exist`);
  }
  assertConnectionPatch(patch, "connection patch");
  if (patch.fromScreenId !== undefined) connection.fromScreenId = patch.fromScreenId;
  if (patch.destination !== undefined) connection.destination = structuredClone(patch.destination);
  if (patch.label === null) delete connection.label;
  else if (patch.label !== undefined) connection.label = patch.label;
  if (patch.state !== undefined) connection.state = patch.state;
  if (patch.actions !== undefined) connection.actions = structuredClone(patch.actions);
  connection.updatedAt = at;
}

export function dropConnection(draft: AppMap, connectionId: string): void {
  identifier(connectionId, "connectionId");
  if (!draft.connections[connectionId]) {
    appMapFail("missing-reference", `Connection ${connectionId} does not exist`);
  }
  const flow = Object.values(draft.flows).find((item) => item.connectionIds.includes(connectionId));
  if (flow) appMapFail("in-use", `Connection ${connectionId} is used by flow ${flow.id}`);
  const result = Object.values(draft.targetResults).find(
    (item) => item.connectionId === connectionId,
  );
  if (result) {
    appMapFail("in-use", `Connection ${connectionId} is referenced by target result ${result.id}`);
  }
  delete draft.connections[connectionId];
}

export function connectAppMapScreens(
  map: AppMap,
  connection: Connection,
  context: AppMapMutationContext,
): AppMap {
  return mutateAppMap(
    map,
    context,
    {
      eventType: "connection.connected",
      subject: { kind: "connection", id: connection.id },
      summary: `Connected screen ${connection.fromScreenId}`,
    },
    (draft) => putConnection(draft, connection),
  );
}

export function updateAppMapConnection(
  map: AppMap,
  connectionId: string,
  patch: ConnectionPatch,
  context: AppMapMutationContext,
): AppMap {
  return mutateAppMap(
    map,
    context,
    {
      eventType: "connection.updated",
      subject: { kind: "connection", id: connectionId },
      summary: `Updated connection ${connectionId}`,
    },
    (draft) => patchConnection(draft, connectionId, patch, context.at),
  );
}

export function removeAppMapConnection(
  map: AppMap,
  connectionId: string,
  context: AppMapMutationContext,
): AppMap {
  return mutateAppMap(
    map,
    context,
    {
      eventType: "connection.removed",
      subject: { kind: "connection", id: connectionId },
      summary: `Removed connection ${connectionId}`,
    },
    (draft) => dropConnection(draft, connectionId),
  );
}
