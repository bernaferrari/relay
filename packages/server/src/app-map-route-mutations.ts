import {
  AppMapDomainError,
  connectionIdsFromProposal,
  currentOperationContext,
  IosMutationOutcomeUnknownError,
  appendAppMapTestMutationHistory,
  mutateStoredAppMap,
  now,
  proveConnectionOnDevice,
  readAppMap,
  type ControlStore,
  readAppMapTestMutationHistory,
  restoreAppMapScenarioTest,
  sameAppMapTestContent,
  setAppMapTestHistoryCursor,
  updateAppMapConnection,
  type AppMap,
  type AppMapMutationContext,
} from "@relay/core";
import { assertTargetControl } from "./access-control.js";
import { HttpError } from "./http.js";
import type { RequestContext } from "./security.js";

function domainStatus(error: AppMapDomainError): number {
  if (error.code === "missing-reference") return 404;
  if (
    error.code === "revision-conflict" ||
    error.code === "in-use" ||
    error.code === "proposal-state" ||
    error.code === "duplicate-id" ||
    error.code === "history-empty" ||
    error.code === "history-conflict"
  ) {
    return 409;
  }
  return 400;
}

export type AppMapMutationOptions = {
  preserveTestHistory?: boolean;
  recordTestEdit?: { testId: string; touched: readonly string[] };
  onPersist?: (store: ControlStore, current: AppMap, next: AppMap) => void;
};

function composeMutationOptions(
  projectId: string,
  appMapId: string,
  stableEventId: string,
  options: AppMapMutationOptions | undefined,
): AppMapMutationOptions {
  if (!options?.recordTestEdit) return options ?? {};
  const { testId, touched } = options.recordTestEdit;
  return {
    ...options,
    onPersist(store, current, next) {
      const before = current.tests[testId];
      const after = next.tests[testId];
      if (!before || !after) {
        throw new AppMapDomainError(
          "missing-reference",
          `Test ${testId} disappeared while recording its edit history`,
        );
      }
      appendAppMapTestMutationHistory(store, projectId, appMapId, testId, {
        eventId: stableEventId,
        beforeRevision: current.revision,
        afterRevision: next.revision,
        before: structuredClone(before),
        after: structuredClone(after),
        touched: [...touched],
        at: next.updatedAt,
      });
      options.onPersist?.(store, current, next);
    },
  };
}

