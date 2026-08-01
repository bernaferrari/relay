import { createHash } from "node:crypto";
import type http from "node:http";
import {
  applyCollaborativeJourneyUpdate,
  createCollaborativeJourneyDoc,
  encodeCollaborativeJourneyUpdate,
  materializeCollaborativeJourney,
} from "@relay/collaboration";
import { currentOperationContext, publish, readJourney } from "@relay/core";
import {
  parseCollaborationAppendInput,
  parseCollaborationAwarenessPublishInput,
  parseCollaborationJourneyInput,
  parseCollaborationSyncInput,
  type CollaborationAppendResponse,
  type CollaborationDocumentResponse,
} from "@relay/protocol";
import * as Y from "yjs";
import {
  CollaborativeJourneyStoreError,
  type CollaborativeJourneyDocumentState,
  type CollaborativeJourneyScope,
  type DurableCollaborativeJourneyStore,
} from "./collaborative-journey-store.js";
import {
  CollaborationAwarenessError,
  CollaborationAwarenessService,
} from "./collaboration-awareness.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { operationRequestContext } from "./operations.js";
import type { RequestContext } from "./security.js";

const MAX_COLLABORATION_BODY_BYTES = 6 * 1024 * 1024;

function publishCollaborationEvent(
  payload: { type: string; at: number } & Record<string, unknown>,
) {
  // @relay/protocol permits extension events; @relay/core's historical host
  // union is narrower even though the same envelope/event bus carries them.
  publish(payload as unknown as Parameters<typeof publish>[0]);
}

export type CollaborationRouteServiceOptions = {
  store: DurableCollaborativeJourneyStore;
  awareness?: CollaborationAwarenessService;
  clock?: () => number;
};

export type CollaborationRouteService = ReturnType<typeof createCollaborationRouteService>;

function bytesFromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function scopeFor(context: RequestContext, journeyId: string): CollaborativeJourneyScope {
  return {
    organizationId: context.organizationId,
    projectId: context.projectId,
    journeyId,
  };
}

function response(
  journeyId: string,
  state: CollaborativeJourneyDocumentState,
  update: Uint8Array = state.documentUpdate,
): CollaborationDocumentResponse {
  return {
    schemaVersion: 1,
    journeyId,
    updateBase64: Buffer.from(update).toString("base64"),
    stateVectorBase64: Buffer.from(state.stateVector).toString("base64"),
    status: state.repairedTailBytes > 0 ? "repaired" : "ready",
    documentBytes: state.documentUpdate.byteLength,
    updateBytes: update.byteLength,
    pendingUpdates: state.uncompactedUpdates,
    repairedTailBytes: state.repairedTailBytes,
  };
}

