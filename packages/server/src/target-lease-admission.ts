import { randomUUID } from "node:crypto";
import {
  listDeviceLeases,
  releaseDeviceLease,
  requireOperationContext,
  runWithOperationContext,
} from "@relay/core";
import { admitTargetControl, type TargetControlAdmission } from "./access-control.js";
import type { RequestContext } from "./security.js";
import { runWithTargetControlAdmissionLock } from "./target-control-admission-lock.js";
import {
  clearPendingTargetLease,
  markPendingTargetLease,
  runWithTargetLeaseAdmission,
  targetLeaseHasExternalPendingUse,
} from "./target-lease-admission-state.js";

export type AdmittedTargetLease = TargetControlAdmission["lease"];

type TargetLeaseAttempt =
  | {
      status: "accepted";
      targetId: string;
      lease: AdmittedTargetLease;
      createdByThisCall: boolean;
    }
  | { status: "rejected"; targetId: string; error: unknown };

type PendingLeaseClaim = {
  users: Set<string>;
  committed: boolean;
  lease: AdmittedTargetLease;
  scope: RequestContext;
  releaseDeviceLease: typeof releaseDeviceLease;
};

/**
 * Relay's local control store is shared by one server process. Every target
 * control acquisition and campaign admission shares the short project lock,
 * so an external control request cannot reuse a lease between its creation
 * and admission tracking. This does not serialize target execution; the
 * scheduler still runs independent devices in parallel after admission commits.
 */
const pendingLeaseClaims = new Map<string, PendingLeaseClaim>();

async function releaseLeases(input: {
  scope: RequestContext;
  releaseDeviceLease: typeof releaseDeviceLease;
  leases: readonly AdmittedTargetLease[];
}): Promise<void> {
  const cleanup = await Promise.allSettled(
    input.leases.map((lease) =>
      input.releaseDeviceLease(lease.id, {
        projectId: input.scope.projectId,
        ownerId: lease.ownerId,
      }),
    ),
  );
  const cleanupFailure = cleanup.find((result) => result.status === "rejected");
  if (cleanupFailure?.status === "rejected") {
    const message =
      cleanupFailure.reason instanceof Error
        ? cleanupFailure.reason.message
        : String(cleanupFailure.reason);
    throw new Error(
      `Target admission failed and Relay could not release a newly acquired lease: ${message}`,
    );
  }
}

export type TargetLeaseAdmission = {
  leasesByTargetId: Map<string, AdmittedTargetLease>;
  /** Only these leases were minted by this admission and can be compensated. */
  newlyMintedLeases: AdmittedTargetLease[];
  /** Mark the accepted lease use durable after the caller has made its queue
   * or campaign record durable. This keeps rollback armed until jobs have
   * also been made visible in the in-memory registry. */
  commit(): Promise<void>;
  /** Seal a durably recorded, activated batch immediately before its
   * no-throw scheduler dispatch. After this point normal job lifecycle owns
   * the lease rather than admission compensation. */
  finalize(): Promise<void>;
  /** Compensate a failed post-admission write. A lease reused by another
   * accepted admission is retained rather than being stolen from that work. */
  rollback(): Promise<void>;
};

