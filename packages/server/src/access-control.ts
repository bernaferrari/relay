import { listDeviceLeases, now, type TestJob } from "@relay/core";
import { HttpError } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";

export async function assertTargetControl(scope: RequestContext, targetId?: string): Promise<void> {
  if (!targetId || scope.localTrusted) return;
  const at = now();
  const active = (await listDeviceLeases(scope.projectId)).find(
    (lease) =>
      lease.deviceSerial === targetId &&
      lease.ownerId === scope.subject &&
      lease.status === "leased" &&
      lease.expiresAt > at,
  );
  if (!active) {
    recordAudit(scope, {
      action: "target.control",
      resource: "lease",
      target: targetId,
      result: "deny",
    });
    throw new HttpError(403, "An active lease owned by this caller is required for target control");
  }
  recordAudit(scope, {
    action: "target.control",
    resource: "lease",
    target: targetId,
    result: "allow",
  });
}

export function assertJobAccess(
  scope: RequestContext,
  job: TestJob | undefined,
): asserts job is TestJob {
  if (!job) throw new HttpError(404, "Job not found");
  if (scope.localTrusted) return;
  if (job.projectId !== scope.projectId || job.ownerId !== scope.subject) {
    recordAudit(scope, { action: "job.access", resource: job.id, result: "deny" });
    throw new HttpError(404, "Job not found");
  }
}
