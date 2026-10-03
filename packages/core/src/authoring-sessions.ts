import { randomUUID } from "node:crypto";
import type {
  AuthoringCommitDestination,
  AuthoringInteraction,
  AuthoringRecordingEdit,
  AuthoringReplayAttempt,
  AuthoringSession,
  CreateAuthoringSessionInput,
} from "@relay/protocol";
import { CONTROL_AND_RECORD_PROVENANCE } from "@relay/protocol";
export { recordedPauseDuration } from "./authoring-recorded-pause.js";
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
import { currentOperationContext } from "./operation-context.js";
import { now, publish } from "./events.js";
import { KeyedSerialQueue } from "./coordination-store.js";
import {
  listAuthoringSessionFiles,
  readAuthoringSession,
  removeAuthoringSession,
  writeAuthoringSession,
} from "./authoring-session-storage.js";
import { readAppMap } from "./collaboration.js";
import { persistAuthoringEvidence } from "./authoring-evidence.js";
import { commitAuthoringSessionMap } from "./authoring-session-map-commit.js";
import { invalidateAuthoringActionProof } from "./authoring-transition-proof.js";
import { editAuthoringTakeRevision } from "./authoring-recording-edit.js";
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
import { persistCapturedAuthoringObservation } from "./authoring-observation-capture.js";
export type { CapturedAuthoringObservation } from "./authoring-observation-capture.js";
import type {
  AuthoringCommitFault,
  AuthoringRecovery,
  AuthoringRecoveryScope,
  AuthoringRuntime,
} from "./authoring-session-runtime.js";
export type {
  AuthoringCommitFault,
  AuthoringRecovery,
  AuthoringRecoveryScope,
  AuthoringRuntime,
} from "./authoring-session-runtime.js";
import {
  assertAuthoringOwner as assertOwner,
  authoringOperationContext as context,
  cloneAuthoringValue as clone,
  nextAuthoringRevision as nextRevision,
  requireAuthoringState as requireState,
} from "./authoring-session-mutation-support.js";

const recordingLifecycleDependencies = {
  now,
  persistEvidence: persistAuthoringEvidence,
  persistObservation: persistCapturedAuthoringObservation,
  nextRevision,
  writeSession: writeAuthoringSession,
};

