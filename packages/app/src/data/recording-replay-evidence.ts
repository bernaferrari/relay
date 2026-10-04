import type { AuthoringTake } from "@relay/protocol";

/** Failure evidence belongs to an exact action in the latest same-revision
 * replay. It never borrows a recorded frame or another attempt's controls. */
export function failedReplayEvidence(take: AuthoringTake | undefined, evidenceId: string) {
  const revision = take?.revisions.find((item) => item.revision === take.currentRevision);
  const replay = take?.replayAttempts
    ?.filter((item) => item.takeRevision === revision?.revision)
    .at(-1);
  if (!revision || !replay || replay.outcome !== "failed") return;
  const proof = revision.actions
    .map((action) => {
      const proof = replay.actionProofs?.[action.id];
      return proof?.actionId === action.id ? proof : undefined;
    })
    .find(
      (item) =>
        item?.outcome === "failed" &&
        revision.actions.some((action) => action.id === item.actionId) &&
        item.evidenceIds.includes(evidenceId),
    );
  if (!proof) return;
  const observation =
    replay.observations?.find((item) => item.id === proof.entranceObservationId) ??
    (replay.before?.id === proof.entranceObservationId ? replay.before : undefined);
  if (!observation?.evidenceIds.includes(evidenceId)) return;
  const evidence = replay.evidence.find(
    (item) => item.id === evidenceId && item.kind === "screenshot",
  );
  return evidence ? { evidence, observation } : undefined;
}
