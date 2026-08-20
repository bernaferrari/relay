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
  ScreenIdentityObservation,
} from "@relay/protocol";
export { recordedPauseDuration } from "./authoring-recorded-pause.js";
import {
  actionSource,
  recordedPauseAction,
  stepsForInteraction,
} from "./authoring-action-steps.js";
import { AuthoringStateError, transition } from "./authoring-session-state.js";
export { AuthoringStateError, assertAuthoringTransition } from "./authoring-session-state.js";
import { describeSnapshotChrome, serializeAuthoringSession } from "@relay/protocol";
import { currentOperationContext, type OperationContext } from "./operation-context.js";
import { now, publish } from "./events.js";
import { KeyedSerialQueue } from "./coordination-store.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { commitAppMapRecording } from "./app-map.js";
import { mutateStoredAppMap, readAppMap } from "./collaboration.js";
import { authoringEvidenceExists, persistAuthoringEvidence } from "./authoring-evidence.js";
import type { SnapshotNode } from "./device.js";
import {
  compareScreenIdentity,
  observeScreenIdentity,
  resolveScreenIdentity,
} from "./screen-identity.js";

export type CapturedAuthoringObservation = {
  capturedAt: number;
  targetId: string;
  fingerprint: string;
  foregroundApp?: string;
  bounds?: { width: number; height: number };
  nodes?: Array<Record<string, unknown>>;
  screenshot?: { data: Uint8Array; mime: string };
};