function syncUpdate(state: CollaborativeJourneyDocumentState, stateVector: Uint8Array): Uint8Array {
  const doc = new Y.Doc({ gc: true });
  try {
    applyCollaborativeJourneyUpdate(doc, state.documentUpdate, "relay:server-sync");
    return encodeCollaborativeJourneyUpdate(doc, stateVector);
  } catch (error) {
    throw new HttpError(
      400,
      `stateVectorBase64 is not a valid Yjs state vector: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    doc.destroy();
  }
}

/**
 * Existing canonical Journeys may legitimately reference executable steps,
 * review, and evidence. Project through the default-stripping materializer
 * before persistence so clients receive only editable canvas authority.
 */
async function safeBootstrapUpdate(projectId: string, journeyId: string): Promise<Uint8Array> {
  const canonical = await readJourney(projectId, journeyId);
  const source = createCollaborativeJourneyDoc(canonical.value);
  try {
    const editable = materializeCollaborativeJourney(source);
    const safe = createCollaborativeJourneyDoc(editable);
    try {
      return encodeCollaborativeJourneyUpdate(safe);
    } finally {
      safe.destroy();
    }
  } finally {
    source.destroy();
  }
}

function mapStoreError(error: unknown): never {
  if (!(error instanceof CollaborativeJourneyStoreError)) throw error;
  switch (error.code) {
    case "invalid-actor":
    case "invalid-scope":
    case "corrupt-document":
      throw new HttpError(400, error.message);
    case "update-too-large":
    case "document-too-large":
      throw new HttpError(413, error.message);
    case "rate-limited":
      throw new HttpError(429, error.message);
    case "forged-authority":
      throw new HttpError(422, error.message);
    case "missing-document":
      throw new HttpError(404, error.message);
    case "corrupt-snapshot":
      throw new HttpError(500, error.message);
  }
}

export function createCollaborationRouteService(options: CollaborationRouteServiceOptions) {
  const awareness =
    options.awareness ?? new CollaborationAwarenessService({ clock: options.clock });
  const clock = options.clock ?? Date.now;
  const clientUpdates = new Map<string, string>();

  const open = async (scope: CollaborativeJourneyScope) => {
    try {
      return await options.store.open(scope);
    } catch (error) {
      if (error instanceof CollaborativeJourneyStoreError && error.code === "missing-document") {
        try {
          return await options.store.open(
            scope,
            await safeBootstrapUpdate(scope.projectId, scope.journeyId),
          );
        } catch (bootstrapError) {
          return mapStoreError(bootstrapError);
        }
      }
      return mapStoreError(error);
    }
  };

  return {
    awareness,
    async bootstrap(scope: CollaborativeJourneyScope): Promise<CollaborationDocumentResponse> {
      return response(scope.journeyId, await open(scope));
    },
    async sync(
      scope: CollaborativeJourneyScope,
      stateVector: Uint8Array,
    ): Promise<CollaborationDocumentResponse> {
      const state = await open(scope);
      return response(scope.journeyId, state, syncUpdate(state, stateVector));
    },
    async append(input: {
      scope: CollaborativeJourneyScope;
      actorId: string;
      update: Uint8Array;
      clientUpdateId: string;
    }): Promise<CollaborationAppendResponse> {
      await open(input.scope);
      const idempotencyScope = `${input.scope.organizationId}\u0000${input.scope.projectId}\u0000${input.scope.journeyId}\u0000${input.actorId}\u0000${input.clientUpdateId}`;
      const updateDigest = digest(input.update);
      const previousDigest = clientUpdates.get(idempotencyScope);
      if (previousDigest && previousDigest !== updateDigest) {
        throw new HttpError(409, "clientUpdateId was already used for a different update");
      }
      if (previousDigest) {
        const state = await open(input.scope);
        return {
          ...response(input.scope.journeyId, state),
          clientUpdateId: input.clientUpdateId,
          applied: false,
          duplicate: true,
        };
      }
      let result;
      try {
        result = await options.store.applyUpdate({
          scope: input.scope,
          actorId: input.actorId,
          update: input.update,
        });
      } catch (error) {
        return mapStoreError(error);
      }
      clientUpdates.set(idempotencyScope, updateDigest);
      return {
        ...response(input.scope.journeyId, result),
        clientUpdateId: input.clientUpdateId,
        applied: result.applied,
        duplicate: result.duplicate,
      };
    },
    async status(scope: CollaborativeJourneyScope): Promise<CollaborationDocumentResponse> {
      return response(scope.journeyId, await open(scope));
    },
    async repair(scope: CollaborativeJourneyScope): Promise<CollaborationDocumentResponse> {
      await open(scope);
      try {
        return response(scope.journeyId, await options.store.compact(scope));
      } catch (error) {
        return mapStoreError(error);
      }
    },
    now: clock,
  };
}

export async function handleCollaborationRoute(input: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  service?: CollaborationRouteService;
}): Promise<boolean> {
  const route = matchPath(input.pathname, "/journeys/:journeyId/collaboration/:action");
  const awarenessRoute = matchPath(input.pathname, "/journeys/:journeyId/collaboration/awareness");
  if (!route && !awarenessRoute) return false;
  if (!input.service) throw new HttpError(404, "Collaboration is disabled for this Relay server");
  const journeyId = (route ?? awarenessRoute)!.journeyId!;
  const scope = scopeFor(input.scope, journeyId);
  const command = operationRequestContext(input.request)?.command;
  if (!command) throw new HttpError(400, "Collaboration requires a canonical operation context");

  if (awarenessRoute) {
    if (input.method === "GET") {
      parseCollaborationJourneyInput({ journeyId });
      json(input.response, 200, {
        journeyId,
        awareness: input.service.awareness.list(scope),
        serverTime: input.service.now(),
      });
      return true;
    }
    if (input.method === "PUT") {
      const body = parseCollaborationAwarenessPublishInput({
        journeyId,
        ...((await parseJsonBody(input.request)) as Record<string, unknown>),
      });
      try {
        const entry = input.service.awareness.publish(scope, command, body);
        publishCollaborationEvent({
          type: "collaboration.awareness.updated",
          at: input.service.now(),
          projectId: scope.projectId,
          journeyId,
          activity: entry.activity,
        });
        json(input.response, 200, { journeyId, awareness: entry });
      } catch (error) {
        if (error instanceof CollaborationAwarenessError) {
          throw new HttpError(error.code === "throttled" ? 429 : 503, error.message);
        }
        throw error;
      }
      return true;
    }
    if (input.method === "DELETE") {
      parseCollaborationJourneyInput({ journeyId });
      const removed = input.service.awareness.disconnect(scope, command.actorId);
      publishCollaborationEvent({
        type: "collaboration.awareness.removed",
        at: input.service.now(),
        projectId: scope.projectId,
        journeyId,
        removed,
      });
      json(input.response, 200, { journeyId, removed });
      return true;
    }
  }

  if (!route) return false;
  if (input.method === "POST" && route.action === "bootstrap") {
    parseCollaborationJourneyInput({ journeyId });
    json(input.response, 200, await input.service.bootstrap(scope));
    return true;
  }
  if (input.method === "POST" && route.action === "sync") {
    const body = parseCollaborationSyncInput({
      journeyId,
      ...((await parseJsonBody(input.request)) as Record<string, unknown>),
    });
    json(
      input.response,
      200,
      await input.service.sync(scope, bytesFromBase64(body.stateVectorBase64)),
    );
    return true;
  }
  if (input.method === "POST" && route.action === "updates") {
    const body = parseCollaborationAppendInput({
      journeyId,
      ...((await parseJsonBody(input.request, MAX_COLLABORATION_BODY_BYTES)) as Record<
        string,
        unknown
      >),
    });
    const result = await input.service.append({
      scope,
      actorId: command.actorId,
      update: bytesFromBase64(body.updateBase64),
      clientUpdateId: body.clientUpdateId,
    });
    publishCollaborationEvent({
      type: "collaboration.document.updated",
      at: input.service.now(),
      projectId: scope.projectId,
      journeyId,
      clientUpdateId: body.clientUpdateId,
      applied: result.applied,
      duplicate: result.duplicate,
      pendingUpdates: result.pendingUpdates,
    });
    json(input.response, 200, result);
    return true;
  }
  if (input.method === "GET" && (route.action === "status" || route.action === "export")) {
    parseCollaborationJourneyInput({ journeyId });
    json(input.response, 200, await input.service.status(scope));
    return true;
  }
  if (input.method === "POST" && route.action === "repair") {
    parseCollaborationJourneyInput({ journeyId });
    const result = await input.service.repair(scope);
    publishCollaborationEvent({
      type: "collaboration.document.repaired",
      at: input.service.now(),
      projectId: scope.projectId,
      journeyId,
      pendingUpdates: result.pendingUpdates,
    });
    json(input.response, 200, result);
    return true;
  }
  return false;
}
