import { randomUUID } from "node:crypto";
import type {
  AuthoringAction,
  AuthoringEvidence,
  AuthoringInteraction,
  AuthoringObservation,
  AuthoringSession,
  AuthoringTakeRevision,
} from "@relay/protocol";
import {
  actionSource,
  recordedPauseAction,
  stepsForInteraction,
} from "./authoring-action-steps.js";
import { currentRevision } from "./authoring-session-screen-proof.js";
import { AuthoringStateError } from "./authoring-session-state.js";
import {
  MAX_AUTHORING_RETAINED_OBSERVATIONS,
  retainAuthoringObservations,
} from "./authoring-observation-links.js";
import {
  appendAuthoringRawInteraction,
  appendAuthoringRawInteractionIntent,
  appendAuthoringRawInteractionOutcome,
  appendAuthoringRawStop,
} from "./authoring-raw-recording.js";
import { authoringTransitionProofStatus } from "./authoring-transition-proof.js";

/** The narrow runtime surface needed while one Take is actively recording. */
export type AuthoringRecordingRuntime<Captured> = {
  observe(session: AuthoringSession): Promise<Captured>;
  execute(session: AuthoringSession, interaction: AuthoringInteraction): Promise<void>;
  stopVideo?(
    session: AuthoringSession,
  ): Promise<{ data?: Uint8Array; mime?: string; warning?: string }>;
};

export type PersistedAuthoringObservation = {
  observation: AuthoringObservation;
  evidence: AuthoringEvidence[];
};

/**
 * Session persistence and capture plumbing are deliberately injected. This
 * keeps the recording lifecycle testable without teaching it about the
 * session store's queue, filesystem layout, or operation context.
 */
export type AuthoringRecordingLifecycleDependencies<Captured> = {
  now(): number;
  persistObservation(captured: Captured): Promise<PersistedAuthoringObservation>;
  persistEvidence(input: {
    kind: AuthoringEvidence["kind"];
    capturedAt: number;
    data: Uint8Array | string;
    mime?: string;
    startMs?: number;
    endMs?: number;
  }): Promise<AuthoringEvidence>;
  nextRevision(
    session: AuthoringSession,
    reason: AuthoringTakeRevision["reason"],
    mutate: (previous: AuthoringTakeRevision) => AuthoringTakeRevision,
  ): AuthoringSession;
  /** Used only for pre-dispatch intent and terminal-outcome durability. */
  writeSession(session: AuthoringSession): Promise<void>;
};

/**
 * Capture the final Take endpoint after sealing the video transport. iOS
 * recording and snapshots can share XCTest, so reversing this order can
 * destroy the video before it is persisted.
 */
export async function finishAuthoringRecording<Captured>(
  session: AuthoringSession,
  runtime: AuthoringRecordingRuntime<Captured>,
  dependencies: Pick<
    AuthoringRecordingLifecycleDependencies<Captured>,
    "now" | "persistEvidence" | "persistObservation" | "nextRevision"
  >,
): Promise<AuthoringSession> {
  const { now, persistEvidence, persistObservation, nextRevision } = dependencies;
  const stoppedAt = now();
  const video = await runtime.stopVideo?.(session);
  const captured = await persistObservation(await runtime.observe(session));
  const before = currentRevision(session).before?.capturedAt ?? captured.observation.capturedAt;
  const videoEndMs = Math.max(0, stoppedAt - before);
  const videoEvidence = video?.data
    ? [
        await persistEvidence({
          kind: "video",
          capturedAt: now(),
          data: video.data,
          mime: video.mime ?? "video/mp4",
          startMs: 0,
          endMs: videoEndMs,
        }),
      ]
    : [];
  session = nextRevision(session, "recording", (revision) => ({
    ...revision,
    // Pauses are meaningful only between two recorded actions. Time spent
    // inspecting the result and reaching for Stop is authoring overhead, not
    // executable behavior, and must never slow every replay.
    actions: revision.actions,
    evidence: [...revision.evidence, ...captured.evidence, ...videoEvidence],
    after: captured.observation,
    ...(videoEvidence[0] ? { videoClip: { startMs: 0, endMs: videoEndMs } } : {}),
  }));
  const raw = appendAuthoringRawStop(session.take!, {
    target: session.target,
    recordedAt: stoppedAt,
    observation: captured.observation,
    evidenceIds: [...captured.evidence, ...videoEvidence].map((item) => item.id),
  });
  if (raw) session = { ...session, take: { ...session.take!, ...raw } };
  if (video?.warning) session.error = video.warning;
  return session;
}

/**
 * Persist one raw intent before device input, then append exactly one terminal
 * outcome after its exit evidence has been captured. A crash at either write
 * point leaves a truthful durable fact instead of an invented action.
 */
