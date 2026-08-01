import type { RelayClient } from "@relay/client";
import type {
  CollaborationAwarenessListResponse,
  CollaborationAwarenessPublishInput,
  CollaborationAwarenessRemoveResponse,
  CollaborationAwarenessResponse,
  CollaborationDocumentResponse,
  EventEnvelope,
} from "@relay/protocol";
import type {
  CollaborationHandshakeRequest,
  CollaborationPushRequest,
  CollaborationTransport,
  CollaborationUpdate,
} from "./collaboration-provider";

const EMPTY_YJS_UPDATE_BYTES = 2;

type RelayCollaborationClient = Pick<
  RelayClient,
  | "syncCollaboration"
  | "appendCollaborationUpdate"
  | "exportCollaboration"
  | "publishCollaborationAwareness"
  | "collaborationAwareness"
  | "removeCollaborationAwareness"
> & {
  connection: RelayClient["connection"];
  events?: RelayClient["events"];
};

export type RelayCollaborationTransportOptions = Readonly<{
  pollingFallbackMs?: number;
}>;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

export function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function assertScope(client: RelayCollaborationClient, projectId: string): void {
  if (client.connection.projectId !== projectId) {
    throw new Error(
      `Collaboration scope ${projectId} does not match client scope ${client.connection.projectId}`,
    );
  }
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError();
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function responseUpdate(
  response: CollaborationDocumentResponse,
  id: string,
): CollaborationUpdate[] {
  const bytes = bytesFromBase64(response.updateBase64);
  return bytes.byteLength > EMPTY_YJS_UPDATE_BYTES ? [{ id, bytes }] : [];
}

function isJourneyEvent(event: EventEnvelope, journeyId: string): boolean {
  const payload = event.payload as Record<string, unknown>;
  return (
    (payload.type === "collaboration.document.updated" ||
      payload.type === "collaboration.document.repaired") &&
    payload.journeyId === journeyId
  );
}

/** RelayClient adapter; base64 exists only at this HTTP operation boundary. */
export function createRelayCollaborationTransport(
  client: RelayCollaborationClient,
  options: RelayCollaborationTransportOptions = {},
): CollaborationTransport {
  const pollingFallbackMs = Math.max(250, options.pollingFallbackMs ?? 2_000);
  return {
    async handshake(request: CollaborationHandshakeRequest) {
      assertScope(client, request.scope.projectId);
      const response = await abortable(
        client.syncCollaboration(request.scope.journeyId, bytesToBase64(request.stateVector)),
        request.signal,
      );
      return {
        stateVector: bytesFromBase64(response.stateVectorBase64),
        updates: responseUpdate(response, `server:sync:${response.pendingUpdates}`),
      };
    },
    async push(request: CollaborationPushRequest) {
      assertScope(client, request.scope.projectId);
      const acknowledgedUpdateIds: string[] = [];
      for (const update of request.updates) {
        if (request.signal.aborted) throw abortError();
        const response = await client.appendCollaborationUpdate(
          request.scope.journeyId,
          bytesToBase64(update.bytes),
          update.id,
          { signal: request.signal },
        );
        if (response.applied || response.duplicate) acknowledgedUpdateIds.push(update.id);
      }
      return { acknowledgedUpdateIds };
    },
    subscribe(scope, listener, onDisconnect) {
      assertScope(client, scope.projectId);
      const controller = new AbortController();
      let closed = false;
      let refreshing = false;
      let refreshAgain = false;
      let timer: ReturnType<typeof setInterval> | undefined;

      const disconnect = (error?: unknown) => {
        if (closed) return;
        closed = true;
        controller.abort();
        if (timer) clearInterval(timer);
        onDisconnect(error);
      };
      const refresh = async (id: string) => {
        if (closed) return;
        if (refreshing) {
          refreshAgain = true;
          return;
        }
        refreshing = true;
        try {
          const response = await client.exportCollaboration(scope.journeyId);
          for (const update of responseUpdate(response, id)) listener(update);
        } catch (error) {
          disconnect(error);
        } finally {
          refreshing = false;
          if (refreshAgain && !closed) {
            refreshAgain = false;
            void refresh(`${id}:coalesced`);
          }
        }
      };

      if (client.events) {
        void client
          .events(
            (event) => {
              if (isJourneyEvent(event, scope.journeyId)) void refresh(event.eventId);
            },
            {
              signal: controller.signal,
              onGap: (event) => void refresh(`${event.eventId}:gap`),
            },
          )
          .then(() => disconnect(new Error("Relay collaboration event stream closed")))
          .catch((error: unknown) => {
            if (!controller.signal.aborted) disconnect(error);
          });
      } else {
        // Older/custom clients can still collaborate with one bounded poll.
        timer = setInterval(() => void refresh(`server:poll:${Date.now()}`), pollingFallbackMs);
      }

      return {
        close() {
          if (closed) return;
          closed = true;
          controller.abort();
          if (timer) clearInterval(timer);
        },
      };
    },
  };
}

export interface RelayAwarenessTransport {
  readonly actorId: string;
  publish(input: CollaborationAwarenessPublishInput): Promise<CollaborationAwarenessResponse>;
  list(journeyId: string): Promise<CollaborationAwarenessListResponse>;
  remove(journeyId: string): Promise<CollaborationAwarenessRemoveResponse>;
}

export function createRelayAwarenessTransport(
  client: RelayCollaborationClient,
): RelayAwarenessTransport {
  return {
    actorId: client.connection.actorId,
    publish: (input) => client.publishCollaborationAwareness(input),
    list: (journeyId) => client.collaborationAwareness(journeyId),
    remove: (journeyId) => client.removeCollaborationAwareness(journeyId),
  };
}
