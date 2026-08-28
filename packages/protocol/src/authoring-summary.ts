import { authoringCaptureProvenance, captureProofForAuthoring } from "./authoring-capture.js";
import type {
  AuthoringRawEvent,
  AuthoringRawInteractionIntentEvent,
  AuthoringRawInteractionOutcomeEvent,
  AuthoringSession,
  AuthoringSessionSummary,
} from "./authoring.js";

function pendingRawIntentCount(events: readonly AuthoringRawEvent[]): number {
  const outcomes = new Set(
    events
      .filter(
        (event): event is AuthoringRawInteractionOutcomeEvent =>
          event.kind === "interaction-outcome",
      )
      .map((event) => event.intentEventId),
  );
  return events.filter(
    (event): event is AuthoringRawInteractionIntentEvent =>
      event.kind === "interaction-intent" && !outcomes.has(event.id),
  ).length;
}

/** Progressive-disclosure representation for CLI and MCP mutations.
 * Full revisions, semantic trees, and evidence stay available through the
 * explicit session-get operation instead of being repeated after every tap. */
export function summarizeAuthoringSession(session: AuthoringSession): AuthoringSessionSummary {
  const take = session.take;
  const revision = take?.revisions.find((item) => item.revision === take.currentRevision);
  const replay = take?.replayAttempts
    .filter((attempt) => attempt.takeRevision === revision?.revision)
    .at(-1);
  const captureProvenance = authoringCaptureProvenance(session.captureProvenance);
  const replayPassed = replay?.outcome === "passed";
  return {
    id: session.id,
    actorId: session.actorId,
    actorKind: session.actorKind,
    appMapId: session.appMapId,
    ...(session.testName ? { testName: session.testName } : {}),
    state: session.state,
    target: structuredClone(session.target),
    captureProvenance,
    captureProof: captureProofForAuthoring(captureProvenance, replayPassed),
    ...(session.sourceScreenId ? { sourceScreenId: session.sourceScreenId } : {}),
    ...(session.committedConnectionId
      ? { committedConnectionId: session.committedConnectionId }
      : {}),
    ...(session.committedTestId ? { committedTestId: session.committedTestId } : {}),
    ...(session.error ? { error: session.error } : {}),
    ...(session.archive ? { archive: structuredClone(session.archive) } : {}),
    ...(take
      ? {
          take: {
            id: take.id,
            state: take.state,
            revision: take.currentRevision,
            actionCount: revision?.actions.length ?? 0,
            evidenceCount: revision?.evidence.length ?? 0,
            actions: (revision?.actions ?? []).map((action) => ({
              id: action.id,
              ...(action.label ? { label: action.label } : {}),
              stepCount: action.steps.length,
              ...(action.proofStatus ? { proofStatus: action.proofStatus } : {}),
              captureProof: replayPassed
                ? "replay-proved"
                : captureProvenance.mode === "watch-and-infer"
                  ? "inferred-unproved"
                  : captureProvenance.mode === "instrumented"
                    ? "instrumented-unproved"
                    : "relay-controlled",
            })),
            ...(replay
              ? {
                  latestReplay: {
                    id: replay.id,
                    outcome: replay.outcome,
                    takeRevision: replay.takeRevision,
                    durationMs: Math.max(0, replay.finishedAt - replay.startedAt),
                    ...(replay.error ? { error: replay.error } : {}),
                    ...(replay.actionProofs
                      ? {
                          actionProofs: Object.fromEntries(
                            Object.entries(replay.actionProofs).map(([actionId, proof]) => [
                              actionId,
                              {
                                outcome: proof.outcome,
                                proofStatus: proof.proofStatus,
                                transition: proof.transition,
                              },
                            ]),
                          ),
                        }
                      : {}),
                  },
                }
              : {}),
            ...(take.rawCaptureVersion !== undefined && take.rawEvents !== undefined
              ? {
                  rawCapture: {
                    version: take.rawCaptureVersion,
                    eventCount: take.rawEvents.length,
                    pendingIntentCount: pendingRawIntentCount(take.rawEvents),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}
