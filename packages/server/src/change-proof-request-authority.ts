import type { ChangeProofExecutionRequestAuthority, OperationContext } from "@relay/core";
import type { RequestContext } from "./security.js";

/** Capture the exact authenticated request boundary used to admit proof.run.
 * This durable projection is intentionally narrower than RequestContext. */
export function changeProofExecutionRequestAuthority(
  scope: RequestContext,
  operation: OperationContext | undefined,
): ChangeProofExecutionRequestAuthority {
  return {
    subject: scope.subject,
    allowedProjects: [...scope.allowedProjects],
    tokenKind: scope.tokenKind,
    localTrusted: scope.localTrusted,
    role: scope.role,
    actorKind: operation?.actorKind ?? "agent",
    ...(scope.externalActorKind ? { externalActorKind: scope.externalActorKind } : {}),
    ...(operation?.leaseId
      ? {
          leaseId: operation.leaseId,
          ...(operation.leaseOwnerId ? { leaseOwnerId: operation.leaseOwnerId } : {}),
        }
      : {}),
  };
}
