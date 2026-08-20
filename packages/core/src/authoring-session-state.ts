/** Explicit, persisted state transitions for an Authoring Session. */
import type { AuthoringSession, AuthoringSessionState } from "@relay/protocol";
import { now } from "./events.js";

export class AuthoringStateError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "AuthoringStateError";
  }
}

const transitions: Record<AuthoringSessionState, readonly AuthoringSessionState[]> = {
  preparing: ["ready", "failed", "cancelled"],
  ready: ["recording", "cancelled", "failed"],
  recording: ["reviewing", "failed", "cancelled"],
  reviewing: ["committing", "cancelled", "failed"],
  committing: ["committed", "reviewing", "failed"],
  committed: [],
  failed: ["ready", "reviewing", "cancelled"],
  cancelled: [],
};

export function assertAuthoringTransition(
  from: AuthoringSessionState,
  to: AuthoringSessionState,
): void {
  if (!transitions[from].includes(to)) {
    throw new AuthoringStateError(`Authoring Session cannot transition from ${from} to ${to}`);
  }
}

export function transition(
  session: AuthoringSession,
  state: AuthoringSessionState,
): AuthoringSession {
  assertAuthoringTransition(session.state, state);
  return { ...session, state, updatedAt: now() };
}