export async function recordAuthoringInteraction<Captured>(
  session: AuthoringSession,
  interaction: AuthoringInteraction,
  runtime: AuthoringRecordingRuntime<Captured>,
  input: AuthoringRecordingLifecycleDependencies<Captured> & { idleStartedAt?: number },
): Promise<AuthoringSession> {
  const { idleStartedAt, now, persistObservation, nextRevision, writeSession } = input;
  const revisionAtEntrance = currentRevision(session);
  const entrance = revisionAtEntrance.after ?? revisionAtEntrance.before;
  const retainedEntrance = retainAuthoringObservations(revisionAtEntrance.observations, [entrance]);
  // Reserve an endpoint before issuing input. Losing a source/exit link after
  // a successful tap would make the durable revision misleading.
  if (!retainedEntrance || retainedEntrance.length >= MAX_AUTHORING_RETAINED_OBSERVATIONS) {
    throw new AuthoringStateError(
      `A Take can retain at most ${MAX_AUTHORING_RETAINED_OBSERVATIONS} action observations; stop and trim it before recording another action`,
    );
  }
  const startedAt = now();
  const previousAction = revisionAtEntrance.actions.at(-1);
  const intent = appendAuthoringRawInteractionIntent(session.take!, {
    target: session.target,
    interaction,
    startedAt,
    entrance,
  });
  const { intentEventId, ...intentRaw } = intent ?? {};
  if (intentEventId) {
    // This write is intentionally before native dispatch. If Relay or the
    // target dies during the input, recovery retains the pending intent rather
    // than fabricating a completed action.
    session = { ...session, take: { ...session.take!, ...intentRaw } };
    await writeSession(session);
  }
  const appendTerminalOutcome = async (outcome: "failed" | "unknown") => {
    if (!intentEventId) return;
    const raw = appendAuthoringRawInteractionOutcome(session.take!, {
      target: session.target,
      intentEventId,
      outcome,
      finishedAt: now(),
    });
    if (raw) {
      session = { ...session, take: { ...session.take!, ...raw } };
      await writeSession(session);
    }
  };
  let nativeDispatchCompleted = false;
  try {
    if (
      !["reusable", "observe", "screenshot", "wait"].includes(interaction.kind) &&
      !("applied" in interaction && interaction.applied)
    ) {
      await runtime.execute(session, interaction);
      nativeDispatchCompleted = true;
    } else if (interaction.kind === "wait" && interaction.ms > 0) {
      await runtime.execute(session, interaction);
      nativeDispatchCompleted = true;
    }
  } catch (error) {
    await appendTerminalOutcome("failed");
    throw error;
  }
  let captured: PersistedAuthoringObservation;
  try {
    captured = await persistObservation(await runtime.observe(session));
  } catch (error) {
    await appendTerminalOutcome(nativeDispatchCompleted ? "unknown" : "failed");
    throw error;
  }
  const observations = retainAuthoringObservations(retainedEntrance, [captured.observation]);
  if (!observations) {
    await appendTerminalOutcome(nativeDispatchCompleted ? "unknown" : "failed");
    throw new AuthoringStateError(
      `A Take can retain at most ${MAX_AUTHORING_RETAINED_OBSERVATIONS} action observations; the new action was not saved`,
    );
  }
  // Finish after Relay has captured the resulting state. The next gap then
  // measures human idle time, not device execution or evidence I/O.
  const finishedAt = now();
  const actionId = `action-${randomUUID()}`;
  const action: AuthoringAction = {
    id: actionId,
    source: actionSource(interaction),
    recordedAt: startedAt,
    startedAt,
    finishedAt,
    steps: stepsForInteraction(interaction, actionId, session.group),
    evidenceIds: captured.evidence.map((item) => item.id),
    ...(entrance
      ? {
          entranceObservationId: entrance.id,
          exitObservationId: captured.observation.id,
          proofStatus: authoringTransitionProofStatus(entrance, captured.observation),
        }
      : {}),
    ...((interaction.kind === "observe" || interaction.kind === "screenshot") && interaction.label
      ? { label: interaction.label }
      : interaction.kind === "steps" && interaction.label
        ? { label: interaction.label }
        : {}),
    ...(interaction.kind === "tap" && interaction.browserResolution
      ? { browserResolution: interaction.browserResolution }
      : {}),
  };
  const next = nextRevision(session, "recording", (revision) => {
    // Human cadence is meaningful recording data. Agent wall-clock gaps are
    // orchestration latency (reasoning, tool round-trips, model queues), not
    // application behavior, and must never make the saved replay slower.
    const pause =
      previousAction && session.actorKind === "human"
        ? recordedPauseAction({
            durationMs: startedAt - (idleStartedAt ?? previousAction.finishedAt),
            finishedAt: startedAt,
            evidenceIds: previousAction.evidenceIds,
            group: session.group,
          })
        : undefined;
    return {
      ...revision,
      actions: [...revision.actions, ...(pause ? [pause] : []), action],
      evidence: [...revision.evidence, ...captured.evidence],
      observations,
      after: captured.observation,
    };
  });
  const raw = intentEventId
    ? appendAuthoringRawInteractionOutcome(next.take!, {
        target: next.target,
        intentEventId,
        outcome: "succeeded",
        finishedAt,
        action,
        exit: captured.observation,
      })
    : appendAuthoringRawInteraction(next.take!, {
        target: next.target,
        interaction,
        action,
        entrance,
        exit: captured.observation,
      });
  return raw ? { ...next, take: { ...next.take!, ...raw } } : next;
}
