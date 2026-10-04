import type { AuthoringReplayAttempt } from "@relay/protocol";
import type { AuthoringReview } from "./types.js";

type ReplayFailure = NonNullable<NonNullable<AuthoringReview["latestReplay"]>["failedAction"]>;

/** Only an exact failed proof names a step. Adapter-local ordinals and
 * unobserved/skipped actions cannot establish which reviewed action failed. */
export function reviewedReplayFailure(
  replay: AuthoringReplayAttempt | undefined,
  revision: number,
  actions: AuthoringReview["actions"],
): ReplayFailure | undefined {
  if (!replay || replay.outcome !== "failed" || replay.takeRevision !== revision) return;
  const index = actions.findIndex((action) => {
    const proof = replay.actionProofs?.[action.id];
    return proof?.actionId === action.id && proof.outcome === "failed";
  });
  if (index < 0) return;
  const action = actions[index]!;
  const proof = replay.actionProofs![action.id]!;
  const entrance =
    replay.observations?.find((item) => item.id === proof.entranceObservationId) ??
    (replay.before?.id === proof.entranceObservationId ? replay.before : undefined);
  const evidence = replay.evidence
    .filter(
      (item) =>
        item.kind === "screenshot" &&
        entrance?.evidenceIds.includes(item.id) &&
        proof.evidenceIds.includes(item.id),
    )
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      capturedAt: item.capturedAt,
      roles: ["entrance"] as const,
    }));
  const unavailable =
    /named target absent|selector is not present|target not found|control (?:is )?not available|could not (?:find|locate) (?:the )?(?:target|control)/iu.test(
      proof.error ?? "",
    );
  return {
    actionId: action.id,
    ordinal: index + 1,
    intent: action.intent,
    detail: unavailable
      ? "The control is not available on this screen."
      : "This step could not be completed.",
    evidence,
  };
}
