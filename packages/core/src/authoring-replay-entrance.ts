import type {
  AuthoringAction,
  AuthoringObservation,
  AuthoringSession,
  AuthoringTakeRevision,
} from "@relay/protocol";
import type { AuthoringRuntime } from "./authoring-session-runtime.js";
import { persistCapturedAuthoringObservation } from "./authoring-observation-capture.js";
import { retainAuthoringObservations } from "./authoring-observation-links.js";
import { requestedNativeTap } from "./recorded-entrance-proof.js";
import { AuthoringStateError } from "./authoring-session-state.js";

export function nativeReplayEntranceRequest(
  revision: AuthoringTakeRevision,
  action: AuthoringAction,
) {
  return (revision.entranceCaptureVersion === 1 || action.entranceCaptureVersion === 1) &&
    action.steps.length === 1
    ? requestedNativeTap(action.steps[0]!)
    : undefined;
}
/** A replay supplies a new current selector census; it cannot relink the pre-edit tree. */
export async function captureReplaySelectorEntrance(
  session: AuthoringSession,
  revision: AuthoringTakeRevision,
  action: AuthoringAction,
  runtime: AuthoringRuntime,
  observations: AuthoringObservation[],
) {
  const request = nativeReplayEntranceRequest(revision, action);
  if (!request) return undefined;
  const fresh = await persistCapturedAuthoringObservation(
    await runtime.observe(session, {
      includeIdentifiers: request.identifiers,
      includeLabels: request.labels,
    }),
  );
  const retained = retainAuthoringObservations(observations, [fresh.observation]);
  if (!retained) throw new AuthoringStateError("Replay selector entrance could not be retained");
  return { ...fresh, observations: retained };
}
