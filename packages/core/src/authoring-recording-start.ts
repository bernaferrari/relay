import { randomUUID } from "node:crypto";
import type { AuthoringSession } from "@relay/protocol";
import type { AuthoringRuntime } from "./authoring-session-runtime.js";
import { persistCapturedAuthoringObservation } from "./authoring-observation-capture.js";
import { assertExpectedSource } from "./authoring-session-screen-proof.js";
import { seedAuthoringRawRecording } from "./authoring-raw-recording.js";
import { transition } from "./authoring-session-state.js";
import { now } from "./events.js";

export type AuthoringRecordingStartResult = {
  session: AuthoringSession;
  /** Ephemeral operation classification, not caller-authored session data. */
  failure?: "source-unavailable" | "start-failed";
};

/** Called only inside the store's owned session queue. One fresh capture
 * supplies both source validation and the initial Take; no cached observation
 * enters this interface. Explicit Start follows the same capture path. */
export async function startAuthoringRecording(
  session: AuthoringSession,
  runtime: AuthoringRuntime,
): Promise<AuthoringRecordingStartResult> {
  let captured;
  try {
    captured = await persistCapturedAuthoringObservation(await runtime.observe(session));
  } catch (error) {
    return failedStart(session, error, "source-unavailable");
  }
  if (session.state === "preparing") session = transition(session, "ready");
  try {
    await assertExpectedSource(session, captured.observation);
    await runtime.startVideo?.(session);
  } catch (error) {
    return failedStart(session, error, "start-failed");
  }
  const at = now();
  const takeId = `take-${randomUUID()}`;
  session = transition(session, "recording");
  session.take = {
    id: takeId,
    state: "recording",
    createdAt: at,
    updatedAt: at,
    currentRevision: 1,
    revisions: [
      {
        id: `${takeId}:revision:1`,
        takeId,
        revision: 1,
        createdAt: at,
        createdBy: session.actorId,
        reason: "recording",
        actions: [],
        evidence: captured.evidence,
        observations: [captured.observation],
        before: captured.observation,
      },
    ],
    replayAttempts: [],
    ...seedAuthoringRawRecording({
      target: session.target,
      captureProvenance: session.captureProvenance,
      trigger: "recording",
      recordedAt: at,
      observation: captured.observation,
    }),
  };
  return { session };
}

function failedStart(
  session: AuthoringSession,
  error: unknown,
  failure: NonNullable<AuthoringRecordingStartResult["failure"]>,
): AuthoringRecordingStartResult {
  const failed = transition(session, "failed");
  failed.error = error instanceof Error ? error.message : String(error);
  failed.recoverable = Boolean(failed.take);
  return { session: failed, failure };
}
