import { randomUUID } from "node:crypto";
import type {
  AuthoringAction,
  AuthoringCaptureContext,
  AuthoringCommitDestination,
  AuthoringEvidence,
  AuthoringInteraction,
  AuthoringObservation,
  AuthoringObservationProof,
  AuthoringReplayAttempt,
  AuthoringSession,
  AuthoringSessionState,
  AuthoringTakeRevision,
  CreateAuthoringSessionInput,
  RecipeStep,
} from "@relay/protocol";
export { recordedPauseDuration } from "./authoring-recorded-pause.js";
import { actionSource, stepsForInteraction } from "./authoring-action-steps.js";
import { AuthoringStateError, transition } from "./authoring-session-state.js";
import {
  approvedAfterObservation,
  assertExpectedSource,
  attachLiveDemonstrationAttempt,
  currentRevision,
  destinationMismatchError,
  destinationForSession,
  expectedReplayScreen,
  observationMatchesExpectedDestination,
} from "./authoring-session-screen-proof.js";
export { AuthoringStateError, assertAuthoringTransition } from "./authoring-session-state.js";
import { currentOperationContext, type OperationContext } from "./operation-context.js";
import { now, publish } from "./events.js";
import { KeyedSerialQueue } from "./coordination-store.js";
import {
  listAuthoringSessionFiles,
  readAuthoringSession,
  removeAuthoringSession,
  writeAuthoringSession,
} from "./authoring-session-storage.js";
import { commitAppMapRecording } from "./app-map.js";
import { mutateStoredAppMap, readAppMap } from "./collaboration.js";
import { authoringEvidenceExists, persistAuthoringEvidence } from "./authoring-evidence.js";
import { invalidateAuthoringActionProof } from "./authoring-transition-proof.js";
import {
  MAX_AUTHORING_RETAINED_OBSERVATIONS,
  authoringReplayActionProof,
  retainAuthoringObservations,
} from "./authoring-observation-links.js";
import {
  appendAuthoringRawObservation,
  seedAuthoringRawRecording,
} from "./authoring-raw-recording.js";
import {
  finishAuthoringRecording,
  recordAuthoringInteraction,
} from "./authoring-recording-lifecycle.js";
import {
  abandonedAuthoringSessions,
  archiveSupersededAuthoringReviews,
  authoringRecoveryScopes,
  listedAuthoringSessions,
  publishAuthoringCommittedEvent,
  publishAuthoringSessionEvent,
} from "./authoring-session-review-lifecycle.js";

export type CapturedAuthoringObservation = {
  capturedAt: number;
  targetId: string;
  fingerprint: string;
  proof?: AuthoringObservationProof;
  /** Platform capture provenance kept for offline optimization and audit. */
  capture?: AuthoringCaptureContext;
  foregroundApp?: string;
  bounds?: { width: number; height: number };
  nodes?: Array<Record<string, unknown>>;
  /** Timestamp of the primary pixel evidence. `capturedAt` remains the
   * complete observation boundary, which may be later than this raster after
   * an iOS pixels → AX → pixels bracket. */
  screenshotCapturedAt?: number;
  screenshot?: { data: Uint8Array; mime: string };
  /** The closing iOS raster when it differs from the primary frame. It is
   * retained as immutable diagnostic evidence, never substituted for the
   * opening frame that established the observation's screen fingerprint. */
  bracketScreenshot?: { data: Uint8Array; mime: string; capturedAt: number };
};

export type AuthoringRuntime = {
  observe(session: AuthoringSession): Promise<CapturedAuthoringObservation>;
  execute(session: AuthoringSession, interaction: AuthoringInteraction): Promise<void>;
  replay(session: AuthoringSession, steps: RecipeStep[]): Promise<void>;
  /** Executes one authored action as an atomic batch. When present, the store
   * captures durable entrance/exit evidence around each action; older
   * runtimes keep the final-only replay path instead of inventing links. */
  replayAction?(session: AuthoringSession, action: AuthoringAction): Promise<void>;
  /**
   * Captures the endpoint immediately after one replayed action. This must be
   * pixels-first and must not wait for a new accessibility query: an iOS
   * endpoint is still useful while XCTest semantics are delayed, but stale
   * geometry must never be promoted to a current proof.
   */
  observeReplayActionEndpoint?(session: AuthoringSession): Promise<CapturedAuthoringObservation>;
  /** Allow asynchronous application and system UI to settle before Relay
   * decides that a replay reached the wrong destination. */
  settle?(ms: number): Promise<void>;
  startVideo?(session: AuthoringSession): Promise<void>;
  stopVideo?(
    session: AuthoringSession,
  ): Promise<{ data?: Uint8Array; mime?: string; warning?: string }>;
};