export type AuthoringRuntime = {
  observe(session: AuthoringSession): Promise<CapturedAuthoringObservation>;
  execute(session: AuthoringSession, interaction: AuthoringInteraction): Promise<void>;
  replay(session: AuthoringSession, steps: RecipeStep[]): Promise<void>;
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

function root(): string {
  const state = process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
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

async function expectedReplayScreen(
  session: AuthoringSession,
  revision: AuthoringTakeRevision,
): Promise<{ fingerprints: string[]; observations: ScreenIdentityObservation[]; title?: string }> {
  const appMap = await readAppMap(session.projectId, session.appMapId);
  if (!appMap) throw new AuthoringStateError("App Map no longer exists");
  const configured =
    session.destination ??
    (session.pendingConnectionId
      ? appMap.connections[session.pendingConnectionId]?.destination
      : undefined);
  if (configured?.kind === "end") return { fingerprints: [], observations: [] };
  if (configured?.kind === "screen") {
    const screen = appMap.screens[configured.screenId];
    if (!screen) throw new AuthoringStateError("Expected destination screen no longer exists");
    const fingerprints = [
      screen.identity?.fingerprint,
      ...(screen.identity?.aliases ?? []),
      ...screen.variantIds.flatMap((variantId) => {
        const fingerprint = appMap.screenVariants[variantId]?.observation?.fingerprint;
        return fingerprint ? [fingerprint] : [];
      }),
    ].filter((fingerprint): fingerprint is string => Boolean(fingerprint));
    // A planned destination intentionally has no identity yet. Its recorded
    // final observation is still authoritative and must be verified before
    // the placeholder can become a real screen.
    const observations = screen.variantIds.flatMap((variantId) => {
      const observation = appMap.screenVariants[variantId]?.observation;
      return observation ? [observation] : [];
    });
    if (fingerprints.length > 0 || observations.length > 0) {
      return { fingerprints, observations, title: screen.title };
    }
    const fallback = revision.reason === "recording" ? revision.after : undefined;
    const semantic = semanticObservation(fallback);
    return {
      fingerprints: fallback?.screen.fingerprint ? [fallback.screen.fingerprint] : [],
      observations: semantic ? [semantic] : [],
      title: screen.title,
    };
  }
  const semantic = semanticObservation(revision.after);
  return {
    fingerprints: revision.after?.screen.fingerprint ? [revision.after.screen.fingerprint] : [],
    observations: semantic ? [semantic] : [],
  };
}

async function expectedSourceScreen(session: AuthoringSession): Promise<{
  title: string;
  fingerprints: string[];
  observations: ScreenIdentityObservation[];
} | null> {
  const appMap = await readAppMap(session.projectId, session.appMapId);
  if (!appMap) throw new AuthoringStateError("App Map no longer exists");
  const sourceScreenId =
    session.sourceScreenId ??
    (session.pendingConnectionId
      ? appMap.connections[session.pendingConnectionId]?.fromScreenId
      : undefined);
  if (!sourceScreenId) return null;
  const screen = appMap.screens[sourceScreenId];
  if (!screen) throw new AuthoringStateError("Source screen no longer exists");
  const fingerprints = [
    screen.identity?.fingerprint,
    ...(screen.identity?.aliases ?? []),
    ...screen.variantIds.flatMap((variantId) => {
      const fingerprint = appMap.screenVariants[variantId]?.observation?.fingerprint;
      return fingerprint ? [fingerprint] : [];
    }),
  ].filter((fingerprint): fingerprint is string => Boolean(fingerprint));
  const observations = screen.variantIds.flatMap((variantId) => {
    const observation = appMap.screenVariants[variantId]?.observation;
    return observation ? [observation] : [];
  });
  return { title: screen.title, fingerprints: [...new Set(fingerprints)], observations };
}

function semanticObservation(
  observation: AuthoringObservation | undefined,
): ScreenIdentityObservation | undefined {
  if (!observation?.nodes?.length) return undefined;
  return observeScreenIdentity(observation.nodes as SnapshotNode[]);
}

function semanticsMatch(
  observed: AuthoringObservation,
  expected: readonly ScreenIdentityObservation[],
): boolean {
  const semantic = semanticObservation(observed);
  if (!semantic || expected.length === 0) return false;
  return (
    resolveScreenIdentity(
      semantic,
      expected.map((observation, index) => ({ id: `expected-${index}`, observation })),
    ).kind === "existing"
  );
}

/**
 * A recorded destination may contain generated copy, timestamps, or remote
 * content that is expected to change on every replay. Exact semantics remain
 * the first choice, but the same stable application shell is also sufficient
 * when it has multiple matching identifiers and substantially the same role
 * structure. This keeps chat/feed replays meaningful without weakening the
 * stricter source-screen guard or treating a shared app root as a match.
 */
function replayDestinationMatches(
  observed: AuthoringObservation,
  expected: readonly ScreenIdentityObservation[],
): boolean {
  const semantic = semanticObservation(observed);
  if (!semantic || expected.length === 0) return false;
  return expected.some((candidate) => {
    const comparison = compareScreenIdentity(semantic, candidate);
    if (comparison.decision === "match") return true;
    if (comparison.decision !== "possible") return false;

    const expectedIdentifiers = new Set(
      candidate.nodes.flatMap((node) => (node.identifier ? [node.identifier] : [])),
    );
    const observedIdentifiers = new Set(
      semantic.nodes.flatMap((node) => (node.identifier ? [node.identifier] : [])),
    );
    const sharedIdentifiers = [...expectedIdentifiers].filter((identifier) =>
      observedIdentifiers.has(identifier),
    );
    const identifierSignal = comparison.signals.find(
      (signal) => signal.kind === "stable-identifier-overlap",
    );
    const roleLabelSignal = comparison.signals.find(
      (signal) => signal.kind === "role-label-overlap",
    );
    const structuralSignal = comparison.signals.find(
      (signal) => signal.kind === "structural-overlap",
    );
    const expectedInteractiveLabels = new Set(
      candidate.nodes.flatMap((node) =>
        node.label && (node.hittable || /button|imageview/u.test(node.role))
          ? [`${node.role}\u0000${node.label}`]
          : [],
      ),
    );
    const observedInteractiveLabels = new Set(
      semantic.nodes.flatMap((node) =>
        node.label && (node.hittable || /button|imageview/u.test(node.role))
          ? [`${node.role}\u0000${node.label}`]
          : [],
      ),
    );
    const sharedInteractiveLabels = [...expectedInteractiveLabels].filter((label) =>
      observedInteractiveLabels.has(label),
    );
    return (
      sharedIdentifiers.length >= 2 &&
      sharedInteractiveLabels.length >= 2 &&
      sharedInteractiveLabels.length / expectedInteractiveLabels.size >= 0.5 &&
      (identifierSignal?.strength ?? 0) >= 0.8 &&
      (roleLabelSignal?.strength ?? 0) >= 0.2 &&
      (structuralSignal?.strength ?? 0) >= 0.6
    );
  });
}

function observationMatchesExpectedDestination(
  observed: AuthoringObservation,
  expected: { fingerprints: string[]; observations: ScreenIdentityObservation[] },
): boolean {
  const hasExpectedDestination =
    expected.fingerprints.length > 0 || expected.observations.length > 0;
  if (!hasExpectedDestination) return true;
  return (
    expected.fingerprints.includes(observed.screen.fingerprint) ||
    replayDestinationMatches(observed, expected.observations)
  );
}

function destinationMismatchError(
  expected: { fingerprints: string[]; title?: string },
  received: AuthoringObservation,
  activity: "Recording" | "Replay",
): string {
  const chrome = received.nodes ? describeSnapshotChrome(received.nodes) : {};
  const expectedName = expected.title ?? "the expected screen";
  const receivedName = chrome.header ?? chrome.app ?? "a different screen";
  return `${activity} landed on “${receivedName}”, not “${expectedName}”`;
}

/** The live demonstration is the first successful pass. A second device run is
 * only required after the Take is edited, or when the recorded destination
 * does not match the expected screen. */
async function attachLiveDemonstrationAttempt(
  session: AuthoringSession,
): Promise<AuthoringSession> {
  const take = session.take;
  if (!take) return session;
  const revision = currentRevision(session);
  if (!revision.before || !revision.after) return session;
  const latest = take.replayAttempts.at(-1);
  if (latest?.takeRevision === revision.revision) return session;
  const expected = await expectedReplayScreen(session, revision);
  const destination = await destinationForSession(session);
  const stayed = recordingStayedOnSourceError(session, revision, destination);
  const matches = !stayed && observationMatchesExpectedDestination(revision.after, expected);
  const attempt: AuthoringReplayAttempt = {
    id: `replay-${randomUUID()}`,
    takeId: take.id,
    takeRevision: revision.revision,
    startedAt: revision.before.capturedAt,
    finishedAt: Math.max(revision.after.capturedAt, now()),
    outcome: matches ? "passed" : "failed",
    evidence: [],
    ...(matches
      ? {}
      : {
          error: stayed ?? destinationMismatchError(expected, revision.after, "Recording"),
        }),
  };
  return {
    ...session,
    take: {
      ...take,
      replayAttempts: [...take.replayAttempts, attempt],
    },
  };
}

function recordingStayedOnSourceError(
  session: AuthoringSession,
  revision: AuthoringTakeRevision,
  destination: AuthoringCommitDestination | undefined,
): string | undefined {
  if (!revision.before || !revision.after) return undefined;
  if (!revision.actions.some((action) => action.steps.length > 0)) return undefined;
  if (revision.after.screen.fingerprint !== revision.before.screen.fingerprint) return undefined;
  const destScreenId = destination?.kind === "screen" ? destination.screenId : undefined;
  const targetsAnotherScreen =
    destination?.kind === "new-screen" ||
    (Boolean(destScreenId) && destScreenId !== session.sourceScreenId);
  if (!targetsAnotherScreen) return undefined;
  return "Recording did not leave the source screen. If the picture changed, the app likely opened Settings or another process — XCTest is still attached here. Launch that app before trusting this tree.";
}

async function destinationForSession(
  session: AuthoringSession,
  override?: AuthoringCommitDestination,
): Promise<AuthoringCommitDestination | undefined> {
  if (override) return override;
  if (session.destination) return session.destination;
  if (!session.pendingConnectionId) return undefined;
  const appMap = await readAppMap(session.projectId, session.appMapId);
  return appMap?.connections[session.pendingConnectionId]?.destination;
}

async function approvedAfterObservation(
  session: AuthoringSession,
  revision: AuthoringTakeRevision,
  destination?: AuthoringCommitDestination,
): Promise<AuthoringObservation | undefined> {
  const stayed = recordingStayedOnSourceError(session, revision, destination);
  if (stayed) throw new AuthoringStateError(stayed);
  const take = session.take!;
  const latestAttempt = take.replayAttempts.at(-1);
  if (latestAttempt?.takeRevision === revision.revision) {
    if (latestAttempt.outcome === "passed") {
      return latestAttempt.after ?? revision.after;
    }
    throw new AuthoringStateError(
      latestAttempt.error ?? "Replay the current Take successfully before committing it",
    );
  }
  if (revision.reason === "recording" && revision.before && revision.after) {
    const expected = await expectedReplayScreen(session, revision);
    if (observationMatchesExpectedDestination(revision.after, expected)) {
      return revision.after;
    }
    throw new AuthoringStateError(destinationMismatchError(expected, revision.after, "Recording"));
  }
  throw new AuthoringStateError("Replay the current Take successfully before committing it");
}

async function assertExpectedSource(
  session: AuthoringSession,
  observed: AuthoringObservation,
  fallback?: AuthoringObservation,
  activity: "recording" | "replaying" = "recording",
): Promise<void> {
  const expected = await expectedSourceScreen(session);
  const fingerprints = expected?.fingerprints.length
    ? expected.fingerprints
    : fallback?.screen.fingerprint
      ? [fallback.screen.fingerprint]
      : [];
  const expectedSemantics = expected?.observations.length
    ? expected.observations
    : semanticObservation(fallback)
      ? [semanticObservation(fallback)!]
      : [];
  if (
    (fingerprints.length === 0 && expectedSemantics.length === 0) ||
    fingerprints.includes(observed.screen.fingerprint) ||
    semanticsMatch(observed, expectedSemantics) ||
    replayDestinationMatches(observed, expectedSemantics)
  )
    return;
  throw new AuthoringStateError(
    expected
      ? `Navigate the device to “${expected.title}” before ${activity} this connection`
      : "Return the device to the recorded source screen before replaying this connection",
  );
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
      ...(captured.foregroundApp ? { foregroundApp: captured.foregroundApp } : {}),
      ...(captured.nodes ? { nodes: clone(captured.nodes.slice(0, 256)) } : {}),
    },
    evidence,
  };
}

