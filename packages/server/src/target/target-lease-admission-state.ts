import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A local-control assertion can reuse a lease that a multi-target admission
 * just minted but has not committed yet. Track that observation separately
 * from the admission's own users: on rollback we retain rather than revoke a
 * lease whose use escaped the transaction. This is process-local because the
 * local device control store itself is process-local today.
 */
const currentAdmission = new AsyncLocalStorage<string>();
const pendingLeaseIds = new Set<string>();
const externallyObservedLeaseIds = new Set<string>();

export function runWithTargetLeaseAdmission<T>(admissionId: string, operation: () => T): T {
  return currentAdmission.run(admissionId, operation);
}

export function markPendingTargetLease(leaseId: string): void {
  pendingLeaseIds.add(leaseId);
}

export function clearPendingTargetLease(leaseId: string): void {
  pendingLeaseIds.delete(leaseId);
  externallyObservedLeaseIds.delete(leaseId);
}

/** Called by every target-control acquisition after it resolves its lease. */
export function noteTargetLeaseControlUse(leaseId: string): void {
  if (!pendingLeaseIds.has(leaseId)) return;
  if (!currentAdmission.getStore()) externallyObservedLeaseIds.add(leaseId);
}

export function targetLeaseHasExternalPendingUse(leaseId: string): boolean {
  return externallyObservedLeaseIds.has(leaseId);
}
