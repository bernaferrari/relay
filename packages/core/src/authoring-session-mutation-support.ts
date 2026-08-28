import type {
  AuthoringSession,
  AuthoringSessionState,
  AuthoringTakeRevision,
} from "@relay/protocol";
import { now } from "./events.js";
import { currentOperationContext, type OperationContext } from "./operation-context.js";
import { currentRevision } from "./authoring-session-screen-proof.js";
import { AuthoringStateError } from "./authoring-session-state.js";

export function cloneAuthoringValue<T>(value: T): T {
  return structuredClone(value);
}

export function requireAuthoringState(
  session: AuthoringSession,
  ...states: AuthoringSessionState[]
): AuthoringSession {
  if (!states.includes(session.state)) {
    throw new AuthoringStateError(
      `Authoring Session is ${session.state}; expected ${states.join(" or ")}`,
    );
  }
  return session;
}

export function authoringOperationContext(): OperationContext {
  const operation = currentOperationContext();
  if (!operation) throw new Error("Relay operation context is required for authoring");
  return operation;
}

export function assertAuthoringOwner(session: AuthoringSession): void {
  const operation = authoringOperationContext();
  if (
    session.organizationId !== operation.organizationId ||
    session.projectId !== operation.projectId
  ) {
    throw new AuthoringStateError("Authoring Session is outside this project");
  }
  if (session.actorId !== operation.actorId) {
    throw new AuthoringStateError("Only the owning actor can mutate this Authoring Session");
  }
}

export function nextAuthoringRevision(
  session: AuthoringSession,
  reason: AuthoringTakeRevision["reason"],
  mutate: (previous: AuthoringTakeRevision) => AuthoringTakeRevision,
): AuthoringSession {
  const take = session.take!;
  const previous = currentRevision(session);
  const revision = mutate(cloneAuthoringValue(previous));
  revision.id = `${take.id}:revision:${previous.revision + 1}`;
  revision.revision = previous.revision + 1;
  revision.createdAt = now();
  revision.createdBy = authoringOperationContext().actorId;
  revision.reason = reason;
  return {
    ...session,
    updatedAt: revision.createdAt,
    take: {
      ...take,
      updatedAt: revision.createdAt,
      currentRevision: revision.revision,
      revisions: [...take.revisions, revision],
    },
  };
}
