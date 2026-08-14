import {
  AppMapDomainError,
  currentOperationContext,
  mutateStoredAppMap,
  now,
  readAppMap,
  type AppMap,
  type AppMapMutationContext,
} from "@relay/core";
import { HttpError } from "./http.js";
import type { RequestContext } from "./security.js";

function domainStatus(error: AppMapDomainError): number {
  if (error.code === "missing-reference") return 404;
  if (
    error.code === "revision-conflict" ||
    error.code === "in-use" ||
    error.code === "proposal-state" ||
    error.code === "duplicate-id"
  ) {
    return 409;
  }
  return 400;
}

export async function applyAppMapMutation(
  scope: RequestContext,
  appMapId: string,
  expectedRevision: number,
  eventId: string | undefined,
  transform: (map: AppMap, context: AppMapMutationContext) => AppMap,
): Promise<AppMap> {
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(500, "App Map operation context is unavailable");
  const stableEventId = eventId?.trim() || operation.requestId;
  const current = await readAppMap(scope.projectId, appMapId);
  if (!current) throw new HttpError(404, `App Map ${appMapId} not found`);
  if (current.activity[stableEventId]) return current;
  try {
    return await mutateStoredAppMap(scope.projectId, appMapId, (map) =>
      transform(map, {
        expectedRevision,
        eventId: stableEventId,
        actorId: operation.actorId,
        actorKind: operation.actorKind,
        at: Math.max(now(), map.updatedAt),
      }),
    );
  } catch (error) {
    if (error instanceof AppMapDomainError) {
      throw new HttpError(domainStatus(error), error.message, {
        code: error.code,
        error: error.message,
        recovery:
          error.code === "revision-conflict"
            ? "Reload the App Map and retry against its current revision."
            : "Inspect the referenced App Map entities and retry.",
        current,
      });
    }
    throw error;
  }
}

/** Proposal work can move across unrelated revisions. The domain layer checks
 * entity conflicts; this wrapper keeps the final write atomic. */
export async function applyRebasableAppMapMutation(
  scope: RequestContext,
  appMapId: string,
  eventId: string | undefined,
  transform: (map: AppMap, context: AppMapMutationContext) => AppMap,
): Promise<AppMap> {
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(500, "App Map operation context is unavailable");
  const stableEventId = eventId?.trim() || operation.requestId;
  const current = await readAppMap(scope.projectId, appMapId);
  if (!current) throw new HttpError(404, `App Map ${appMapId} not found`);
  if (current.activity[stableEventId]) return current;
  try {
    return await mutateStoredAppMap(scope.projectId, appMapId, (map) =>
      transform(map, {
        expectedRevision: map.revision,
        eventId: stableEventId,
        actorId: operation.actorId,
        actorKind: operation.actorKind,
        at: Math.max(now(), map.updatedAt),
      }),
    );
  } catch (error) {
    if (error instanceof AppMapDomainError) {
      throw new HttpError(domainStatus(error), error.message, {
        code: error.code,
        recovery:
          error.code === "revision-conflict"
            ? "Review the conflicting screen or connection, then update the proposal."
            : "Inspect the referenced App Map entities and retry.",
        current: await readAppMap(scope.projectId, appMapId),
      });
    }
    throw error;
  }
}
