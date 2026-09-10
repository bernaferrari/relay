import type http from "node:http";
import { listDeviceLeases, now } from "@relay/core";
import type { ActorKind } from "@relay/protocol";
import { HttpError } from "./http.js";
import { recordAudit, resolveCommandActor, type RequestContext } from "./security.js";

/**
 * A preview is intentionally not an input lease. A current, organization- and
 * project-scoped lease only proves that this attached target is being shared
 * by the requesting project; it does not need to belong to the viewer and it
 * is never returned to the browser or placed in a URL. Trusted local hosts
 * may observe their attached devices before acquiring any control lease.
 */
export async function livePreviewOperationContext(
  request: http.IncomingMessage,
  scope: RequestContext,
  targetId: string,
) {
  const at = now();
  let actor: { actorId: string; actorKind: ActorKind };
  try {
    actor = resolveCommandActor(request.headers, scope);
  } catch (error) {
    recordAudit(scope, {
      action: "target.preview.open",
      resource: "target",
      target: targetId,
      result: "deny",
    });
    throw new HttpError(403, error instanceof Error ? error.message : String(error));
  }

  const projectSharesTarget = (await listDeviceLeases(scope.projectId)).some(
    (lease) =>
      lease.organizationId === scope.organizationId &&
      lease.deviceSerial === targetId &&
      lease.status === "leased" &&
      lease.expiresAt > at,
  );
  if (!scope.localTrusted && !projectSharesTarget) {
    recordAudit(scope, {
      action: "target.preview.open",
      resource: "target",
      target: targetId,
      result: "deny",
      actorId: actor.actorId,
    });
    throw new HttpError(403, "This target is not shared with the current project");
  }
  recordAudit(scope, {
    action: "target.preview.open",
    resource: "target",
    target: targetId,
    result: "allow",
    actorId: actor.actorId,
  });
  const requestId = crypto.randomUUID();
  return {
    schemaVersion: 1 as const,
    actorId: actor.actorId,
    actorKind: actor.actorKind,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    operationId: "target.stream.open" as const,
    requestId,
    idempotencyKey: requestId,
    issuedAt: at,
  };
}
