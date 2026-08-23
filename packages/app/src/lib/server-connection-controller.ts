import { createSignal } from "solid-js";
import { RelayClient } from "@relay/client";
import type {
  OperationId,
  OperationInput,
  OperationOutput,
  ServerConnection,
} from "@relay/protocol";
import type { Platform } from "../context/platform";
import { normalizeLocalBase } from "./api";
import { previewRequestHeaders as buildPreviewRequestHeaders } from "./preview-request-headers";

export function createServerConnectionController(input: {
  platform: Platform;
  beforeServerChange: () => void;
  afterServerChange: () => void;
}) {
  const [serverUrl, setServerUrlState] = createSignal("");
  const [actorId, setActorId] = createSignal("");
  let connection: ServerConnection | null = null;
  let client: RelayClient | null = null;

  async function fallbackActorId(): Promise<string> {
    const sessionKey = "relay:actorId";
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(sessionKey);
    } catch {
      stored = await input.platform.storage.get("actorId");
    }
    if (stored?.startsWith("human:") && stored.length <= 128) return stored;
    const created = `human:${crypto.randomUUID()}`;
    try {
      sessionStorage.setItem(sessionKey, created);
    } catch {
      await input.platform.storage.set("actorId", created);
    }
    return created;
  }

  async function resolveConnection(): Promise<ServerConnection> {
    connection = input.platform.getServerConnection
      ? await input.platform.getServerConnection()
      : {
          url: await input.platform.getServerUrl(),
          auth: { type: "none" },
          organizationId: "local",
          projectId: "default",
          actorId: await fallbackActorId(),
          actorKind: "human",
        };
    connection = { ...connection, url: normalizeLocalBase(connection.url) };
    client = new RelayClient(connection, { fetch: input.platform.fetch ?? fetch });
    setServerUrlState(connection.url);
    setActorId(connection.actorId);
    return connection;
  }

  async function setServerUrl(url: string): Promise<void> {
    const next = normalizeLocalBase(url);
    setServerUrlState(next);
    if (!connection) await resolveConnection();
    connection = { ...(connection as ServerConnection), url: next };
    client = new RelayClient(connection, { fetch: input.platform.fetch ?? fetch });
    input.beforeServerChange();
    if (input.platform.setServerConnection) {
      await input.platform.setServerConnection(connection);
    } else {
      await input.platform.setServerUrl?.(next);
    }
    input.afterServerChange();
  }

  async function request<T = unknown>(
    path: string,
    init?: RequestInit,
    timeoutMs = 20_000,
  ): Promise<T> {
    if (!client) await resolveConnection();
    return client!.resource<T>(path, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    });
  }

  async function connectedClient(): Promise<RelayClient> {
    if (!client) await resolveConnection();
    return client!;
  }

  async function runAction<Id extends OperationId>(
    operationId: Id,
    operationInput: OperationInput<Id>,
  ): Promise<OperationOutput<Id>> {
    const connected = await connectedClient();
    return connected.invoke(operationId, operationInput, {
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
    });
  }

  return {
    serverUrl,
    actorId,
    resolveConnection,
    setServerUrl,
    request,
    connectedClient,
    runAction,
    previewRequestHeaders: () => buildPreviewRequestHeaders(connection),
    currentClient: () => client,
    currentConnection: () => connection,
    projectId: () => connection?.projectId ?? "default",
  };
}