export type AuthoringRecovery = {
  releaseLease(session: AuthoringSession): Promise<void>;
  reconcileRecording?(
    session: AuthoringSession,
  ): Promise<{ data?: Uint8Array; mime?: string } | void>;
};

export type AuthoringRecoveryScope = {
  organizationId: string;
  projectId: string;
};

export type AuthoringCommitFault = (
  boundary: "before-verify" | "after-verify" | "before-rename" | "after-rename",
) => void;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requireState(
  session: AuthoringSession,
  ...states: AuthoringSessionState[]
): AuthoringSession {
  if (!states.includes(session.state)) {
    throw new AuthoringStateError(
      `Authoring Session is ${session.state}; expected ${states.join(" or ")}`,
    );
  }
  return session;
}

function context(): OperationContext {
  const operation = currentOperationContext();
  if (!operation) throw new Error("Relay operation context is required for authoring");
  return operation;
}

function assertOwner(session: AuthoringSession): void {
  const operation = context();
  if (
    session.organizationId !== operation.organizationId ||
    session.projectId !== operation.projectId
  ) {
    throw new AuthoringStateError("Authoring Session is outside this project");
  }
  if (session.actorId !== operation.actorId) {
    throw new AuthoringStateError("Only the owning actor can mutate this Authoring Session");
  }
}

function observationId(capturedAt: number, fingerprint: string): string {
  // Captures can share a millisecond and visual fingerprint (especially a
  // fast intentional observe). A durable action link must never resolve to a
  // different capture just because the two endpoints happened to look alike.
  return `observation-${capturedAt.toString(36)}-${fingerprint.slice(0, 12)}-${randomUUID()}`;
}

function fallbackObservationProof(
  captured: CapturedAuthoringObservation,
): AuthoringObservationProof {
  const pixelCapturedAt = captured.screenshotCapturedAt ?? captured.capturedAt;
  return {
    schemaVersion: 1,
    captureOrder: "concurrent",
    pixels: captured.screenshot
      ? { status: "captured", capturedAt: pixelCapturedAt, fingerprint: captured.fingerprint }
      : { status: "unavailable" },
    semantics:
      captured.nodes && captured.nodes.length > 0
        ? { status: "current", capturedAt: captured.capturedAt, fingerprint: captured.fingerprint }
        : { status: "unavailable", capturedAt: captured.capturedAt },
  };
}

async function persistObservation(
  captured: CapturedAuthoringObservation,
): Promise<{ observation: AuthoringObservation; evidence: AuthoringEvidence[] }> {
  const proof = clone(captured.proof ?? fallbackObservationProof(captured));
  const semanticCapturedAt = proof.semantics.capturedAt ?? captured.capturedAt;
  const primaryPixelCapturedAt =
    captured.screenshotCapturedAt ?? proof.pixels.capturedAt ?? captured.capturedAt;
  const snapshot = await persistAuthoringEvidence({
    kind: "snapshot",
    // A snapshot is the semantic plane, not the enclosing observation. Keep
    // its own timestamp so a delayed iOS tree is auditable offline.
    capturedAt: semanticCapturedAt,
    data: JSON.stringify({
      schemaVersion: 1,
      capturedAt: semanticCapturedAt,
      observationCapturedAt: captured.capturedAt,
      targetId: captured.targetId,
      fingerprint: captured.fingerprint,
      proof,
      ...(captured.capture ? { capture: captured.capture } : {}),
      ...(captured.foregroundApp ? { foregroundApp: captured.foregroundApp } : {}),
      bounds: captured.bounds,
      nodes: captured.nodes?.slice(0, 256) ?? [],
    }),
    mime: "application/json",
  });
  const evidence = [snapshot];
  if (captured.screenshot) {
    evidence.push(
      await persistAuthoringEvidence({
        kind: "screenshot",
        capturedAt: primaryPixelCapturedAt,
        data: captured.screenshot.data,
        mime: captured.screenshot.mime,
      }),
    );
  }
  if (captured.bracketScreenshot) {
    evidence.push(
      await persistAuthoringEvidence({
        kind: "screenshot",
        capturedAt: captured.bracketScreenshot.capturedAt,
        data: captured.bracketScreenshot.data,
        mime: captured.bracketScreenshot.mime,
      }),
    );
  }
  const id = observationId(captured.capturedAt, captured.fingerprint);
  return {
    observation: {
      id,
      capturedAt: captured.capturedAt,
      screen: {
        id,
        fingerprint: captured.fingerprint,
        // The screen fingerprint is a pixel claim, so give it the primary
        // raster's timestamp rather than the later semantic/bracket boundary.
        capturedAt: primaryPixelCapturedAt,
        source: "recording",
        deviceId: captured.targetId,
      },
      evidenceIds: evidence.map((item) => item.id),
      proof,
      ...(captured.capture ? { capture: clone(captured.capture) } : {}),
      ...(captured.bounds ? { bounds: { ...captured.bounds } } : {}),
      ...(captured.foregroundApp ? { foregroundApp: captured.foregroundApp } : {}),
      ...(captured.nodes ? { nodes: clone(captured.nodes.slice(0, 256)) } : {}),
    },
    evidence,
  };
}

