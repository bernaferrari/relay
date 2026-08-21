import { AsyncLocalStorage } from "node:async_hooks";
import { KeyedSerialQueue } from "@relay/core";
import type { RequestContext } from "./security.js";

/**
 * A project-scoped, re-entrant control-admission lock. It protects the small
 * lease create/reuse → campaign rollback decision window; it deliberately
 * does not cover device execution, which remains parallel by target lane.
 */
const locks = new KeyedSerialQueue();
const heldLockKeys = new AsyncLocalStorage<ReadonlySet<string>>();
const localCapacityLockKey = "local-capacity-admission";

function scopeKey(scope: RequestContext): string {
  return `${scope.organizationId}\u0000${scope.projectId}`;
}

function runWithAdmissionLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  if (heldLockKeys.getStore()?.has(key)) return operation();
  return locks.run(key, async () => {
    const held = new Set(heldLockKeys.getStore() ?? []);
    held.add(key);
    return heldLockKeys.run(held, operation);
  });
}

export function runWithTargetControlAdmissionLock<T>(
  scope: RequestContext,
  operation: () => Promise<T>,
): Promise<T> {
  return runWithAdmissionLock(scopeKey(scope), operation);
}

/**
 * The in-process scheduler's target and shared-host reservations span every
 * project. Keep a capacity snapshot through staging in one re-entrant global
 * critical section so another project cannot promise the same local host
 * before the first staged reservation becomes visible. This intentionally
 * covers admission only, never device execution.
 */
export function runWithLocalCapacityAdmissionLock<T>(operation: () => Promise<T>): Promise<T> {
  return runWithAdmissionLock(localCapacityLockKey, operation);
}
