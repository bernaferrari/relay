import type { AuthoringSession } from "@relay/protocol";

/**
 * Merge a server list into renderer projections without allowing an older
 * response to move a session backwards (for example Recording → Ready).
 * Equal timestamps keep the renderer value because an action response is more
 * specific than a list request that may have started before that action.
 */
export function mergeAuthoringSessionProjections(
  current: readonly AuthoringSession[],
  incoming: readonly AuthoringSession[],
): AuthoringSession[] {
  const byId = new Map(current.map((session) => [session.id, session]));
  for (const session of incoming) {
    const projected = byId.get(session.id);
    if (!projected || session.updatedAt > projected.updatedAt) byId.set(session.id, session);
  }
  return [...byId.values()].toSorted(
    (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
  );
}
