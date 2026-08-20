import type http from "node:http";
import { listDeviceLeases, now } from "@relay/core";
import type { ActorKind } from "@relay/protocol";
import { HttpError } from "./http.js";
import { recordAudit, resolveCommandActor, type RequestContext } from "./security.js";

function actorKindForLeaseOwner(ownerId: string, scope: RequestContext): ActorKind {
  if (!scope.localTrusted) {
    return scope.tokenKind === "external" ? (scope.externalActorKind ?? "human") : "agent";
  }
  if (ownerId.startsWith("agent:")) return "agent";
  if (ownerId.startsWith("system:")) return "system";
  return "human";
}

/**
 * Attribute a live stream to a currently valid target lease before the route
 * commits its streaming response. Keeping this separate prevents the HTTP
 * entry point from owning both request dispatch and lease authorization.
 */
export async function liveStreamOperationContext(
  request: http.IncomingMessage,
  scope: RequestContext,
  targetId: string,
  leaseId: string | undefined,
) {
  const at = now();
  const leases = await listDeviceLeases(scope.projectId);
  const requestedActorHeader = request.headers["x-relay-actor-id"];
  let requestedActor: { actorId: string; actorKind: ActorKind } | undefined;
  if (requestedActorHeader !== undefined || !leaseId) {
    try {
      requestedActor = resolveCommandActor(request.headers, scope);
    } catch (error) {
      throw new HttpError(403, error instanceof Error ? error.message : String(error));
    }
  }
  const lease = leaseId
    ? leases.find(
        (candidate) =>
          candidate.id === leaseId &&
          candidate.deviceSerial === targetId &&
          candidate.status === "leased" &&
          candidate.expiresAt > at,
      )
    : leases.find(
        (candidate) =>
          candidate.deviceSerial === targetId &&
          candidate.ownerId === requestedActor?.actorId &&
          candidate.status === "leased" &&
          candidate.expiresAt > at,
      );
  if (!leaseId && !lease) {
    throw new HttpError(403, "A target lease is required for live streaming");
  }
  const attributable =
    lease &&
    (!requestedActorHeader || requestedActor?.actorId === lease.ownerId) &&
    (scope.localTrusted || lease.ownerId === scope.subject);
  if (!attributable) {
    recordAudit(scope, {
      action: "target.stream",
      resource: "lease",
      target: targetId,
      result: "deny",
    });
    throw new HttpError(403, "The live-stream target lease is unavailable");
  }
  recordAudit(scope, {
    action: "target.stream",
    resource: "lease",
    target: targetId,
    result: "allow",
  });
  const requestId = crypto.randomUUID();
  return {
    schemaVersion: 1 as const,
    actorId: lease.ownerId,
    actorKind: requestedActor?.actorKind ?? actorKindForLeaseOwner(lease.ownerId, scope),
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    operationId: "target.stream.open" as const,
    requestId,
    idempotencyKey: requestId,
    issuedAt: at,
    leaseId: lease.id,
  };
}
