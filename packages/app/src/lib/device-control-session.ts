import type { DeviceLease, ServerConnection } from "@relay/protocol";

/** A loopback Relay renderer joins the server-owned project control session.
 * Authenticated remote connections remain bound to their actor-owned lease. */
export function leaseBelongsToConnection(
  connection: Pick<ServerConnection, "actorId" | "auth">,
  lease: Pick<DeviceLease, "ownerId" | "controlScope">,
): boolean {
  return (
    lease.ownerId === connection.actorId ||
    (connection.auth.type === "none" && lease.controlScope === "local-project")
  );
}

export function findActiveConnectionLease(
  connection: Pick<ServerConnection, "actorId" | "auth">,
  leases: DeviceLease[],
  matches: (lease: DeviceLease) => boolean,
): DeviceLease | undefined {
  const currentTime = Date.now();
  return leases.find(
    (lease) =>
      matches(lease) &&
      leaseBelongsToConnection(connection, lease) &&
      lease.status === "leased" &&
      lease.expiresAt > currentTime,
  );
}
