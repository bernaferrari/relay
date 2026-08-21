import {
  currentOperationContext,
  DEVICE_LEASE_RENEW_UNDER_MS,
  DEVICE_LEASE_TTL_MS,
  getActiveJob,
  getExecutingJobId,
  operationOwnsHumanIntervention,
  recordHumanInterventionAuthorization,
  leaseDevice,
  listDeviceLeases,
  now,
  renewDeviceLease,
  setOperationLease,
  setOperationIntervention,
  type OperationContext,
  type TestJob,
} from "@relay/core";
import type { DeviceLease } from "@relay/protocol";
import { HttpError } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";
import { runWithTargetControlAdmissionLock } from "./target-control-admission-lock.js";
import { noteTargetLeaseControlUse } from "./target-lease-admission-state.js";

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

const HUMAN_INTERVENTION_OPERATIONS = new Set([
  "target.interact",
  "target.do",
  "target.ui.back",
  "target.ui.scrollCollect",
  "target.touch",
  "target.key",
  "target.scroll",
  "step.run",
  "authoring.session.interact",
  "app-map.teach",
  "discovery.interact",
]);

export function humanInterventionControlGrant(job: TestJob, operation: OperationContext) {
  return HUMAN_INTERVENTION_OPERATIONS.has(operation.operationId)
    ? operationOwnsHumanIntervention(job, operation)
    : undefined;
}

export type TargetControlAdmission = {
  lease: DeviceLease;
  /** Exact provenance from the atomic lease-create branch. Callers must never
   * infer this from a prior list snapshot. */
  createdByThisCall: boolean;
};

/** Acquire or reuse target control while retaining exact lease provenance for
 * a compensating multi-target admission. */
async function admitTargetControlUnlocked(
  scope: RequestContext,
  targetId?: string,
): Promise<TargetControlAdmission> {
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
    const ownedIntervention = humanInterventionControlGrant(activeJob, operation);
    if (!ownedIntervention) {
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
        recovery:
          activeJob.status === "paused"
            ? "Only the run's owning actor may teach or repair the target at its explicit intervention checkpoint."
            : "Wait for the active run to request intervention, finish, or cancel it before sending manual input.",
      });
    }
    setOperationIntervention(activeJob.id, ownedIntervention.requestCapturedAt);
    recordHumanInterventionAuthorization(activeJob, operation, ownedIntervention.requestCapturedAt);
    recordAudit(scope, {
      action: "target.intervention",
      resource: activeJob.id,
      target: targetId,
      result: "allow",
    });
  }
  const leases = await listDeviceLeases(scope.projectId);
  let createdByThisCall = false;
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
      createdByThisCall = true;
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
  noteTargetLeaseControlUse(active.id);
  return { lease: active, createdByThisCall };
}

/**
 * Serialize every local control acquisition with campaign lease admission.
 * This prevents a normal control request from reusing a newly minted lease in
 * the interval before an atomic campaign either seals or compensates it.
 */
export function admitTargetControl(
  scope: RequestContext,
  targetId?: string,
): Promise<TargetControlAdmission> {
  return runWithTargetControlAdmissionLock(scope, () =>
    admitTargetControlUnlocked(scope, targetId),
  );
}

export async function assertTargetControl(
  scope: RequestContext,
  targetId?: string,
): Promise<DeviceLease> {
  return (await admitTargetControl(scope, targetId)).lease;
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