export class AuthoringSessionStore {
  readonly #queue = new KeyedSerialQueue();

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
      ...(input.workflowRequestId?.trim()
        ? { workflowRequestId: input.workflowRequestId.trim() }
        : {}),
      ...(input.testName?.trim() ? { testName: input.testName.trim() } : {}),
      state: "preparing",
      target: clone(input.target),
      ...(input.originApplication?.trim()
        ? { originApplication: input.originApplication.trim() }
        : {}),
      captureProvenance: { ...CONTROL_AND_RECORD_PROVENANCE },
      ...(input.debugOrigin ? { debugOrigin: structuredClone(input.debugOrigin) } : {}),
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
      const preserveDestination =
        session.state === "reviewing" || (session.state === "failed" && Boolean(session.take));
      let observed;
      try {
        observed = await persistCapturedAuthoringObservation(await runtime.observe(session));
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
          // Recovery evidence describes the current target. A reviewed take's
          // endpoint still describes where its recorded actions must finish.
          ...(preserveDestination ? {} : { after: observed.observation }),
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
      const captured = await persistCapturedAuthoringObservation(await runtime.observe(session));
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
          captureProvenance: session.captureProvenance,
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
        captured = await persistCapturedAuthoringObservation(await runtime.observe(session));
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
          captureProvenance: session.captureProvenance,
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
    workflowMutation?: NonNullable<AuthoringSession["workflowMutation"]>,
  ): Promise<AuthoringSession> {
    return this.#mutate(
      id,
      async (session) => {
        assertOwner(session);
        requireState(session, "recording");
        return recordAuthoringInteraction(
          session,
          interaction,
          runtime,
          recordingLifecycleDependencies,
        );
      },
      workflowMutation,
    );
  }

  async stop(
    id: string,
    runtime: AuthoringRuntime,
    workflowMutation?: NonNullable<AuthoringSession["workflowMutation"]>,
  ): Promise<AuthoringSession> {
    const stopped = await this.#mutate(
      id,
      async (session) => {
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
      },
      workflowMutation,
    );
    if (stopped.state === "reviewing")
      await archiveSupersededAuthoringReviews({
        replacement: stopped,
        sessions: await this.#all(),
        mutate: async (id, operation) => {
          await this.#mutate(id, async (session) => operation(session));
        },
      });
    return stopped;
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
    return this.edit(id, { kind: "reorder", actionIds });
  }

  async replace(
    id: string,
    actionId: string,
    interaction: AuthoringInteraction,
  ): Promise<AuthoringSession> {
    return this.edit(id, { kind: "replace", actionId, interaction });
  }

  /** Deep recording-review module: callers express one semantic edit while
   * canonical state owns action lookup, structural validation, proof
   * invalidation, and the immutable next revision. */
  async edit(
    id: string,
    edit: AuthoringRecordingEdit,
    workflowMutation?: NonNullable<AuthoringSession["workflowMutation"]>,
  ): Promise<AuthoringSession> {
    return this.#mutate(
      id,
      async (session) => {
        assertOwner(session);
        requireState(session, "reviewing");
        const previous = currentRevision(session);
        const sourceRevision =
          edit.kind === "restore"
            ? session.take!.revisions.find(
                (candidate) => candidate.revision === edit.sourceRevision,
              )
            : undefined;
        if (
          edit.kind === "restore" &&
          (!sourceRevision || sourceRevision.revision >= previous.revision)
        ) {
          throw new AuthoringStateError(
            "Restore source revision must reference an existing prior Take revision",
          );
        }
        return nextRevision(session, "edit", (revision) =>
          editAuthoringTakeRevision({
            revision,
            edit,
            ...(sourceRevision ? { sourceRevision } : {}),
            ...(session.group ? { group: session.group } : {}),
          }),
        );
      },
      workflowMutation,
    );
  }

  async replay(
    id: string,
    runtime: AuthoringRuntime,
    workflowMutation?: NonNullable<AuthoringSession["workflowMutation"]>,
  ): Promise<AuthoringSession> {
    return this.#mutate(
      id,
      async (session) => {
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
        let sourcePreparationFailed = false;
        try {
          await runtime.prepareReplaySource?.(session);
        } catch (caught) {
          outcome = "failed";
          error = `Could not return to the recorded starting screen: ${
            caught instanceof Error ? caught.message : String(caught)
          }`;
          sourcePreparationFailed = true;
        }
        const source = await persistCapturedAuthoringObservation(await runtime.observe(session));
        const actionProofs: NonNullable<AuthoringReplayAttempt["actionProofs"]> = {};
        let replayObservations = retainAuthoringObservations(undefined, [source.observation]);
        if (!replayObservations) {
          throw new AuthoringStateError("Replay source observation could not be retained");
        }
        const evidence = [...source.evidence];
        let sourceMismatch = sourcePreparationFailed;
        if (!sourcePreparationFailed) {
          try {
            await assertExpectedSource(session, source.observation, revision.before, "replaying");
          } catch (caught) {
            outcome = "failed";
            error = caught instanceof Error ? caught.message : String(caught);
            // This try block contains only source validation. Nothing may execute
            // after it fails, regardless of the adapter's exact diagnostic text.
            sourceMismatch = true;
          }
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
                const exit = await persistCapturedAuthoringObservation(
                  await observeReplayActionEndpoint(session),
                );
                const retained = retainAuthoringObservations(replayObservations, [
                  exit.observation,
                ]);
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
          : await persistCapturedAuthoringObservation(await runtime.observe(session));
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
              captured = await persistCapturedAuthoringObservation(await runtime.observe(session));
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
      },
      workflowMutation,
    );
  }

  async commit(
    id: string,
    input: { destination?: AuthoringCommitDestination; createTest?: true; testName?: string },
    fault?: AuthoringCommitFault,
    workflowMutation?: NonNullable<AuthoringSession["workflowMutation"]>,
  ): Promise<AuthoringSession> {
    return this.#mutate(
      id,
      async (session) => {
        assertOwner(session);
        requireState(session, "reviewing");
        if (input.testName?.trim()) session.testName = input.testName.trim();
        const take = session.take!;
        const revision = currentRevision(session);
        const destination = await destinationForSession(session, input.destination);
        const approvedAfter = await approvedAfterObservation(session, revision, destination);
        if (input.createTest && !session.testName?.trim()) {
          throw new AuthoringStateError("A canonical Test name is required before approval");
        }
        session = transition(session, "committing");
        session.commitTransactionId = session.id;
        session.commitTestId = input.createTest ? `test-${session.id}` : undefined;
        await writeAuthoringSession(session);
        let mapCommitted = false;
        let committedConnectionId: string | undefined;
        let committedTestId: string | undefined;
        let committedRevision: number | undefined;
        try {
          const result = await commitAuthoringSessionMap({
            session,
            revision,
            destination: input.destination,
            approvedAfter,
            fault,
          });
          mapCommitted = true;
          committedRevision = result.revision;
          committedConnectionId = result.connectionId;
          committedTestId = result.testId;
          fault?.("after-rename");
        } catch (error) {
          if (!mapCommitted) {
            session = transition(session, "reviewing");
            session.commitTestId = undefined;
            session.error = error instanceof Error ? error.message : String(error);
            await writeAuthoringSession(session);
          }
          throw error;
        }
        session = transition(session, "committed");
        session.expectedAppMapRevision = committedRevision!;
        session.committedConnectionId = committedConnectionId;
        session.committedTestId = committedTestId;
        session.commitTestId = undefined;
        session.take = { ...take, state: "committed", updatedAt: session.updatedAt };
        session.archive = { reason: "committed", archivedAt: session.updatedAt };
        return session;
      },
      workflowMutation,
    );
  }

  async discard(
    id: string,
    workflowMutation?: NonNullable<AuthoringSession["workflowMutation"]>,
  ): Promise<AuthoringSession> {
    return this.#mutate(
      id,
      async (session) => {
        assertOwner(session);
        requireState(session, "reviewing");
        session = transition(session, "cancelled");
        session.take = session.take
          ? { ...session.take, state: "discarded", updatedAt: session.updatedAt }
          : undefined;
        session.archive = { reason: "discarded", archivedAt: session.updatedAt };
        return session;
      },
      workflowMutation,
    );
  }

  async cancel(
    id: string,
    runtime?: AuthoringRuntime,
    workflowMutation?: NonNullable<AuthoringSession["workflowMutation"]>,
  ): Promise<AuthoringSession> {
    return this.#mutate(
      id,
      async (session) => {
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
            { inferCompletion: false },
          );
        }
        session = transition(session, "cancelled");
        if (session.take) {
          session.take = { ...session.take, state: "discarded", updatedAt: session.updatedAt };
          session.archive = { reason: "discarded", archivedAt: session.updatedAt };
        }
        return session;
      },
      workflowMutation,
    );
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
          const testReachedCommit = !next.commitTestId || Boolean(appMap?.tests[next.commitTestId]);
          if (appMap && committed?.eventType === "recording.committed" && testReachedCommit) {
            next = transition(next, "committed");
            next.committedConnectionId = committed.subject.id;
            next.committedTestId = next.commitTestId;
            next.commitTestId = undefined;
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
    workflowMutation?: NonNullable<AuthoringSession["workflowMutation"]>,
  ): Promise<AuthoringSession> {
    return this.#queue.run(id, async () => {
      const current = await readAuthoringSession(id);
      if (!current) throw new AuthoringStateError("Authoring Session not found");
      let next = await operation(clone(current));
      if (workflowMutation) next = { ...next, workflowMutation: clone(workflowMutation) };
      await writeAuthoringSession(next);
      if (current.state !== "committed" && next.state === "committed")
        publishAuthoringCommittedEvent(next);
      else publishAuthoringSessionEvent(next);
      return clone(next);
    });
  }
}

export const authoringSessions = new AuthoringSessionStore();
