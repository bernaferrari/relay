import type { ServerConnection } from "@relay/protocol";

/**
 * Builds the ordinary authenticated project context for a read-only preview
 * request. Preview credentials travel in request headers, never in a stream
 * URL, so browser history, logs, and copied links cannot expose a token or
 * control lease.
 */
export function previewRequestHeaders(
  connection:
    | Pick<ServerConnection, "organizationId" | "projectId" | "actorId" | "actorKind" | "auth">
    | null
    | undefined,
): Record<string, string> {
  if (!connection) return {};
  const headers: Record<string, string> = {
    "X-Organization-Id": connection.organizationId,
    "X-Project-Id": connection.projectId,
    "X-Relay-Actor-Id": connection.actorId,
    "X-Relay-Actor-Kind": connection.actorKind,
  };
  if (connection.auth.type !== "none") {
    headers.Authorization = `Bearer ${connection.auth.token}`;
  }
  return headers;
}
