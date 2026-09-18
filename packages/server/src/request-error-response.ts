import type http from "node:http";
import { IdempotencyConflict, now, publish } from "@relay/core";
import { RevisionConflict } from "@relay/protocol";
import { OperationAuthorizationError, OperationContractError } from "./operations.js";
import { HttpError, json } from "./http.js";
import type { RequestContext } from "./security.js";

/**
 * Convert request failures into the stable HTTP error shapes exposed by Relay.
 * Streaming routes may have committed their response already, so the helper
 * also owns the fail-closed response guard used by every request path.
 */
export function respondToRequestError(
  error: unknown,
  response: http.ServerResponse,
  scope?: RequestContext,
): void {
  if (response.headersSent || response.destroyed || response.writableEnded) {
    if (!response.destroyed && !response.writableEnded) response.destroy();
    return;
  }
  if (error instanceof RevisionConflict) {
    json(response, 409, { error: error.message, current: error.current });
    return;
  }
  if (error instanceof IdempotencyConflict) {
    json(response, 409, { error: error.message });
    return;
  }
  if (error instanceof OperationAuthorizationError) {
    json(response, 403, {
      error: error.message,
      code: "PROJECT_ROLE_REQUIRED",
      operationId: error.operationId,
      role: error.actualRole,
      requiredRole: error.requiredRole,
      recovery:
        "Use a Relay connection whose configured project role permits this operation, or ask a project administrator to perform it.",
    });
    return;
  }
  if (error instanceof OperationContractError) {
    const status = error.phase === "input" ? 400 : 500;
    const message =
      status === 500 && scope && !scope.localTrusted ? "Internal server error" : error.message;
    json(response, status, { error: message });
    return;
  }
  if (error instanceof HttpError) {
    // Structured context augments the human-readable failure; clients key off
    // `error`, so omitting it makes replay failures opaque.
    json(response, error.status, { error: error.message, ...error.body });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  publish({ type: "error", at: now(), message, where: "server" });
  json(response, 500, {
    error: scope && !scope.localTrusted ? "Internal server error" : message,
  });
}
