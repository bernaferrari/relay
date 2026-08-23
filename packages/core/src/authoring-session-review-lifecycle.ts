import type { AuthoringSession } from "@relay/protocol";
import { publish } from "./events.js";
import { transition } from "./authoring-session-state.js";

export function publishAuthoringSessionEvent(session: AuthoringSession): void {
  publish({
    type: "resource.updated", at: session.updatedAt, projectId: session.projectId,
    resource: "recording-session", resourceId: session.id,
    revision: session.take?.currentRevision ?? 0,
  });
}

export function publishAuthoringCommittedEvent(session: AuthoringSession): void {
  if (!session.committedConnectionId) throw new Error("Committed Authoring Session has no graph connection");
  publish({
    type: "authoring.committed", at: session.updatedAt, projectId: session.projectId,
    sessionId: session.id, appMapId: session.appMapId,
    connectionId: session.committedConnectionId, revision: session.expectedAppMapRevision,
  });
}

export function listedAuthoringSessions(
  sessions: readonly AuthoringSession[],
  projectId: string,
  includeHistory: boolean | undefined,
): AuthoringSession[] {
  return sessions.filter((session) => session.projectId === projectId && (includeHistory || !session.archive));
}

export function abandonedAuthoringSessions(
  sessions: readonly AuthoringSession[],
  projectId: string,
  limit: number,
): AuthoringSession[] {
  return sessions.filter(
    (session) =>
      session.projectId === projectId &&
      !session.archive &&
      (session.state === "cancelled" || session.state === "failed"),
  ).slice(limit);
}

export function authoringRecoveryScopes(
  sessions: readonly AuthoringSession[],
): Array<{ organizationId: string; projectId: string }> {
  const scopes = new Map<string, { organizationId: string; projectId: string }>();
  for (const session of sessions) {
    if (!["preparing", "recording", "committing"].includes(session.state)) continue;
    const scope = { organizationId: session.organizationId, projectId: session.projectId };
    scopes.set(`${scope.organizationId}\0${scope.projectId}`, scope);
  }
  return [...scopes.values()].sort(
    (left, right) =>
      left.organizationId.localeCompare(right.organizationId) ||
      left.projectId.localeCompare(right.projectId),
  );
}

function replacesReview(candidate: AuthoringSession, replacement: AuthoringSession): boolean {
  return (
    candidate.id !== replacement.id &&
    !candidate.archive &&
    candidate.state === "reviewing" &&
    candidate.organizationId === replacement.organizationId &&
    candidate.projectId === replacement.projectId &&
    candidate.actorId === replacement.actorId &&
    candidate.appMapId === replacement.appMapId &&
    candidate.target.targetId === replacement.target.targetId
  );
}

/** Persist a terminal superseded disposition for older reviews in precisely
 * the same actor/map/target scope. The Take's evidence remains untouched and
 * can be read through explicit history or session-get calls. */
export async function archiveSupersededAuthoringReviews(input: {
  replacement: AuthoringSession;
  sessions: readonly AuthoringSession[];
  mutate(id: string, operation: (session: AuthoringSession) => AuthoringSession): Promise<void>;
}): Promise<void> {
  await Promise.all(
    input.sessions.filter((session) => replacesReview(session, input.replacement)).map((candidate) =>
      input.mutate(candidate.id, (current) => {
        if (!replacesReview(current, input.replacement)) return current;
        const archived = transition(current, "cancelled");
        archived.take = current.take
          ? { ...current.take, state: "discarded", updatedAt: archived.updatedAt }
          : undefined;
        archived.archive = {
          reason: "superseded",
          archivedAt: archived.updatedAt,
          supersededBySessionId: input.replacement.id,
        };
        return archived;
      }),
    ),
  );
}
