import type {
  AuthoringCommitDestination,
  AuthoringObservation,
  AuthoringSession,
  AuthoringTakeRevision,
  TargetProfile,
} from "@relay/protocol";
import {
  authoringCaptureProvenance,
  captureProofForAuthoring,
  compileBrowserEnvironment,
} from "@relay/protocol";
import { commitAppMapRecording } from "./app-map.js";
import { overlayHonestBrowserTargetProfile } from "./app-map-run-history.js";
import { mutateStoredAppMap, readAppMap } from "./collaboration.js";
import { authoringEvidenceExists } from "./authoring-evidence.js";
import { AuthoringStateError } from "./authoring-session-state.js";
import { managedBrowserTargetProfile } from "./browser-case-profile-target.js";
import { now } from "./events.js";
import { readTarget } from "./targets.js";
import { authoringOriginApplication } from "./authoring-session-runtime.js";

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
  const recording = replayRecording(session, revision);
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
  const targetProfile = await frozenAuthoringTargetProfile(session, committedAt);
  const originApplication = authoringOriginApplication(session);
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
        target:
          session.target.kind === "browser"
            ? {
                kind: "browser",
                platform: "browser",
                targetId: session.target.targetId,
                ...(session.target.authenticationFixtureId
                  ? { authenticationFixtureId: session.target.authenticationFixtureId }
                  : {}),
              }
            : session.target,
        takeId: session.take!.id,
        takeRevision: revision.revision,
        actions: recording.actions,
        observations: recording.observations,
        before: recording.before,
        // A reviewed replay is authoritative for edited actions.
        after: input.approvedAfter ?? revision.after,
        evidenceIds: [...new Set(evidence.map((item) => item.id))],
        evidenceUrisById: Object.fromEntries(evidence.map((item) => [item.id, item.uri])),
        evidenceKindsById: Object.fromEntries(evidence.map((item) => [item.id, item.kind])),
        evidenceById: Object.fromEntries(evidence.map((item) => [item.id, item])),
        ...(targetProfile ? { targetProfile } : {}),
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
          ? {
              testId: session.commitTestId,
              testName: session.testName!,
              ...(originApplication ? { originApplication } : {}),
            }
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

/** Edits invalidate the demonstrated path. A complete replay supplies the new
 * action boundaries; retaining only its final frame loses intermediate screens
 * and makes later selectors appear to belong to the starting screen. */
function replayRecording(session: AuthoringSession, revision: AuthoringTakeRevision) {
  const replay = session.take?.replayAttempts
    .filter((attempt) => attempt.takeRevision === revision.revision)
    .at(-1);
  if (replay?.outcome !== "passed" || replay.source === "recording") return revision;
  const observations = replay.observations;
  if (!observations?.length) return revision;
  const ids = new Set(observations.map((observation) => observation.id));
  const complete = revision.actions.every((action) => {
    const proof = replay.actionProofs?.[action.id];
    return (
      proof?.outcome === "passed" &&
      proof.entranceObservationId &&
      ids.has(proof.entranceObservationId) &&
      proof.exitObservationId &&
      ids.has(proof.exitObservationId)
    );
  });
  if (!complete) return revision;
  return {
    ...revision,
    before: replay.before ?? revision.before,
    observations,
    actions: revision.actions.map((action) => {
      const proof = replay.actionProofs![action.id]!;
      return {
        ...action,
        entranceObservationId: proof.entranceObservationId,
        exitObservationId: proof.exitObservationId,
        proofStatus: proof.proofStatus,
        evidenceIds: proof.evidenceIds,
      };
    }),
  };
}

async function frozenAuthoringTargetProfile(
  session: AuthoringSession,
  observedAt: number,
): Promise<TargetProfile | undefined> {
  if (session.target.kind !== "browser") return undefined;
  const target = await readTarget(session.target.targetId);
  if (!target?.browser) {
    throw new AuthoringStateError(
      "Managed browser target is required to freeze a recording before it can be saved",
    );
  }
  const unsigned = managedBrowserTargetProfile(target, observedAt);
  // A recording made as a saved login ran in the signed-in browser, so its
  // evidence belongs to that login's Variant. Stamp the same overlay-honest
  // identity a fixture Lane/runtime profile computes; never the unsigned id.
  const fixtureId = session.target.authenticationFixtureId?.trim();
  if (!fixtureId) return unsigned;
  return overlayHonestBrowserTargetProfile({
    ...unsigned,
    browserCaseProfile: compileBrowserEnvironment({
      ...unsigned.browserCaseProfile!,
      authenticationFixtureId: fixtureId,
    }),
  });
}