async function finishRecording(
  session: AuthoringSession,
  runtime: AuthoringRuntime,
): Promise<AuthoringSession> {
  const stoppedAt = now();
  // Seal the transport before asking the target for its final state. On a
  // physical Apple device both video and snapshots use XCTest; taking the
  // snapshot first restarts the runner and destroys the active recording.
  // The final observation still happens immediately afterwards and therefore
  // remains the destination state for this Take.
  const video = await runtime.stopVideo?.(session);
  const captured = await persistObservation(await runtime.observe(session));
  const before = currentRevision(session).before?.capturedAt ?? captured.observation.capturedAt;
  const videoEndMs = Math.max(0, stoppedAt - before);
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
  session = nextRevision(session, "recording", (revision) => {
    return {
      ...revision,
      // Pauses are meaningful only between two recorded actions. Time spent
      // inspecting the result and reaching for Stop is authoring overhead,
      // not executable behavior, and must never slow every replay.
      actions: revision.actions,
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
    };
  });
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
  readonly #recordingReadyAt = new Map<string, number>();

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
            before: captured.observation,
            after: captured.observation,
          },
        ],
        replayAttempts: [],
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
      const idleStartedAt = this.#recordingReadyAt.get(id);
      const startedAt = now();
      const previousAction = currentRevision(session).actions.at(-1);
      if (
        !["reusable", "observe", "screenshot", "wait"].includes(interaction.kind) &&
        !("applied" in interaction && interaction.applied)
      ) {
        await runtime.execute(session, interaction);
      } else if (interaction.kind === "wait" && interaction.ms > 0) {
        await runtime.execute(session, interaction);
      }
      const captured = await persistObservation(await runtime.observe(session));
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
        ...((interaction.kind === "observe" || interaction.kind === "screenshot") &&
        interaction.label
          ? { label: interaction.label }
          : interaction.kind === "steps" && interaction.label
            ? { label: interaction.label }
            : {}),
      };
      return nextRevision(session, "recording", (revision) => {
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
          after: captured.observation,
        };
      });
    });
  }

  async stop(id: string, runtime: AuthoringRuntime): Promise<AuthoringSession> {
    try {
      return await this.#mutate(id, async (session) => {
        assertOwner(session);
        requireState(session, "recording");
        session = await finishRecording(session, runtime);
        if (currentRevision(session).actions.length === 0) {
          session = transition(session, "cancelled");
          session.take = { ...session.take!, state: "discarded", updatedAt: session.updatedAt };
          return session;
        }
        session = transition(session, "reviewing");
        session.take = { ...session.take!, state: "reviewing", updatedAt: session.updatedAt };
        return attachLiveDemonstrationAttempt(session);
      });
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
                label: undefined,
                ...((interaction.kind === "observe" ||
                  interaction.kind === "screenshot" ||
                  interaction.kind === "steps") &&
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
      const source = await persistObservation(await runtime.observe(session));
      let sourceMismatch = false;
      try {
        await assertExpectedSource(session, source.observation, revision.before, "replaying");
        await runtime.replay(
          session,
          revision.actions.flatMap((action) => action.steps),
        );
      } catch (caught) {
        outcome = "failed";
        error = caught instanceof Error ? caught.message : String(caught);
        sourceMismatch = /before recording|before replaying/.test(error);
      }
      let captured = sourceMismatch
        ? source
        : await persistObservation(await runtime.observe(session));
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
        evidence: [...source.evidence, ...(captured === source ? [] : captured.evidence)],
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
          session = await finishRecording(session, runtime);
        }
        session = transition(session, "cancelled");
        if (session.take) {
          session.take = { ...session.take, state: "discarded", updatedAt: session.updatedAt };
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
        let next = await readStoredSession(current.id);
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
        await atomicSessionWrite(next);
        if (next.state === "committed") committedEvent(next);
        else sessionEvent(next);
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
      const current = await readStoredSession(id);
      if (!current) throw new AuthoringStateError("Authoring Session not found");
      const next = await operation(clone(current));
      await atomicSessionWrite(next);
      if (next.state === "recording") this.#recordingReadyAt.set(id, now());
      else if (current.state === "recording") this.#recordingReadyAt.delete(id);
      if (current.state !== "committed" && next.state === "committed") committedEvent(next);
      else sessionEvent(next);
      return clone(next);
    });
  }
}

export const authoringSessions = new AuthoringSessionStore();
