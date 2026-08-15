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
