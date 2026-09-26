import { randomUUID } from "node:crypto";
import type {
  AuthoringAction,
  AuthoringEvidence,
  AuthoringInteraction,
  AuthoringObservation,
  AuthoringSession,
  AuthoringTakeRevision,
} from "@relay/protocol";
import { actionSource, stepsForInteraction } from "./authoring-action-steps.js";
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
import { semanticTargetForRecording } from "./authoring-tap-target.js";

/** The narrow runtime surface needed while one Take is actively recording. */
export type AuthoringRecordingRuntime<Captured> = {
  captureFullPage?(session: AuthoringSession): Promise<{
    evidence: AuthoringEvidence[];
    label: string;
    fullPage?: import("@relay/protocol").AuthoringFullPageCapture;
  }>;
  observe(session: AuthoringSession): Promise<Captured>;
  execute(session: AuthoringSession, interaction: AuthoringInteraction): Promise<void>;
  settle?(ms: number): Promise<void>;
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
    // Do not infer an idle pause from time spent before Stop. Explicit wait
    // interactions are already stored as replay steps; operator review time is
    // not executable behavior and must never slow every replay.
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
  input: AuthoringRecordingLifecycleDependencies<Captured>,
): Promise<AuthoringSession> {
  const { now, persistObservation, nextRevision, writeSession } = input;
  const revisionAtEntrance = currentRevision(session);
  const startedAt = now();
  let entrance = revisionAtEntrance.after ?? revisionAtEntrance.before;
  let entranceEvidence: AuthoringEvidence[] = [];
  let executable = interaction;
  let targetName: string | undefined;
  // Name what was clicked (devices and browsers alike) so the step reads
  // "Tap “Business”" and replays by that control, not by a pixel.
  if (interaction.kind === "tap" && interaction.target.point && !interaction.applied) {
    // The last endpoint can predate a transition or a user's external input.
    // Never derive a semantic selector from that potentially stale tree.
    const fresh = await persistObservation(await runtime.observe(session));
    entrance = fresh.observation;
    entranceEvidence = fresh.evidence;
    const semantic = semanticTargetForRecording(interaction.target, entrance);
    if (semantic) {
      executable = { ...interaction, target: semantic.target };
      targetName = semantic.name;
    }
  }
  const retainedEntrance = retainAuthoringObservations(revisionAtEntrance.observations, [entrance]);
  // Reserve an endpoint before issuing input. Losing a source/exit link after
  // a successful tap would make the durable revision misleading.
  if (!retainedEntrance || retainedEntrance.length >= MAX_AUTHORING_RETAINED_OBSERVATIONS) {
    throw new AuthoringStateError(
      `A Take can retain at most ${MAX_AUTHORING_RETAINED_OBSERVATIONS} action observations; stop and trim it before recording another action`,
    );
  }
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
  let fullPage:
    | {
        evidence: AuthoringEvidence[];
        label: string;
        fullPage?: import("@relay/protocol").AuthoringFullPageCapture;
      }
    | undefined;
  let nativeDispatchCompleted = false;
  try {
    if (interaction.kind === "screenshot" && interaction.fullPage) {
      if (!runtime.captureFullPage)
        throw new AuthoringStateError("Full-page capture is unavailable.");
      fullPage = await runtime.captureFullPage(session);
    }
    if (
      !["reusable", "observe", "screenshot", "wait"].includes(interaction.kind) &&
      !("applied" in interaction && interaction.applied)
    ) {
      await runtime.execute(session, executable);
      nativeDispatchCompleted = true;
      // Native input acknowledgement precedes the navigation animation. Allow
      // the new screen to arrive before freezing its screenshot and tree.
      await runtime.settle?.(400);
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
    steps: stepsForInteraction(executable, actionId, session.group),
    evidenceIds: [...(fullPage?.evidence ?? []), ...captured.evidence].map((item) => item.id),
    ...(entrance
      ? {
          entranceObservationId: entrance.id,
          exitObservationId: captured.observation.id,
          proofStatus: authoringTransitionProofStatus(entrance, captured.observation),
        }
      : {}),
    ...(fullPage
      ? { label: fullPage.label }
      : targetName
        ? { label: `Tap “${targetName}”` }
        : (interaction.kind === "observe" || interaction.kind === "screenshot") && interaction.label
          ? { label: interaction.label }
          : interaction.kind === "steps" && interaction.label
            ? { label: interaction.label }
            : {}),
    ...(fullPage?.fullPage ? { fullPage: fullPage.fullPage } : {}),
    ...(interaction.kind === "tap" && interaction.browserResolution
      ? { browserResolution: interaction.browserResolution }
      : {}),
  };
  const next = nextRevision(session, "recording", (revision) => {
    // The interval between completed interactions is operator/CUA idle time,
    // not application behavior. Only an explicit `{ kind: "wait", ms }`
    // interaction becomes a replay sleep, so app timing remains deterministic
    // and editable without replaying human thinking time.
    return {
      ...revision,
      actions: [...revision.actions, action],
      evidence: [
        ...revision.evidence,
        ...entranceEvidence,
        ...(fullPage?.evidence ?? []),
        ...captured.evidence,
      ],
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