function nextRevision(
  session: AuthoringSession,
  reason: AuthoringTakeRevision["reason"],
  mutate: (previous: AuthoringTakeRevision) => AuthoringTakeRevision,
): AuthoringSession {
  const take = session.take!;
  const previous = currentRevision(session);
  const revision = mutate(clone(previous));
  revision.id = `${take.id}:revision:${previous.revision + 1}`;
  revision.revision = previous.revision + 1;
  revision.createdAt = now();
  revision.createdBy = context().actorId;
  revision.reason = reason;
  return {
    ...session,
    updatedAt: revision.createdAt,
    take: {
      ...take,
      updatedAt: revision.createdAt,
      currentRevision: revision.revision,
      revisions: [...take.revisions, revision],
    },
  };
}

const recordingLifecycleDependencies = {
  now,
  persistEvidence: persistAuthoringEvidence,
  persistObservation,
  nextRevision,
  writeSession: writeAuthoringSession,
};

export class AuthoringSessionStore {
  readonly #queue = new KeyedSerialQueue();
  readonly #recordingReadyAt = new Map<string, number>();

  async list(
    projectId = context().projectId,
    options: { includeHistory?: boolean } = {},
  ): Promise<AuthoringSession[]> {
    return listedAuthoringSessions(await this.#all(), projectId, options.includeHistory);
  }

  async #all(): Promise<AuthoringSession[]> {
    const names = await listAuthoringSessionFiles();
    const sessions = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => readAuthoringSession(name.slice(0, -5))),
    );
    return sessions
      .filter((item): item is AuthoringSession => Boolean(item))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(clone);
  }

  async recoveryScopes(): Promise<AuthoringRecoveryScope[]> {
    return authoringRecoveryScopes(await this.#all());
  }

  async get(id: string): Promise<AuthoringSession> {
    const session = await readAuthoringSession(id);
    if (!session) throw new AuthoringStateError("Authoring Session not found");
    const operation = currentOperationContext();
    if (
      operation &&
      (session.organizationId !== operation.organizationId ||
        session.projectId !== operation.projectId)
    ) {
      throw new AuthoringStateError("Authoring Session not found");
    }
    return clone(session);
  }

  async create(input: CreateAuthoringSessionInput): Promise<AuthoringSession> {
    const operation = context();
    if (input.target.targetId.trim() === "" || input.leaseId.trim() === "") {
      throw new AuthoringStateError("Explicit target and lease are required");
    }
    const appMap = await readAppMap(operation.projectId, input.appMapId);
    if (!appMap) throw new AuthoringStateError("App Map not found");
    if (appMap.revision !== input.expectedAppMapRevision) {
      throw new AuthoringStateError("App Map revision changed before recording started");
    }
    const at = now();
    const session: AuthoringSession = {
      schemaVersion: 1,
      id: `authoring-${randomUUID()}`,
      organizationId: operation.organizationId,
      projectId: operation.projectId,
      actorId: operation.actorId,
      actorKind: operation.actorKind,
      appMapId: input.appMapId,
      state: "preparing",
      target: clone(input.target),
      leaseId: input.leaseId,
      expectedAppMapRevision: input.expectedAppMapRevision,
      ...(input.sourceScreenId ? { sourceScreenId: input.sourceScreenId } : {}),
      ...(input.pendingConnectionId ? { pendingConnectionId: input.pendingConnectionId } : {}),
      ...(input.group?.trim() ? { group: input.group.trim() } : {}),
      createdAt: at,
      updatedAt: at,
    };
    await writeAuthoringSession(session);
    publishAuthoringSessionEvent(session);
    await this.#pruneAbandoned(operation.projectId);
    return clone(session);
  }

  async #pruneAbandoned(projectId: string): Promise<void> {
    const configured = Number(process.env.RELAY_ABANDONED_AUTHORING_LIMIT ?? 100);
    const limit = Number.isSafeInteger(configured) && configured >= 0 ? configured : 100;
    const abandoned = abandonedAuthoringSessions(await this.#all(), projectId, limit);
    await Promise.all(abandoned.map((session) => removeAuthoringSession(session.id)));
  }

  async observe(id: string, runtime: AuthoringRuntime): Promise<AuthoringSession> {
    return this.#mutate(id, async (session) => {
      assertOwner(session);
      requireState(session, "preparing", "ready", "recording", "reviewing", "failed");
      let observed;
      try {
        observed = await persistObservation(await runtime.observe(session));
      } catch (error) {
        if (session.state === "preparing" || session.state === "failed") {
          const failed = session.state === "failed" ? session : transition(session, "failed");
          failed.error = error instanceof Error ? error.message : String(error);
          failed.recoverable = Boolean(failed.take);
          return failed;
        }
        throw error;
      }
      if (session.state === "preparing" || session.state === "failed") {
        session = transition(session, session.take ? "reviewing" : "ready");
        if (session.take) {
          session.take = { ...session.take, state: "reviewing", updatedAt: session.updatedAt };
        }
        session.error = undefined;
        session.recoverable = undefined;
      }
      if (session.take) {
        session = nextRevision(session, "manual", (revision) => ({
          ...revision,
          evidence: [...revision.evidence, ...observed.evidence],
          after: observed.observation,
        }));
        const raw = appendAuthoringRawObservation(session.take!, {
          target: session.target,
          recordedAt: session.updatedAt,
          observation: observed.observation,
        });
        if (raw) session = { ...session, take: { ...session.take!, ...raw } };
      }
      return session;
    });
  }

  /** Capture one durable observation without opening a video transport. This
   * is deliberately distinct from a transition Take: screenshots of Home,
   * Settings, permission sheets, and other system UI must not require an
   * active application recording session on physical iOS. */
  async capture(id: string, runtime: AuthoringRuntime): Promise<AuthoringSession> {
    return this.#mutate(id, async (session) => {
      assertOwner(session);
      requireState(session, "preparing", "ready");
      const captured = await persistObservation(await runtime.observe(session));
      if (session.state === "preparing") session = transition(session, "ready");
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
            after: captured.observation,
          },
        ],
        replayAttempts: [],
        ...seedAuthoringRawRecording({
          target: session.target,
          trigger: "capture",
          recordedAt: at,
          observation: captured.observation,
        }),
      };
      session = transition(session, "reviewing");
      session.take = { ...session.take!, state: "reviewing", updatedAt: session.updatedAt };
      return attachLiveDemonstrationAttempt(session);
    });
  }

  async start(id: string, runtime: AuthoringRuntime): Promise<AuthoringSession> {
    return this.#mutate(id, async (session) => {
      assertOwner(session);
      requireState(session, "ready");
      let captured;
      try {
        captured = await persistObservation(await runtime.observe(session));
        await assertExpectedSource(session, captured.observation);
        await runtime.startVideo?.(session);
      } catch (error) {
        const failed = transition(session, "failed");
        failed.error = error instanceof Error ? error.message : String(error);
        failed.recoverable = Boolean(failed.take);
        return failed;
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
          trigger: "recording",
          recordedAt: at,
          observation: captured.observation,
        }),
      };
      return session;
    });
  }

  async interact(
    id: string,
    interaction: AuthoringInteraction,
    runtime: AuthoringRuntime,
  ): Promise<AuthoringSession> {
    return this.#mutate(id, async (session) => {
      assertOwner(session);
      requireState(session, "recording");
      return recordAuthoringInteraction(session, interaction, runtime, {
        ...recordingLifecycleDependencies,
        idleStartedAt: this.#recordingReadyAt.get(id),
      });
    });
  }

  async stop(id: string, runtime: AuthoringRuntime): Promise<AuthoringSession> {
    try {
      const stopped = await this.#mutate(id, async (session) => {
        assertOwner(session);
        requireState(session, "recording");
        session = await finishAuthoringRecording(session, runtime, recordingLifecycleDependencies);
        if (currentRevision(session).actions.length === 0) {
          session = transition(session, "cancelled");
          session.take = { ...session.take!, state: "discarded", updatedAt: session.updatedAt };
          return session;
        }
        session = transition(session, "reviewing");
        session.take = { ...session.take!, state: "reviewing", updatedAt: session.updatedAt };
        return attachLiveDemonstrationAttempt(session);
      });
      if (stopped.state === "reviewing")
        await archiveSupersededAuthoringReviews({
          replacement: stopped,
          sessions: await this.#all(),
          mutate: async (id, operation) => {
            await this.#mutate(id, async (session) => operation(session));
          },
        });
      return stopped;
    } finally {
      this.#recordingReadyAt.delete(id);
    }
  }

  async trim(
    id: string,
    input: { fromMs?: number; toMs?: number; actionIds?: string[] },
  ): Promise<AuthoringSession> {
    return this.#mutate(id, async (session) => {
      assertOwner(session);
      requireState(session, "reviewing");
      const previous = currentRevision(session);
      const start = previous.before?.capturedAt ?? previous.createdAt;
      const allowed = input.actionIds ? new Set(input.actionIds) : undefined;
      if (
        allowed &&
        [...allowed].some((actionId) => !previous.actions.some((action) => action.id === actionId))
      ) {
        throw new AuthoringStateError("Trim does not reference an action in this Take");
      }
      const actions = previous.actions
        .filter((action) => {
          if (allowed && !allowed.has(action.id)) return false;
          const relativeStart = action.startedAt - start;
          const relativeEnd = action.finishedAt - start;
          if (input.fromMs !== undefined && relativeEnd < input.fromMs) return false;
          if (input.toMs !== undefined && relativeStart > input.toMs) return false;
          return true;
        })
        .map(invalidateAuthoringActionProof);
      return nextRevision(session, "trim", (revision) => ({
        ...revision,
        actions,
        ...(input.fromMs !== undefined || input.toMs !== undefined
          ? {
              videoClip: {
                startMs: input.fromMs ?? revision.videoClip?.startMs ?? 0,
                endMs:
                  input.toMs ??
                  revision.videoClip?.endMs ??
                  Math.max(0, (revision.after?.capturedAt ?? start) - start),
              },
            }
          : {}),
      }));
    });
  }

  async reorder(id: string, actionIds: string[]): Promise<AuthoringSession> {
    return this.#mutate(id, async (session) => {
      assertOwner(session);
      requireState(session, "reviewing");
      const previous = currentRevision(session);
      if (
        actionIds.length !== previous.actions.length ||
        new Set(actionIds).size !== actionIds.length ||
        actionIds.some((actionId) => !previous.actions.some((action) => action.id === actionId))
      ) {
        throw new AuthoringStateError("Reorder must contain every action exactly once");
      }
      const byId = new Map(previous.actions.map((action) => [action.id, action]));
      return nextRevision(session, "reorder", (revision) => ({
        ...revision,
        actions: actionIds.map((actionId) =>
          invalidateAuthoringActionProof(clone(byId.get(actionId)!)),
        ),
      }));
    });
  }

  async replace(
    id: string,
    actionId: string,
    interaction: AuthoringInteraction,
  ): Promise<AuthoringSession> {
    return this.#mutate(id, async (session) => {
      assertOwner(session);
      requireState(session, "reviewing");
      const previous = currentRevision(session);
      if (!previous.actions.some((action) => action.id === actionId)) {
        throw new AuthoringStateError("Authoring action not found");
      }
      return nextRevision(session, "replace", (revision) => ({
        ...revision,
        actions: revision.actions.map((action) => {
          const invalidated = invalidateAuthoringActionProof(action);
          return action.id === actionId
            ? {
                ...invalidated,
                source: actionSource(interaction),
                steps: stepsForInteraction(interaction, action.id, session.group),
                label: undefined,
                ...((interaction.kind === "observe" ||
                  interaction.kind === "screenshot" ||
                  interaction.kind === "steps") &&
                interaction.label
                  ? { label: interaction.label }
                  : {}),
              }
            : invalidated;
        }),
      }));
    });
  }

  async replay(id: string, runtime: AuthoringRuntime): Promise<AuthoringSession> {
    return this.#mutate(id, async (session) => {
      assertOwner(session);
      requireState(session, "reviewing");
      const revision = currentRevision(session);
      const startedAt = now();
      const replayAction = runtime.replayAction;
      const observeReplayActionEndpoint = runtime.observeReplayActionEndpoint;
      if (
        replayAction &&
        observeReplayActionEndpoint &&
        revision.actions.length + 1 > MAX_AUTHORING_RETAINED_OBSERVATIONS
      ) {
        // Do not execute a path whose per-action endpoints could not all be
        // retained. A partial index would leave action ids resolving to
        // nothing and make a failed proof look reviewable.
        throw new AuthoringStateError(
          `A Take can retain at most ${MAX_AUTHORING_RETAINED_OBSERVATIONS - 1} replay action endpoints; trim it before replaying`,
        );
      }
      let outcome: AuthoringReplayAttempt["outcome"] = "passed";
      let error: string | undefined;
      const source = await persistObservation(await runtime.observe(session));
      const actionProofs: NonNullable<AuthoringReplayAttempt["actionProofs"]> = {};
      let replayObservations = retainAuthoringObservations(undefined, [source.observation]);
      if (!replayObservations) {
        throw new AuthoringStateError("Replay source observation could not be retained");
      }
      const evidence = [...source.evidence];
      let sourceMismatch = false;
      try {
        await assertExpectedSource(session, source.observation, revision.before, "replaying");
      } catch (caught) {
        outcome = "failed";
        error = caught instanceof Error ? caught.message : String(caught);
        // This try block contains only source validation. Nothing may execute
        // after it fails, regardless of the adapter's exact diagnostic text.
        sourceMismatch = true;
      }
      if (!sourceMismatch && outcome === "passed") {
        if (replayAction && observeReplayActionEndpoint) {
          let entrance = source.observation;
          for (let index = 0; index < revision.actions.length; index += 1) {
            const action = revision.actions[index]!;
            try {
              await replayAction(session, action);
              // This endpoint is deliberately immediate. It must not settle or
              // start a fresh AX query: pixels remain valid proof while an iOS
              // tree is delayed, and the final destination check keeps its
              // existing bounded settle behavior below.
              const exit = await persistObservation(await observeReplayActionEndpoint(session));
              const retained = retainAuthoringObservations(replayObservations, [exit.observation]);
              if (!retained) {
                throw new AuthoringStateError(
                  "Replay action endpoint could not be retained; no further actions were executed",
                );
              }
              replayObservations = retained;
              evidence.push(...exit.evidence);
              actionProofs[action.id] = authoringReplayActionProof({
                action,
                outcome: "passed",
                entrance,
                exit: exit.observation,
              });
              entrance = exit.observation;
            } catch (caught) {
              outcome = "failed";
              error = caught instanceof Error ? caught.message : String(caught);
              actionProofs[action.id] = authoringReplayActionProof({
                action,
                outcome: "failed",
                entrance,
                error,
              });
              for (const skipped of revision.actions.slice(index + 1)) {
                actionProofs[skipped.id] = authoringReplayActionProof({
                  action: skipped,
                  outcome: "not-run",
                  error: "A previous replay action failed",
                });
              }
              break;
            }
          }
        } else {
          try {
            await runtime.replay(
              session,
              revision.actions.flatMap((action) => action.steps),
            );
          } catch (caught) {
            outcome = "failed";
            error = caught instanceof Error ? caught.message : String(caught);
          }
        }
      }
      if (replayAction && observeReplayActionEndpoint && sourceMismatch) {
        for (const action of revision.actions) {
          actionProofs[action.id] = authoringReplayActionProof({
            action,
            outcome: "not-run",
            error,
          });
        }
      } else if (!replayAction || !observeReplayActionEndpoint) {
        for (const action of revision.actions) {
          actionProofs[action.id] = authoringReplayActionProof({
            action,
            // A legacy batch can have run zero, some, or every action. It is
            // honest to say the individual result is unobserved, never to
            // claim that a particular action was skipped or proved.
            outcome: "unobserved",
            ...(error ? { error } : {}),
          });
        }
      }
      let captured = sourceMismatch
        ? source
        : await persistObservation(await runtime.observe(session));
      if (captured !== source) evidence.push(...captured.evidence);
      if (outcome === "passed") {
        const expected = await expectedReplayScreen(session, revision);
        const destinationMatches = () =>
          observationMatchesExpectedDestination(captured.observation, expected);
        // Native sheets, navigation animations, and streamed application
        // responses often appear just after the input command returns. Poll a
        // bounded 1.5 seconds rather than forcing every human or agent to
        // discover and save arbitrary sleeps in otherwise deterministic flows.
        if (!destinationMatches() && runtime.settle) {
          for (const delayMs of [250, 500, 750]) {
            await runtime.settle(delayMs);
            captured = await persistObservation(await runtime.observe(session));
            evidence.push(...captured.evidence);
            if (destinationMatches()) break;
          }
        }
        if (!destinationMatches()) {
          outcome = "failed";
          error = destinationMismatchError(expected, captured.observation, "Replay");
        }
      }
      const attempt: AuthoringReplayAttempt = {
        id: `replay-${randomUUID()}`,
        takeId: session.take!.id,
        takeRevision: revision.revision,
        startedAt,
        finishedAt: now(),
        outcome,
        before: source.observation,
        after: captured.observation,
        captureMode: replayAction && observeReplayActionEndpoint ? "per-action" : "final-only",
        ...(replayAction && observeReplayActionEndpoint
          ? { observations: replayObservations }
          : {}),
        actionProofs,
        evidence,
        ...(error ? { error } : {}),
      };
      return {
        ...session,
        updatedAt: attempt.finishedAt,
        take: {
          ...session.take!,
          updatedAt: attempt.finishedAt,
          replayAttempts: [...session.take!.replayAttempts, attempt],
        },
      };
    });
  }

  async commit(
    id: string,
    input: { destination?: AuthoringCommitDestination },
    fault?: AuthoringCommitFault,
  ): Promise<AuthoringSession> {
    return this.#mutate(id, async (session) => {
      assertOwner(session);
      requireState(session, "reviewing");
      const take = session.take!;
      const revision = currentRevision(session);
      const destination = await destinationForSession(session, input.destination);
      const approvedAfter = await approvedAfterObservation(session, revision, destination);
      session = transition(session, "committing");
      session.commitTransactionId = session.id;
      await writeAuthoringSession(session);
      let mapCommitted = false;
      let committedConnectionId: string | undefined;
      let committedRevision: number | undefined;
      try {
        const appMap = await readAppMap(session.projectId, session.appMapId);
        if (!appMap) throw new AuthoringStateError("App Map no longer exists");
        if (appMap.revision !== session.expectedAppMapRevision) {
          throw new AuthoringStateError("App Map changed while this Take was being reviewed");
        }
        const evidence = [
          ...revision.evidence,
          ...take.replayAttempts.flatMap((attempt) => attempt.evidence),
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
        const result = await mutateStoredAppMap(session.projectId, session.appMapId, (current) => {
          const committed = commitAppMapRecording(
            current,
            {
              sessionId: session.id,
              sourceScreenId: session.sourceScreenId,
              pendingConnectionId: session.pendingConnectionId,
              destination: input.destination ?? session.destination,
              target: session.target,
              takeId: take.id,
              takeRevision: revision.revision,
              actions: revision.actions,
              before: revision.before,
              // The reviewed replay is the authoritative result of the exact
              // actions being committed. This is especially important when a
              // person trims or rewrites a planned connection: the original
              // recording may have ended on a different screen, while the
              // successful replay is the state they explicitly approved.
              after: approvedAfter ?? revision.after,
              evidenceIds: [...new Set(evidence.map((item) => item.id))],
              evidenceUrisById: Object.fromEntries(evidence.map((item) => [item.id, item.uri])),
              evidenceKindsById: Object.fromEntries(evidence.map((item) => [item.id, item.kind])),
              evidenceById: Object.fromEntries(evidence.map((item) => [item.id, item])),
            },
            {
              expectedRevision: session.expectedAppMapRevision,
              eventId: session.id,
              actorId: session.actorId,
              actorKind: session.actorKind,
              at: committedAt,
            },
          );
          committedConnectionId = committed.connectionId;
          return committed.appMap;
        });
        mapCommitted = true;
        committedRevision = result.revision;
        fault?.("after-rename");
      } catch (error) {
        if (!mapCommitted) {
          session = transition(session, "reviewing");
          session.error = error instanceof Error ? error.message : String(error);
          await writeAuthoringSession(session);
        }
        throw error;
      }
      session = transition(session, "committed");
      session.expectedAppMapRevision = committedRevision!;
      session.committedConnectionId = committedConnectionId;
      session.take = { ...take, state: "committed", updatedAt: session.updatedAt };
      session.archive = { reason: "committed", archivedAt: session.updatedAt };
      return session;
    });
  }

  async discard(id: string): Promise<AuthoringSession> {
    return this.#mutate(id, async (session) => {
      assertOwner(session);
      requireState(session, "reviewing");
      session = transition(session, "cancelled");
      session.take = session.take
        ? { ...session.take, state: "discarded", updatedAt: session.updatedAt }
        : undefined;
      session.archive = { reason: "discarded", archivedAt: session.updatedAt };
      return session;
    });
  }

  async cancel(id: string, runtime?: AuthoringRuntime): Promise<AuthoringSession> {
    try {
      return await this.#mutate(id, async (session) => {
        assertOwner(session);
        if (session.state === "committed" || session.state === "cancelled") return session;
        if (session.state === "recording") {
          if (!runtime) {
            throw new AuthoringStateError(
              "Cancelling an active recording requires target reconciliation",
            );
          }
          session = await finishAuthoringRecording(
            session,
            runtime,
            recordingLifecycleDependencies,
          );
        }
        session = transition(session, "cancelled");
        if (session.take) {
          session.take = { ...session.take, state: "discarded", updatedAt: session.updatedAt };
          session.archive = { reason: "discarded", archivedAt: session.updatedAt };
        }
        return session;
      });
    } finally {
      this.#recordingReadyAt.delete(id);
    }
  }

  async cleanup(id: string): Promise<void> {
    await this.#queue.run(id, async () => {
      const session = await this.get(id);
      assertOwner(session);
      if (
        session.state !== "committed" &&
        session.state !== "cancelled" &&
        session.state !== "failed"
      ) {
        throw new AuthoringStateError("Only terminal Authoring Sessions can be removed");
      }
      await removeAuthoringSession(id);
      publish({
        type: "resource.deleted",
        at: now(),
        projectId: session.projectId,
        resource: "recording-session",
        resourceId: session.id,
      });
    });
  }

  async recover(recovery: AuthoringRecovery): Promise<AuthoringSession[]> {
    const operation = context();
    const sessions = (await this.#all()).filter(
      (session) =>
        session.organizationId === operation.organizationId &&
        session.projectId === operation.projectId,
    );
    const recovered: AuthoringSession[] = [];
    for (const current of sessions) {
      if (!["preparing", "recording", "committing"].includes(current.state)) continue;
      const session = await this.#queue.run(current.id, async () => {
        let next = await readAuthoringSession(current.id);
        // Recovery can be requested concurrently by startup, an explicit
        // repair, and a reconnecting UI. Re-check after entering the per-session
        // queue because another recovery may have made this session terminal
        // since #all() produced the outer snapshot.
        if (!next || !["preparing", "recording", "committing"].includes(next.state)) return null;
        if (next.state === "committing") {
          const appMap = await readAppMap(next.projectId, next.appMapId);
          const committed = appMap?.activity[next.commitTransactionId ?? next.id];
          if (appMap && committed?.eventType === "recording.committed") {
            next = transition(next, "committed");
            next.committedConnectionId = committed.subject.id;
            next.expectedAppMapRevision = appMap.revision;
            if (next.take) next.take = { ...next.take, state: "committed" };
          } else {
            next = transition(next, "reviewing");
            next.recoverable = true;
            next.error = "Relay restarted before this Take reached its atomic commit point.";
          }
        } else {
          const reconciled = await recovery.reconcileRecording?.(next);
          if (reconciled?.data && next.take) {
            const evidence = await persistAuthoringEvidence({
              kind: "video",
              capturedAt: now(),
              data: reconciled.data,
              mime: reconciled.mime ?? "video/mp4",
            });
            next = nextRevision(next, "manual", (revision) => ({
              ...revision,
              evidence: [...revision.evidence, evidence],
            }));
          }
          next = transition(next, "failed");
          next.recoveredAt = now();
          next.recoverable = Boolean(next.take);
          next.error =
            "Relay restarted during device capture. Preserved evidence is available for review.";
        }
        // A preserved Take is still useful: its owner can observe the target,
        // review the recovered actions, replay, or commit it. Keep that same
        // exclusive lease so “recoverable” is an actionable state instead of a
        // dead end after restart. Terminal and evidence-free sessions release it.
        if (next.state === "committed" || !next.take) {
          await recovery.releaseLease(next).catch(() => undefined);
        }
        await writeAuthoringSession(next);
        if (next.state === "committed") publishAuthoringCommittedEvent(next);
        else publishAuthoringSessionEvent(next);
        return next;
      });
      if (session) recovered.push(session);
    }
    return recovered;
  }

  async #mutate(
    id: string,
    operation: (session: AuthoringSession) => Promise<AuthoringSession>,
  ): Promise<AuthoringSession> {
    return this.#queue.run(id, async () => {
      const current = await readAuthoringSession(id);
      if (!current) throw new AuthoringStateError("Authoring Session not found");
      const next = await operation(clone(current));
      await writeAuthoringSession(next);
      if (next.state === "recording") this.#recordingReadyAt.set(id, now());
      else if (current.state === "recording") this.#recordingReadyAt.delete(id);
      if (current.state !== "committed" && next.state === "committed")
        publishAuthoringCommittedEvent(next);
      else publishAuthoringSessionEvent(next);
      return clone(next);
    });
  }
}

export const authoringSessions = new AuthoringSessionStore();
