import type { DeviceLease } from "@relay/protocol";
import { now, publish } from "./events.js";
import { readControlStore, withControlStore } from "./collaboration-store.js";

/** Local/agent leases last long enough for a Settings tour + a server blink. */
export const DEVICE_LEASE_TTL_MS = 2 * 60 * 60 * 1000;
/** Touching the device with <30 minutes left extends the same lease. */
export const DEVICE_LEASE_RENEW_UNDER_MS = 30 * 60 * 1000;

export async function listDeviceLeases(projectId: string): Promise<DeviceLease[]> {
  const at = now();
  return (await readControlStore((store) => store.leases(projectId))).map((item) =>
    item.status === "leased" && item.expiresAt <= at
      ? { ...item, status: "expired" as const }
      : item,
  );
}

/** Read-only execution check. It never creates, renews, or changes a lease. */
export async function isDeviceLeaseClaimActive(
  input: {
    organizationId?: string;
    projectId: string;
    deviceSerial: string;
    ownerId: string;
    leaseId: string;
  },
  at = now(),
): Promise<boolean> {
  const lease = await readControlStore((store) => store.lease(input.leaseId));
  return Boolean(
    lease &&
    (!input.organizationId ||
      lease.organizationId === input.organizationId ||
      (!lease.organizationId && lease.controlScope !== "local-project")) &&
    lease.projectId === input.projectId &&
    lease.deviceSerial === input.deviceSerial &&
    lease.ownerId === input.ownerId &&
    lease.status === "leased" &&
    lease.expiresAt > at,
  );
}

/** Validate the exact lease owner frozen into an execution context. This is
 * distinct from actor attribution because a trusted local project can share a
 * server-owned control session while every command retains its real actor. */
export async function isDeviceLeaseSessionActive(
  input: {
    organizationId?: string;
    projectId: string;
    deviceSerial: string;
    leaseId: string;
    leaseOwnerId: string;
  },
  at = now(),
): Promise<boolean> {
  return isDeviceLeaseClaimActive(
    {
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      projectId: input.projectId,
      deviceSerial: input.deviceSerial,
      ownerId: input.leaseOwnerId,
      leaseId: input.leaseId,
    },
    at,
  );
}

export async function leaseDevice(
  input: Omit<DeviceLease, "id" | "status" | "leasedAt" | "releasedAt">,
): Promise<DeviceLease> {
  return withControlStore((store) => {
    const at = now();
    const occupied = store.activeLeaseOnDevice(input.deviceSerial, at);
    if (occupied) throw new Error(`Device ${input.deviceSerial} is already leased`);
    const lease: DeviceLease = {
      ...input,
      id: crypto.randomUUID(),
      status: "leased",
      leasedAt: at,
    };
    store.upsertLease(lease);
    publish({
      type: "lease.changed",
      at,
      projectId: input.projectId,
      resource: "lease",
      resourceId: lease.id,
    });
    return lease;
  });
}

export async function renewDeviceLease(id: string, expiresAt: number): Promise<DeviceLease> {
  return withControlStore((store) => {
    const at = now();
    const lease = store.lease(id);
    if (!lease || lease.status !== "leased") throw new Error("Device lease not found");
    if (expiresAt <= at) throw new Error("Renewal expiry must be in the future");
    const next = { ...lease, expiresAt };
    store.upsertLease(next);
    publish({
      type: "lease.changed",
      at,
      projectId: lease.projectId,
      resource: "lease",
      resourceId: lease.id,
    });
    return next;
  });
}

export async function releaseDeviceLease(
  id: string,
  scope?: { projectId: string; ownerId?: string },
): Promise<DeviceLease> {
  return withControlStore((store) => {
    const lease = store.lease(id);
    if (
      !lease ||
      (scope && lease.projectId !== scope.projectId) ||
      (scope?.ownerId && lease.ownerId !== scope.ownerId)
    )
      throw new Error("Device lease not found");
    const next: DeviceLease = { ...lease, status: "released", releasedAt: now() };
    store.upsertLease(next);
    publish({
      type: "lease.changed",
      at: next.releasedAt!,
      projectId: lease.projectId,
      resource: "lease",
      resourceId: lease.id,
    });
    return next;
  });
}

/**
 * Atomically hand an actively leased device to another actor. The caller must
 * name the exact lease it observed, which prevents a stale confirmation from
 * replacing a newer owner. Both sides remain visible in lease history.
 */
export async function takeOverDeviceLease(
  id: string,
  input: {
    organizationId?: string;
    projectId: string;
    ownerId: string;
    controlScope?: DeviceLease["controlScope"];
    expiresAt: number;
    reason: string;
  },
): Promise<DeviceLease> {
  return withControlStore((store) => {
    const at = now();
    const current = store.lease(id);
    if (
      !current ||
      current.projectId !== input.projectId ||
      (input.organizationId && current.organizationId !== input.organizationId) ||
      current.status !== "leased" ||
      current.expiresAt <= at
    ) {
      throw new Error("Active device lease not found");
    }
    if (input.expiresAt <= at) throw new Error("Takeover expiry must be in the future");
    const reason = input.reason.trim();
    if (!reason) throw new Error("Takeover reason is required");

    store.upsertLease({ ...current, status: "released", releasedAt: at });
    const lease: DeviceLease = {
      id: crypto.randomUUID(),
      ...(current.organizationId ? { organizationId: current.organizationId } : {}),
      projectId: current.projectId,
      poolId: current.poolId,
      deviceSerial: current.deviceSerial,
      ownerId: input.ownerId,
      ...(input.controlScope ? { controlScope: input.controlScope } : {}),
      status: "leased",
      leasedAt: at,
      expiresAt: input.expiresAt,
      handoffFromLeaseId: current.id,
      handoffReason: reason,
    };
    store.upsertLease(lease);
    for (const resourceId of [current.id, lease.id]) {
      publish({
        type: "lease.changed",
        at,
        projectId: current.projectId,
        resource: "lease",
        resourceId,
      });
    }
    return lease;
  });
}