async function acquireTargetLeasesWhileLocked(input: {
  scope: RequestContext;
  targetIds: readonly string[];
  listDeviceLeases: typeof listDeviceLeases;
  admitTargetControl: typeof admitTargetControl;
  releaseDeviceLease: typeof releaseDeviceLease;
}): Promise<TargetLeaseAdmission> {
  const targetIds = [
    ...new Set(input.targetIds.map((targetId) => targetId.trim()).filter(Boolean)),
  ];
  if (!targetIds.length) throw new Error("Target admission requires at least one target");
  const operation = requireOperationContext();
  const admissionId = randomUUID();
  const trackedLeaseIds = new Set<string>();
  const attempts = await Promise.all(
    targetIds.map(async (targetId): Promise<TargetLeaseAttempt> => {
      try {
        // Target control records lease provenance in its async context. Each
        // target gets a copy so one control result cannot overwrite a
        // different cell's frozen lease provenance.
        const control = await runWithTargetLeaseAdmission(admissionId, () =>
          runWithOperationContext({ ...operation }, () =>
            input.admitTargetControl(input.scope, targetId),
          ),
        );
        const pending = pendingLeaseClaims.get(control.lease.id);
        if (pending) {
          pending.users.add(admissionId);
          trackedLeaseIds.add(control.lease.id);
        } else if (control.createdByThisCall) {
          pendingLeaseClaims.set(control.lease.id, {
            users: new Set([admissionId]),
            committed: false,
            lease: control.lease,
            scope: input.scope,
            releaseDeviceLease: input.releaseDeviceLease,
          });
          markPendingTargetLease(control.lease.id);
          trackedLeaseIds.add(control.lease.id);
        }
        return {
          status: "accepted",
          targetId,
          lease: control.lease,
          createdByThisCall: control.createdByThisCall,
        };
      } catch (error) {
        return { status: "rejected", targetId, error };
      }
    }),
  );
  const rejected = attempts.find((attempt) => attempt.status === "rejected");
  const accepted = attempts.filter(
    (attempt): attempt is Extract<TargetLeaseAttempt, { status: "accepted" }> =>
      attempt.status === "accepted",
  );
  const newlyMintedLeases = accepted
    .filter((attempt) => attempt.createdByThisCall)
    .map((attempt) => attempt.lease);
  const settleWhileLocked = async (committed: boolean): Promise<void> => {
    const releasable: PendingLeaseClaim[] = [];
    for (const leaseId of trackedLeaseIds) {
      const claim = pendingLeaseClaims.get(leaseId);
      if (!claim) continue;
      claim.users.delete(admissionId);
      if (committed) claim.committed = true;
      const finalUser = claim.users.size === 0;
      const finalUncommittedUser = !committed && !claim.committed && finalUser;
      if (finalUncommittedUser && !targetLeaseHasExternalPendingUse(leaseId)) {
        releasable.push(claim);
        pendingLeaseClaims.delete(leaseId);
        clearPendingTargetLease(leaseId);
      } else if (finalUser) {
        // A normal target-control caller observed this still-pending lease.
        // Its work has no admission claim to join, so retaining the lease is
        // safer than revoking control from that caller during compensation.
        pendingLeaseClaims.delete(leaseId);
        clearPendingTargetLease(leaseId);
      }
    }
    if (releasable.length) {
      await Promise.all(
        releasable.map((claim) =>
          releaseLeases({
            scope: claim.scope,
            releaseDeviceLease: claim.releaseDeviceLease,
            leases: [claim.lease],
          }),
        ),
      );
    }
  };
  let settlement: Promise<void> | undefined;
  let persisted = false;
  const settle = (committed: boolean) =>
    (settlement ??= runWithTargetControlAdmissionLock(input.scope, () =>
      settleWhileLocked(committed),
    ));
  if (rejected) {
    // This function is already inside the shared control-admission lock;
    // re-entering it would queue cleanup behind its own caller.
    await settleWhileLocked(false);
    throw rejected.error;
  }
  return {
    leasesByTargetId: new Map(accepted.map(({ targetId, lease }) => [targetId, lease])),
    newlyMintedLeases: [...newlyMintedLeases],
    commit: async () => {
      if (settlement) return settlement;
      persisted = true;
    },
    finalize: () => {
      if (!persisted) {
        throw new Error("Target admission must commit its durable record before finalization");
      }
      return settle(true);
    },
    rollback: () => settle(false),
  };
}

/**
 * Acquire every requested local target before callers enqueue work. If any
 * control fails, only leases minted by this attempt are released. Call
 * `commit()` after the queue/campaign write is durable or `rollback()` if that
 * later write fails.
 */
export async function acquireTargetLeasesAtomically(input: {
  scope: RequestContext;
  targetIds: readonly string[];
  listDeviceLeases: typeof listDeviceLeases;
  admitTargetControl: typeof admitTargetControl;
  releaseDeviceLease: typeof releaseDeviceLease;
}): Promise<TargetLeaseAdmission> {
  return runWithTargetControlAdmissionLock(input.scope, () =>
    acquireTargetLeasesWhileLocked(input),
  );
}
