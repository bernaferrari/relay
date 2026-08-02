import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  AuthoringAction,
  AuthoringCommitDestination,
  AuthoringEvidence,
  AuthoringInteraction,
  AuthoringObservation,
  AuthoringReplayAttempt,
  AuthoringSession,
  AuthoringSessionState,
  AuthoringTakeRevision,
  CreateAuthoringSessionInput,
  RecipeStep,
} from "@relay/protocol";
import { serializeAuthoringSession } from "@relay/protocol";
import { currentOperationContext, type OperationContext } from "./operation-context.js";
import { now, publish } from "./events.js";
import { KeyedSerialQueue } from "./coordination-store.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { commitAppMapRecording } from "./app-map.js";
import { mutateStoredAppMap, readAppMap } from "./collaboration.js";
import { authoringEvidenceExists, persistAuthoringEvidence } from "./journey-aggregate.js";

export class AuthoringStateError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "AuthoringStateError";
  }
}

export type CapturedAuthoringObservation = {
  capturedAt: number;
  targetId: string;
  fingerprint: string;
  bounds?: { width: number; height: number };
  nodes?: Array<Record<string, unknown>>;
  screenshot?: { data: Uint8Array; mime: string };
};

export type AuthoringRuntime = {
  observe(session: AuthoringSession): Promise<CapturedAuthoringObservation>;
  execute(session: AuthoringSession, interaction: AuthoringInteraction): Promise<void>;
  replay(session: AuthoringSession, steps: RecipeStep[]): Promise<void>;
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

const TRANSITIONS: Record<AuthoringSessionState, readonly AuthoringSessionState[]> = {
  preparing: ["ready", "failed", "cancelled"],
  ready: ["recording", "cancelled", "failed"],
  recording: ["reviewing", "failed", "cancelled"],
  reviewing: ["committing", "cancelled", "failed"],
  committing: ["committed", "reviewing", "failed"],
  committed: [],
  failed: ["ready", "reviewing", "cancelled"],
  cancelled: [],
};

export function assertAuthoringTransition(
  from: AuthoringSessionState,
  to: AuthoringSessionState,
): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new AuthoringStateError(`Authoring Session cannot transition from ${from} to ${to}`);
  }
}

function transition(session: AuthoringSession, state: AuthoringSessionState): AuthoringSession {
  assertAuthoringTransition(session.state, state);
  return { ...session, state, updatedAt: now() };
}

function root(): string {
  const state =
    (process.env.RELAY_STATE_DIR ?? process.env.GROK_DEVICE_STATE_DIR)?.trim() ||
    join(findWorkspaceRoot(), ".relay");
  return join(state, "authoring-sessions");
}

function safe(value: string): string {
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) throw new Error("Invalid Authoring Session id");
  return value;
}