export async function applyAppMapMutation(
  scope: RequestContext,
  appMapId: string,
  expectedRevision: number,
  eventId: string | undefined,
  transform: (map: AppMap, context: AppMapMutationContext) => AppMap,
  options?: AppMapMutationOptions,
): Promise<AppMap> {
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(500, "App Map operation context is unavailable");
  const stableEventId = eventId?.trim() || operation.requestId;
  const current = await readAppMap(scope.projectId, appMapId);
  if (!current) throw new HttpError(404, `App Map ${appMapId} not found`);
  if (current.activity[stableEventId]) return current;
  try {
    return await mutateStoredAppMap(
      scope.projectId,
      appMapId,
      (map) =>
        transform(map, {
          expectedRevision,
          eventId: stableEventId,
          actorId: operation.actorId,
          actorKind: operation.actorKind,
          at: Math.max(now(), map.updatedAt),
        }),
      composeMutationOptions(scope.projectId, appMapId, stableEventId, options),
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
  options?: AppMapMutationOptions,
): Promise<AppMap> {
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(500, "App Map operation context is unavailable");
  const stableEventId = eventId?.trim() || operation.requestId;
  const current = await readAppMap(scope.projectId, appMapId);
  if (!current) throw new HttpError(404, `App Map ${appMapId} not found`);
  if (current.activity[stableEventId]) return current;
  try {
    return await mutateStoredAppMap(
      scope.projectId,
      appMapId,
      (map) =>
        transform(map, {
          expectedRevision: map.revision,
          eventId: stableEventId,
          actorId: operation.actorId,
          actorKind: operation.actorKind,
          at: Math.max(now(), map.updatedAt),
        }),
      composeMutationOptions(scope.projectId, appMapId, stableEventId, options),
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

export async function applyAppMapTestHistoryMutation(
  scope: RequestContext,
  appMapId: string,
  testId: string,
  expectedRevision: number,
  eventId: string | undefined,
  direction: "undo" | "redo",
): Promise<AppMap> {
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(500, "App Map operation context is unavailable");
  const stableEventId = eventId?.trim() || operation.requestId;
  const current = await readAppMap(scope.projectId, appMapId);
  if (!current) throw new HttpError(404, `App Map ${appMapId} not found`);
  if (current.activity[stableEventId]) return current;
  let nextCursor: number | undefined;
  try {
    return await mutateStoredAppMap(
      scope.projectId,
      appMapId,
      (map, store) => {
        if (expectedRevision !== map.revision) {
          throw new AppMapDomainError(
            "revision-conflict",
            `Expected App Map revision ${expectedRevision}, current revision is ${map.revision}`,
          );
        }
        const history = readAppMapTestMutationHistory(store, scope.projectId, appMapId, testId);
        const entry = history.entries.find(
          (candidate) =>
            candidate.index === (direction === "undo" ? history.cursor : history.cursor + 1),
        );
        if (!entry) {
          throw new AppMapDomainError(
            "history-empty",
            `No Test edit is available to ${direction} for ${testId}`,
          );
        }
        const expected = direction === "undo" ? entry.after : entry.before;
        const live = map.tests[testId];
        if (!live)
          throw new AppMapDomainError("missing-reference", `Test ${testId} does not exist`);
        if (!sameAppMapTestContent(live, expected)) {
          throw new AppMapDomainError(
            "history-conflict",
            `Test ${testId} changed outside the durable edit history; reload before ${direction}`,
          );
        }
        nextCursor = direction === "undo" ? entry.index - 1 : entry.index;
        return restoreAppMapScenarioTest(
          map,
          testId,
          direction === "undo" ? entry.before : entry.after,
          {
            expectedRevision: map.revision,
            eventId: stableEventId,
            actorId: operation.actorId,
            actorKind: operation.actorKind,
            at: Math.max(now(), map.updatedAt),
          },
          direction,
          entry.touched,
        );
      },
      {
        preserveTestHistory: true,
        onPersist(store, _before, next) {
          if (nextCursor === undefined) throw new Error("Test history cursor was not selected");
          setAppMapTestHistoryCursor(
            store,
            scope.projectId,
            appMapId,
            testId,
            nextCursor,
            next.updatedAt,
          );
        },
      },
    );
  } catch (error) {
    if (error instanceof AppMapDomainError) {
      throw new HttpError(domainStatus(error), error.message, {
        code: error.code,
        recovery:
          error.code === "revision-conflict"
            ? "Reload the App Map and retry against its current revision."
            : "Reload the Test and retry the requested history operation.",
        current: await readAppMap(scope.projectId, appMapId),
      });
    }
    throw error;
  }
}

export type ApprovedProposalProofResult = {
  appMap: AppMap;
  /**
   * The proposal has already been approved, but this exact proof pass cannot
   * safely continue. The caller must surface the one-command review package
   * and must not attempt another connection in the proposal.
   */
  terminal?: {
    connectionId: string;
    error: IosMutationOutcomeUnknownError;
  };
};

export async function proveApprovedProposal(
  scope: RequestContext,
  appMapId: string,
  proposalId: string,
  body: { eventId?: string; serial?: string; prove?: boolean },
  appMap: AppMap,
): Promise<ApprovedProposalProofResult> {
  const serial = body.serial?.trim();
  if (!serial || body.prove === false) return { appMap };
  await assertTargetControl(scope, serial);
  const proposal = appMap.proposals[proposalId];
  let next = appMap;
  for (const connectionId of proposal ? connectionIdsFromProposal(proposal) : []) {
    const connection = next.connections[connectionId];
    if (!connection?.navigation) continue;
    let proof;
    try {
      proof = await proveConnectionOnDevice({ serial, connection });
    } catch (error) {
      if (error instanceof IosMutationOutcomeUnknownError) {
        return { appMap: next, terminal: { connectionId, error } };
      }
      throw error;
    }
    if (!proof.proven) continue;
    next = await applyRebasableAppMapMutation(
      scope,
      appMapId,
      `${body.eventId ?? "keep"}:${connectionId}:ready`,
      (map, context) => updateAppMapConnection(map, connectionId, { state: "ready" }, context),
    );
  }
  return { appMap: next };
}
