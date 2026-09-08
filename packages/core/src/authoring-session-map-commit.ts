import type {
  AuthoringCommitDestination,
  AuthoringObservation,
  AuthoringSession,
  AuthoringTakeRevision,
} from "@relay/protocol";
import { authoringCaptureProvenance, captureProofForAuthoring } from "@relay/protocol";
import { commitAppMapRecording } from "./app-map.js";
import { mutateStoredAppMap, readAppMap } from "./collaboration.js";
import { authoringEvidenceExists } from "./authoring-evidence.js";
import { AuthoringStateError } from "./authoring-session-state.js";
import { now } from "./events.js";

export type AuthoringMapCommitFault = (
  boundary: "before-verify" | "after-verify" | "before-rename" | "before-persist",
) => void;

/** Cross the single App Map commit point for a reviewed Connection and its
 * optional first Test. The transform is validated before the store persists
 * either artifact. */
export async function commitAuthoringSessionMap(input: {
  session: AuthoringSession;
  revision: AuthoringTakeRevision;
  destination?: AuthoringCommitDestination;
  approvedAfter?: AuthoringObservation;
  fault?: AuthoringMapCommitFault;
}): Promise<{ revision: number; connectionId: string; testId?: string }> {
  const { session, revision, fault } = input;
  const appMap = await readAppMap(session.projectId, session.appMapId);
  if (!appMap) throw new AuthoringStateError("App Map no longer exists");
  if (appMap.revision !== session.expectedAppMapRevision) {
    throw new AuthoringStateError("App Map changed while this Take was being reviewed");
  }
  const evidence = [
    ...revision.evidence,
    ...(session.take?.replayAttempts.flatMap((attempt) => attempt.evidence) ?? []),
  ];
  fault?.("before-verify");
  for (const item of evidence) {
    if (!(await authoringEvidenceExists(item))) {
      throw new AuthoringStateError(`Authoring evidence ${item.id} is not durable`);
    }
  }
  fault?.("after-verify");
  fault?.("before-rename");
  const committedAt = Math.max(now(), appMap.updatedAt + 1);
  let connectionId = "";
  let testId: string | undefined;
  const result = await mutateStoredAppMap(session.projectId, session.appMapId, (current) => {
    const committed = commitAppMapRecording(
      current,
      {
        sessionId: session.id,
        sourceScreenId: session.sourceScreenId,
        pendingConnectionId: session.pendingConnectionId,
        destination: input.destination ?? session.destination,
        target: session.target,
        takeId: session.take!.id,
        takeRevision: revision.revision,
        actions: revision.actions,
        observations: revision.observations,
        before: revision.before,
        // A reviewed replay is authoritative for edited actions.
        after: input.approvedAfter ?? revision.after,
        evidenceIds: [...new Set(evidence.map((item) => item.id))],
        evidenceUrisById: Object.fromEntries(evidence.map((item) => [item.id, item.uri])),
        evidenceKindsById: Object.fromEntries(evidence.map((item) => [item.id, item.kind])),
        evidenceById: Object.fromEntries(evidence.map((item) => [item.id, item])),
        captureReview: {
          schemaVersion: 1,
          provenance: authoringCaptureProvenance(session.captureProvenance),
          proof: captureProofForAuthoring(
            authoringCaptureProvenance(session.captureProvenance),
            session.take!.replayAttempts.some(
              (attempt) =>
                attempt.takeRevision === revision.revision && attempt.outcome === "passed",
            ),
          ),
        },
        ...(session.commitTestId
          ? { testId: session.commitTestId, testName: session.testName! }
          : {}),
      },
      {
        expectedRevision: session.expectedAppMapRevision,
        eventId: session.id,
        actorId: session.actorId,
        actorKind: session.actorKind,
        at: committedAt,
      },
    );
    connectionId = committed.connectionId;
    testId = committed.testId;
    fault?.("before-persist");
    return committed.appMap;
  });
  return { revision: result.revision, connectionId, ...(testId ? { testId } : {}) };
}