function pathFor(id: string): string {
  return join(root(), `${safe(id)}.json`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function currentRevision(session: AuthoringSession): AuthoringTakeRevision {
  const take = session.take;
  const revision = take?.revisions.find((item) => item.revision === take.currentRevision);
  if (!take || !revision) throw new AuthoringStateError("Authoring Session has no current Take");
  return revision;
}

async function expectedReplayFingerprints(
  session: AuthoringSession,
  revision: AuthoringTakeRevision,
): Promise<string[]> {
  const appMap = await readAppMap(session.projectId, session.appMapId);
  if (!appMap) throw new AuthoringStateError("App Map no longer exists");
  const configured =
    session.destination ??
    (session.pendingConnectionId
      ? appMap.connections[session.pendingConnectionId]?.destination
      : undefined);
  if (configured?.kind === "end") return [];
  if (configured?.kind === "screen") {
    const screen = appMap.screens[configured.screenId];
    if (!screen) throw new AuthoringStateError("Expected destination screen no longer exists");
    return [
      screen.identity?.fingerprint,
      ...(screen.identity?.aliases ?? []),
      ...screen.variantIds.flatMap((variantId) => {
        const fingerprint = appMap.screenVariants[variantId]?.observation?.fingerprint;
        return fingerprint ? [fingerprint] : [];
      }),
    ].filter((fingerprint): fingerprint is string => Boolean(fingerprint));
  }
  return revision.after?.screen.fingerprint ? [revision.after.screen.fingerprint] : [];
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

function sessionEvent(session: AuthoringSession): void {
  publish({
    type: "resource.updated",
    at: session.updatedAt,
    projectId: session.projectId,
    resource: "recording-session",
    resourceId: session.id,
    revision: session.take?.currentRevision ?? 0,
  });
}

function committedEvent(session: AuthoringSession): void {
  if (!session.committedConnectionId) {
    throw new Error("Committed Authoring Session has no graph connection");
  }
  publish({
    type: "authoring.committed",
    at: session.updatedAt,
    projectId: session.projectId,
    sessionId: session.id,
    appMapId: session.appMapId,
    connectionId: session.committedConnectionId,
    revision: session.expectedAppMapRevision,
  });
}

async function atomicSessionWrite(session: AuthoringSession): Promise<void> {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const destination = pathFor(session.id);
  const staged = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const file = await open(staged, "wx", 0o600);
    try {
      await file.writeFile(serializeAuthoringSession(session));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(staged, destination);
    const directory = await open(root(), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(staged).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    });
  }
}

function parseSession(value: unknown): AuthoringSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<AuthoringSession>;
  if (
    input.schemaVersion !== 1 ||
    typeof input.id !== "string" ||
    typeof input.projectId !== "string" ||
    typeof input.actorId !== "string" ||
    typeof input.state !== "string" ||
    !input.target ||
    typeof input.leaseId !== "string"
  )
    return null;
  return input as AuthoringSession;
}

async function readStoredSession(id: string): Promise<AuthoringSession | null> {
  try {
    return parseSession(JSON.parse(await readFile(pathFor(id), "utf8")));
  } catch {
    return null;
  }
}

function observationId(capturedAt: number, fingerprint: string): string {
  return `observation-${capturedAt.toString(36)}-${fingerprint.slice(0, 12)}`;
}

async function persistObservation(
  captured: CapturedAuthoringObservation,
): Promise<{ observation: AuthoringObservation; evidence: AuthoringEvidence[] }> {
  const snapshot = await persistAuthoringEvidence({
    kind: "snapshot",
    capturedAt: captured.capturedAt,
    data: JSON.stringify({
      fingerprint: captured.fingerprint,
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
        capturedAt: captured.capturedAt,
        data: captured.screenshot.data,
        mime: captured.screenshot.mime,
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
        capturedAt: captured.capturedAt,
        source: "recording",
        deviceId: captured.targetId,
      },
      evidenceIds: evidence.map((item) => item.id),
      ...(captured.bounds ? { bounds: { ...captured.bounds } } : {}),
      ...(captured.nodes ? { nodes: clone(captured.nodes.slice(0, 256)) } : {}),
    },
    evidence,
  };
}

function stableStep(step: RecipeStep, actionId: string, index: number, group?: string): RecipeStep {
  return {
    ...clone(step),
    id: step.id?.trim() || `${actionId}-step-${index + 1}`,
    ...(group?.trim() && !step.group ? { group: group.trim() } : {}),
  };
}

function stepsForInteraction(
  interaction: AuthoringInteraction,
  actionId: string,
  group?: string,
): RecipeStep[] {
  let steps: RecipeStep[];
  switch (interaction.kind) {
    case "tap":
      steps = [{ kind: "tap", target: clone(interaction.target) }];
      break;
    case "type":
      steps = [
        {
          kind: "type",
          text: interaction.text,
          ...(interaction.target ? { target: clone(interaction.target) } : {}),
        },
      ];
      break;
    case "swipe":
      steps = [
        {
          kind: "swipe",
          from: { ...interaction.from },
          to: { ...interaction.to },
          ...(interaction.durationMs !== undefined ? { durationMs: interaction.durationMs } : {}),
        },
      ];
      break;
    case "key":
      steps = [{ kind: "key", key: interaction.key }];
      break;
    case "wait":
      if (!Number.isFinite(interaction.ms) || interaction.ms < 0) {
        throw new AuthoringStateError("Wait duration must be non-negative");
      }
      steps = interaction.ms === 0 ? [] : [{ kind: "sleep", ms: interaction.ms }];
      break;
    case "observe":
    case "screenshot":
      steps = [];
      break;
    case "reusable":
      steps = [
        {
          kind: "module",
          recipeId: interaction.recipeId,
          ...(interaction.bindings ? { bindings: clone(interaction.bindings) } : {}),
        },
      ];
      break;
    case "steps":
      steps = clone(interaction.steps);
      break;
  }
  return steps.map((step, index) => stableStep(step, actionId, index, group));
}

function actionSource(interaction: AuthoringInteraction): AuthoringAction["source"] {
  if (interaction.kind === "reusable") return "reusable";
  if (
    interaction.kind === "steps" ||
    interaction.kind === "observe" ||
    interaction.kind === "screenshot" ||
    interaction.kind === "wait"
  )
    return "manual";
  return "captured";
}

async function finishRecording(
  session: AuthoringSession,
  runtime: AuthoringRuntime,
): Promise<AuthoringSession> {
  const captured = await persistObservation(await runtime.observe(session));
  const video = await runtime.stopVideo?.(session);
  const before = currentRevision(session).before?.capturedAt ?? captured.observation.capturedAt;
  const videoEndMs = Math.max(0, captured.observation.capturedAt - before);
  const videoEvidence = video?.data
    ? [
        await persistAuthoringEvidence({
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
    evidence: [...revision.evidence, ...captured.evidence, ...videoEvidence],
    after: captured.observation,
    ...(videoEvidence[0]
      ? {
          videoClip: {
            startMs: 0,
            endMs: videoEndMs,
          },
        }
      : {}),
  }));
  if (video?.warning) session.error = video.warning;
  return session;
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

export class AuthoringSessionStore {
  readonly #queue = new KeyedSerialQueue();

  async list(projectId = context().projectId): Promise<AuthoringSession[]> {
    return (await this.#all()).filter((item) => item.projectId === projectId);
  }

  async #all(): Promise<AuthoringSession[]> {
    let names: string[];
    try {
      names = await readdir(root());
    } catch {
      return [];
    }
    const sessions = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => readStoredSession(name.slice(0, -5))),
    );
    return sessions
      .filter((item): item is AuthoringSession => Boolean(item))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(clone);
  }

  async recoveryScopes(): Promise<AuthoringRecoveryScope[]> {
    const scopes = new Map<string, AuthoringRecoveryScope>();
    for (const session of await this.#all()) {
      if (!["preparing", "recording", "committing"].includes(session.state)) continue;
      const scope = {
        organizationId: session.organizationId,
        projectId: session.projectId,
      };
      scopes.set(`${scope.organizationId}\0${scope.projectId}`, scope);
    }
    return [...scopes.values()].sort(
      (left, right) =>
        left.organizationId.localeCompare(right.organizationId) ||
        left.projectId.localeCompare(right.projectId),
    );
  }

  async get(id: string): Promise<AuthoringSession> {
    const session = await readStoredSession(id);
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
    await atomicSessionWrite(session);
    sessionEvent(session);
    await this.#pruneAbandoned(operation.projectId);
    return clone(session);
  }

  async #pruneAbandoned(projectId: string): Promise<void> {
    const configured = Number(process.env.RELAY_ABANDONED_AUTHORING_LIMIT ?? 100);
    const limit = Number.isSafeInteger(configured) && configured >= 0 ? configured : 100;
    const abandoned = (await this.#all()).filter(
      (session) =>
        session.projectId === projectId &&
        (session.state === "cancelled" || session.state === "failed"),
    );
    await Promise.all(
      abandoned.slice(limit).map((session) => rm(pathFor(session.id), { force: true })),
    );
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
        session.error = undefined;
        session.recoverable = undefined;
      }
      if (session.take) {
        session = nextRevision(session, "manual", (revision) => ({
          ...revision,
          evidence: [...revision.evidence, ...observed.evidence],
          after: observed.observation,
        }));
      }
      return session;
    });
  }

  async start(id: string, runtime: AuthoringRuntime): Promise<AuthoringSession> {
    return this.#mutate(id, async (session) => {
      assertOwner(session);
      requireState(session, "ready");
      let captured;
      try {
        captured = await persistObservation(await runtime.observe(session));
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
            before: captured.observation,
          },
        ],
        replayAttempts: [],
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
      const startedAt = now();
      if (
        !["steps", "reusable", "observe", "screenshot", "wait"].includes(interaction.kind) &&
        !("applied" in interaction && interaction.applied)
      ) {
        await runtime.execute(session, interaction);
      } else if (interaction.kind === "wait" && interaction.ms > 0) {
        await runtime.execute(session, interaction);
      }
      const captured = await persistObservation(await runtime.observe(session));
      const actionId = `action-${randomUUID()}`;
      const action: AuthoringAction = {
        id: actionId,
        source: actionSource(interaction),
        recordedAt: startedAt,
        startedAt,
        finishedAt: now(),
        steps: stepsForInteraction(interaction, actionId, session.group),
        evidenceIds: captured.evidence.map((item) => item.id),
        ...((interaction.kind === "observe" || interaction.kind === "screenshot") &&
        interaction.label
          ? { label: interaction.label }
          : interaction.kind === "steps" && interaction.label
            ? { label: interaction.label }
            : {}),
      };
      return nextRevision(session, "recording", (revision) => ({
        ...revision,
        actions: [...revision.actions, action],
        evidence: [...revision.evidence, ...captured.evidence],
        after: captured.observation,
      }));
    });
  }

  async stop(id: string, runtime: AuthoringRuntime): Promise<AuthoringSession> {
    return this.#mutate(id, async (session) => {
      assertOwner(session);
      requireState(session, "recording");
      session = await finishRecording(session, runtime);
      session = transition(session, "reviewing");
      session.take = { ...session.take!, state: "reviewing", updatedAt: session.updatedAt };
      return session;
    });
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
      const actions = previous.actions.filter((action) => {
        if (allowed && !allowed.has(action.id)) return false;
        const relativeStart = action.startedAt - start;
        const relativeEnd = action.finishedAt - start;
        if (input.fromMs !== undefined && relativeEnd < input.fromMs) return false;
        if (input.toMs !== undefined && relativeStart > input.toMs) return false;
        return true;
      });
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
        actions: actionIds.map((actionId) => clone(byId.get(actionId)!)),
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
        actions: revision.actions.map((action) =>
          action.id === actionId
            ? {
                ...action,
                source: actionSource(interaction),
                steps: stepsForInteraction(interaction, action.id, session.group),
                ...((interaction.kind === "observe" || interaction.kind === "screenshot") &&
                interaction.label
                  ? { label: interaction.label }
                  : {}),
              }
            : action,
        ),
      }));
    });
  }

  async replay(id: string, runtime: AuthoringRuntime): Promise<AuthoringSession> {
    return this.#mutate(id, async (session) => {
      assertOwner(session);
      requireState(session, "reviewing");
      const revision = currentRevision(session);
      const startedAt = now();
      let outcome: AuthoringReplayAttempt["outcome"] = "passed";
      let error: string | undefined;
      try {
        await runtime.replay(
          session,
          revision.actions.flatMap((action) => action.steps),
        );
      } catch (caught) {
        outcome = "failed";
        error = caught instanceof Error ? caught.message : String(caught);
      }
      const captured = await persistObservation(await runtime.observe(session));
      if (outcome === "passed") {
        const expected = await expectedReplayFingerprints(session, revision);
        if (expected.length > 0 && !expected.includes(captured.observation.screen.fingerprint)) {
          outcome = "failed";
          error = `Replay reached a different screen (expected ${expected[0]}, received ${captured.observation.screen.fingerprint})`;
        }
      }
      const attempt: AuthoringReplayAttempt = {
        id: `replay-${randomUUID()}`,
        takeId: session.take!.id,
        takeRevision: revision.revision,
        startedAt,
        finishedAt: now(),
        outcome,
        evidence: captured.evidence,
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
      const latestAttempt = take.replayAttempts.at(-1);
      if (
        !latestAttempt ||
        latestAttempt.takeRevision !== revision.revision ||
        latestAttempt.outcome !== "passed"
      ) {
        throw new AuthoringStateError("Replay the current Take successfully before committing it");
      }
      session = transition(session, "committing");
      session.commitTransactionId = session.id;
      await atomicSessionWrite(session);
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
              after: revision.after,
              evidenceIds: [...new Set(evidence.map((item) => item.id))],
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
          await atomicSessionWrite(session);
        }
        throw error;
      }
      session = transition(session, "committed");
      session.expectedAppMapRevision = committedRevision!;
      session.committedConnectionId = committedConnectionId;
      session.take = { ...take, state: "committed", updatedAt: session.updatedAt };
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
      return session;
    });
  }

  async cancel(id: string, runtime?: AuthoringRuntime): Promise<AuthoringSession> {
    return this.#mutate(id, async (session) => {
      assertOwner(session);
      if (session.state === "committed" || session.state === "cancelled") return session;
      if (session.state === "recording") {
        if (!runtime) {
          throw new AuthoringStateError(
            "Cancelling an active recording requires target reconciliation",
          );
        }
        session = await finishRecording(session, runtime);
      }
      session = transition(session, "cancelled");
      if (session.take) {
        session.take = { ...session.take, state: "discarded", updatedAt: session.updatedAt };
      }
      return session;
    });
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
      await rm(pathFor(id), { force: true });
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
        let next = (await readStoredSession(current.id))!;
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
        await recovery.releaseLease(next).catch(() => undefined);
        await atomicSessionWrite(next);
        if (next.state === "committed") committedEvent(next);
        else sessionEvent(next);
        return next;
      });
      recovered.push(session);
    }
    return recovered;
  }

  async #mutate(
    id: string,
    operation: (session: AuthoringSession) => Promise<AuthoringSession>,
  ): Promise<AuthoringSession> {
    return this.#queue.run(id, async () => {
      const current = await readStoredSession(id);
      if (!current) throw new AuthoringStateError("Authoring Session not found");
      const next = await operation(clone(current));
      await atomicSessionWrite(next);
      if (current.state !== "committed" && next.state === "committed") committedEvent(next);
      else sessionEvent(next);
      return clone(next);
    });
  }
}

export const authoringSessions = new AuthoringSessionStore();
