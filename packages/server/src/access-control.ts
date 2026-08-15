import {
  currentOperationContext,
  DEVICE_LEASE_RENEW_UNDER_MS,
  DEVICE_LEASE_TTL_MS,
  getActiveJob,
  getExecutingJobId,
  leaseDevice,
  listDeviceLeases,
  now,
  renewDeviceLease,
  setOperationLease,
  type TestJob,
} from "@relay/core";
import type { DeviceLease } from "@relay/protocol";
import { HttpError } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";

export function localControlSessionOwner(scope: RequestContext): string {
  const key = Buffer.from(`${scope.organizationId}\0${scope.projectId}`, "utf8").toString(
    "base64url",
  );
  return `system:local-control:${key}`;
}

export function targetLeaseBelongsToCaller(
  scope: RequestContext,
  lease: DeviceLease,
  actorId: string,
): boolean {
  return (
    lease.ownerId === actorId ||
    (scope.localTrusted &&
      lease.controlScope === "local-project" &&
      lease.ownerId === localControlSessionOwner(scope))
  );
}

function admitsQueuedRun(operationId: string): boolean {
  return (
    operationId === "action.run" ||
    operationId === "job.start" ||
    operationId === "job.retry" ||
    operationId === "run.replay" ||
    operationId === "step.run" ||
    (operationId.startsWith("app-map.") && operationId.endsWith(".run")) ||
    (operationId.startsWith("job.") && operationId.endsWith(".start"))
  );
}

export async function assertTargetControl(
  scope: RequestContext,
  targetId?: string,
): Promise<DeviceLease> {
  if (!targetId) throw new HttpError(400, "Explicit target identity is required");
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(400, "Actor-aware operation context is required");
  const at = now();
  const activeJob = getActiveJob(targetId);
  if (
    activeJob &&
    getExecutingJobId() !== activeJob.id &&
    !admitsQueuedRun(operation.operationId)
  ) {
    recordAudit(scope, {
      action: "target.control",
      resource: "job",
      target: targetId,
      result: "deny",
    });
    throw new HttpError(409, "This target is reserved by an active automated run", {
      code: "TARGET_CONTROL_RUN_RESERVED",
      targetId,
      jobId: activeJob.id,
      recovery: "Wait for the active run to finish or cancel it before sending manual input.",
    });
  }
  const leases = await listDeviceLeases(scope.projectId);
  let active = leases.find(
    (lease) =>
      lease.deviceSerial === targetId &&
      targetLeaseBelongsToCaller(scope, lease, operation.actorId) &&
      lease.status === "leased" &&
      lease.expiresAt > at,
  );
  if (!active) {
    const conflicting = leases.find(
      (lease) =>
        lease.deviceSerial === targetId && lease.status === "leased" && lease.expiresAt > at,
    );
    if (conflicting) {
      recordAudit(scope, {
        action: "target.control",
        resource: "lease",
        target: targetId,
        result: "deny",
      });
      throw new HttpError(403, "This target is currently controlled by another actor", {
        code: "TARGET_CONTROL_LEASE_CONFLICT",
        targetId,
        actorId: operation.actorId,
        activeLease: {
          id: conflicting.id,
          ownerId: conflicting.ownerId,
          expiresAt: conflicting.expiresAt,
        },
        recovery:
          "Observation remains available. Wait for the lease to expire or request an explicit, audited takeover before sending input.",
        recoveryAction: {
          operationId: "lease.takeover",
          input: { leaseId: conflicting.id },
        },
      });
    }
    if (scope.localTrusted) {
      active = await leaseDevice({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        poolId: "local",
        deviceSerial: targetId,
        ownerId: localControlSessionOwner(scope),
        controlScope: "local-project",
        expiresAt: at + DEVICE_LEASE_TTL_MS,
      });
    } else {
      recordAudit(scope, {
        action: "target.control",
        resource: "lease",
        target: targetId,
        result: "deny",
      });
      throw new HttpError(403, "Take control of this target before sending device input", {
        code: "TARGET_CONTROL_LEASE_REQUIRED",
        targetId,
        actorId: operation.actorId,
        recovery:
          "Create a 2-hour exclusive lease with this same actor, then retry the control command.",
        recoveryAction: {
          operationId: "lease.create",
          input: { poolId: "local", deviceSerial: targetId },
          cli: { argv: ["lease", "create", targetId, "--actor", operation.actorId] },
        },
      });
    }
  }
  if (active.expiresAt - at < DEVICE_LEASE_RENEW_UNDER_MS) {
    active = await renewDeviceLease(active.id, at + DEVICE_LEASE_TTL_MS);
  }
  setOperationLease(active.id, active.ownerId);
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
      targetLeaseBelongsToCaller(scope, lease, operation.actorId) &&
      lease.status === "leased" &&
      lease.expiresAt > at,
  );
  if (!active) throw new HttpError(403, "The live-stream target lease is unavailable");
  setOperationLease(active.id, active.ownerId);
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
