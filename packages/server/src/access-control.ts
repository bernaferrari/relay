import {
  currentOperationContext,
  listDeviceLeases,
  now,
  setOperationLease,
  type TestJob,
} from "@relay/core";
import type { DeviceLease } from "@relay/protocol";
import { HttpError } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";

export async function assertTargetControl(
  scope: RequestContext,
  targetId?: string,
): Promise<DeviceLease> {
  if (!targetId) throw new HttpError(400, "Explicit target identity is required");
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(400, "Actor-aware operation context is required");
  const at = now();
  const active = (await listDeviceLeases(scope.projectId)).find(
    (lease) =>
      lease.deviceSerial === targetId &&
      lease.ownerId === operation.actorId &&
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
  setOperationLease(active.id);
  recordAudit(scope, {
    action: "target.control",
    resource: "lease",
    target: targetId,
    result: "allow",
  });
  return active;
}

/**
 * Read-only target observation is intentionally shareable. Authentication and
 * project scoping are enforced by the request boundary, while the operation
 * context keeps every observation attributable without claiming the exclusive
 * input lease used by taps, typing, recording, and streaming.
 */
export function assertTargetObservation(scope: RequestContext, targetId?: string): string {
  if (!targetId) throw new HttpError(400, "Explicit target identity is required");
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(400, "Actor-aware operation context is required");
  recordAudit(scope, {
    action: "target.observe",
    resource: "target",
    target: targetId,
    result: "allow",
  });
  return targetId;
}

export async function assertTargetLease(
  scope: RequestContext,
  targetId: string,
  leaseId: string | undefined,
): Promise<void> {
  if (!leaseId) throw new HttpError(403, "A target lease is required for live streaming");
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(400, "Actor-aware operation context is required");
  const at = now();
  const active = (await listDeviceLeases(scope.projectId)).find(
    (lease) =>
      lease.id === leaseId &&
      lease.deviceSerial === targetId &&
      lease.ownerId === operation.actorId &&
      lease.status === "leased" &&
      lease.expiresAt > at,
  );
  if (!active) throw new HttpError(403, "The live-stream target lease is unavailable");
  setOperationLease(active.id);
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
