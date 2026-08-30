import { createHash } from "node:crypto";
import type { ChangeVerificationScope } from "@relay/core";
import type { RequestContext } from "./security.js";

export function changeVerificationScope(scope: RequestContext): ChangeVerificationScope {
  return { organizationId: scope.organizationId, projectId: scope.projectId };
}

export function scopedChangeProofId(scope: RequestContext, requestId: string): string {
  const digest = createHash("sha256")
    .update(scope.organizationId, "utf8")
    .update("\0")
    .update(scope.projectId, "utf8")
    .update("\0")
    .update(requestId, "utf8")
    .digest("hex");
  return `proof_${digest}`;
}
