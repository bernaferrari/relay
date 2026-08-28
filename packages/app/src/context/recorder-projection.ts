import type {
  AuthoringActionSource,
  AuthoringCaptureProvenance,
  AuthoringObservation,
  AuthoringReplayActionProof,
  AuthoringScreenObservation,
  AuthoringSession,
  AuthoringTransitionProofStatus,
  AuthoringVideoClip,
  AppMap,
  OperationOutput,
  TargetProfile,
} from "@relay/protocol";
import { authoringCaptureProvenance } from "@relay/protocol";
import type { AuthorTestSnapshot } from "@relay/workflows";
import type { RecipeStep, SnapshotNode, SnapshotState } from "./server";

export type RecordingTakeAction = {
  id: string;
  source: AuthoringActionSource;
  label?: string;
  /** The best current evidence for this action. A replay proof supersedes the
   * original capture after a trim, reorder, or replacement. */
  proof?: RecordingTakeActionProof;
  steps: RecipeStep[];
  stepStartIndex: number;
  evidenceUrl?: string;
  /** Immutable action-boundary proof. These resolve the exact observations
   * linked by the owning Take revision (or its latest replay), rather than
   * borrowing the previous/next action's display frame. */
  entranceEvidenceUrl?: string;
  exitEvidenceUrl?: string;
  entranceViewport?: { width: number; height: number };
  exitViewport?: { width: number; height: number };
};

export type RecordingTakeActionProof = {
  source: "recording" | "replay";
  status: AuthoringTransitionProofStatus;
  outcome?: AuthoringReplayActionProof["outcome"];
  transition?: AuthoringReplayActionProof["transition"];
  error?: string;
};

/** UI shape projected from the server-owned immutable Take revision. */
export type RecordingTake = {
  id: string;
  sessionId: string;
  revision: number;
  appMapId: string;
  sourceScreenId?: string;
  pendingConnectionId?: string;
  sourceObservation?: AuthoringScreenObservation;
  destinationObservation?: AuthoringScreenObservation;
  sourceEvidenceUrl?: string;
  destinationEvidenceUrl?: string;
  sourceViewport?: { width: number; height: number };
  destinationViewport?: { width: number; height: number };
  platform: "android" | "ios" | "browser";
  captureProvenance: AuthoringCaptureProvenance;
  startedAt: number;
  finishedAt?: number;
  group: string;
  actions: RecordingTakeAction[];
  steps: RecipeStep[];
  actionIds: string[];
  stepEvidenceUrls: string[];
  state: "recording" | "review";
  videoEvidenceUrl?: string;
  videoClip?: AuthoringVideoClip;
  latestReplay?: { outcome: "passed" | "failed" | "cancelled"; error?: string };
};

export type RecordingIssue = { kind: "setup" | "screen"; message: string };

export type CapturedStartScreen = {
  mapScope: { organizationId: string; projectId: string; appMapId: string };
  targetProfile: TargetProfile;
  observation: AuthoringScreenObservation;
  screenshotUrl?: string;
  evidenceIds: string[];
  evidenceUris: string[];
  semanticNodes: Array<Record<string, unknown>>;
  viewport?: { width: number; height: number };
};

export type CapturedMapScreen = OperationOutput<"app-map.screen.capture"> & { appMap: AppMap };

export function sessionRevision(session: AuthoringSession) {
  const take = session.take;
  return take?.revisions.find((revision) => revision.revision === take.currentRevision);
}

export function projectedObservation(
  value: AuthoringObservation,
): AuthoringScreenObservation | undefined {
  if (!value || typeof value !== "object" || !("screen" in value)) return undefined;
  return structuredClone(value.screen);
}

export function snapshotFromAuthoringSession(session: AuthoringSession): SnapshotState {
  const revision = sessionRevision(session);
  const observation = revision?.after ?? revision?.before;
  if (!observation?.bounds || !observation.nodes?.length) return null;
  const nodes = observation.nodes.map((node) => structuredClone(node) as SnapshotNode);
  return {
    serial: session.target.targetId,
    capturedAt: observation.capturedAt,
    nodes,
    interactive: nodes.filter(
      (node) => node.hittable !== false && node.enabled !== false && Boolean(node.rect),
    ),
    bounds: { ...observation.bounds },
    inspectable: true,
    source: "sdk",
    inspectionState: "active",
  };
}

export function projectTake(
  session: AuthoringSession,
  evidenceUrl: (uri: string, mime?: string) => string,
): RecordingTake | null {
  const take = session.take;
  const revision = sessionRevision(session);
  if (!take || !revision) return null;
  const evidenceById = new Map(revision.evidence.map((item) => [item.id, item]));
  const latestReplay = take.replayAttempts
    .filter((attempt) => attempt.takeRevision === revision.revision)
    .at(-1);
  const revisionObservations = new Map(
    (revision.observations ?? [revision.before, revision.after].filter(Boolean)).map(
      (observation) => [observation!.id, observation!],
    ),
  );
  const replayObservations = new Map(
    (latestReplay?.observations ?? []).map((observation) => [observation.id, observation]),
  );
  const replayEvidenceById = new Map((latestReplay?.evidence ?? []).map((item) => [item.id, item]));
  const screenshotUrl = (
    observation: AuthoringObservation | undefined,
    evidence: ReadonlyMap<string, (typeof revision.evidence)[number]>,
  ) => {
    const screenshot = observation?.evidenceIds
      .map((id) => evidence.get(id))
      .find((item) => item?.kind === "screenshot");
    return screenshot ? evidenceUrl(screenshot.uri, screenshot.mime) : undefined;
  };
  const actions: RecordingTakeAction[] = [];
  const steps: RecipeStep[] = [];
  const actionIds: string[] = [];
  const stepEvidenceUrls: string[] = [];
  for (const action of revision.actions) {
    const screenshot = action.evidenceIds
      .map((id) => evidenceById.get(id))
      .find((item) => item?.kind === "screenshot");
    const projectedSteps = action.steps.map((step) => structuredClone(step));
    const replayProof = latestReplay?.actionProofs?.[action.id];
    const proof: RecordingTakeActionProof | undefined = replayProof
      ? {
          source: "replay",
          status: replayProof.proofStatus,
          outcome: replayProof.outcome,
          transition: replayProof.transition,
          ...(replayProof.error ? { error: replayProof.error } : {}),
        }
      : action.proofStatus
        ? { source: "recording", status: action.proofStatus }
        : undefined;
    const replayEntrance = replayProof?.entranceObservationId
      ? replayObservations.get(replayProof.entranceObservationId)
      : undefined;
    const replayExit = replayProof?.exitObservationId
      ? replayObservations.get(replayProof.exitObservationId)
      : undefined;
    const recordedEntrance = action.entranceObservationId
      ? revisionObservations.get(action.entranceObservationId)
      : undefined;
    const recordedExit = action.exitObservationId
      ? revisionObservations.get(action.exitObservationId)
      : undefined;
    const entrance = replayEntrance ?? recordedEntrance;
    const exit = replayExit ?? recordedExit;
    const entranceEvidenceUrl = replayEntrance
      ? screenshotUrl(replayEntrance, replayEvidenceById)
      : screenshotUrl(recordedEntrance, evidenceById);
    const exitEvidenceUrl = replayExit
      ? screenshotUrl(replayExit, replayEvidenceById)
      : screenshotUrl(recordedExit, evidenceById);
    actions.push({
      id: action.id,
      source: action.source,
      ...(action.label ? { label: action.label } : {}),
      ...(proof ? { proof } : {}),
      steps: projectedSteps,
      stepStartIndex: steps.length,
      ...(screenshot ? { evidenceUrl: evidenceUrl(screenshot.uri, screenshot.mime) } : {}),
      ...(entranceEvidenceUrl ? { entranceEvidenceUrl } : {}),
      ...(exitEvidenceUrl ? { exitEvidenceUrl } : {}),
      ...(entrance?.bounds ? { entranceViewport: { ...entrance.bounds } } : {}),
      ...(exit?.bounds ? { exitViewport: { ...exit.bounds } } : {}),
    });
    for (const step of projectedSteps) {
      steps.push(step);
      actionIds.push(action.id);
      stepEvidenceUrls.push(screenshot ? evidenceUrl(screenshot.uri, screenshot.mime) : "");
    }
  }
  const video = revision.evidence.find((item) => item.kind === "video");
  const screenshotFor = (observation: AuthoringObservation | undefined) => {
    const screenshot = observation?.evidenceIds
      .map((id) => evidenceById.get(id))
      .find((item) => item?.kind === "screenshot");
    return screenshot ? evidenceUrl(screenshot.uri, screenshot.mime) : undefined;
  };
  const sourceEvidenceUrl = screenshotFor(revision.before);
  const destinationEvidenceUrl = screenshotFor(revision.after);
  return {
    id: take.id,
    sessionId: session.id,
    revision: revision.revision,
    appMapId: session.appMapId,
    ...(session.sourceScreenId ? { sourceScreenId: session.sourceScreenId } : {}),
    ...(session.pendingConnectionId ? { pendingConnectionId: session.pendingConnectionId } : {}),
    ...(revision.before ? { sourceObservation: projectedObservation(revision.before) } : {}),
    ...(revision.after ? { destinationObservation: projectedObservation(revision.after) } : {}),
    ...(sourceEvidenceUrl ? { sourceEvidenceUrl } : {}),
    ...(destinationEvidenceUrl ? { destinationEvidenceUrl } : {}),
    ...(revision.before?.bounds ? { sourceViewport: { ...revision.before.bounds } } : {}),
    ...(revision.after?.bounds ? { destinationViewport: { ...revision.after.bounds } } : {}),
    platform: session.target.platform,
    captureProvenance: authoringCaptureProvenance(session.captureProvenance),
    startedAt: take.createdAt,
    ...(session.state !== "recording" ? { finishedAt: take.updatedAt } : {}),
    group: session.group ?? "",
    actions,
    steps,
    actionIds,
    stepEvidenceUrls,
    state: session.state === "recording" ? "recording" : "review",
    ...(video ? { videoEvidenceUrl: evidenceUrl(video.uri, video.mime) } : {}),
    ...(revision.videoClip ? { videoClip: { ...revision.videoClip } } : {}),
    ...(latestReplay
      ? {
          latestReplay: {
            outcome: latestReplay.outcome,
            ...(latestReplay.error ? { error: latestReplay.error } : {}),
          },
        }
      : {}),
  };
}

export function issueFromSession(session: AuthoringSession | null): RecordingIssue | null {
  if (!session || session.state !== "failed" || !session.error) return null;
  return {
    kind: /sign|xcode|runner|developer mode|provision/i.test(session.error) ? "setup" : "screen",
    message: session.error,
  };
}

export function authoringWorkflowNeedsAttention(
  session: AuthoringSession | null,
  snapshot: AuthorTestSnapshot | undefined,
): boolean {
  return Boolean(
    snapshot?.phase === "needs-attention" &&
    (!snapshot.authoring?.sessionId || snapshot.authoring.sessionId === session?.id),
  );
}

export function projectedRecordingIssue(
  session: AuthoringSession | null,
  snapshot: AuthorTestSnapshot | undefined,
): RecordingIssue | null {
  const canonical = issueFromSession(session);
  if (canonical) return canonical;
  const problem = snapshot?.problems.at(-1);
  return problem ? { kind: "screen", message: problem.detail } : null;
}

export function selectProjectedAuthoringSession(
  sessions: readonly AuthoringSession[],
  input: {
    appMapId: string | null;
    targetId: string | null;
    actorId: string;
  },
): AuthoringSession | null {
  const relevant = sessions
    .filter(
      (session) =>
        session.appMapId === input.appMapId &&
        !session.archive &&
        // Failed attempts remain in Activity, but they no longer own the
        // recorder or their expired lease after the workspace recovers.
        !["committed", "cancelled", "failed"].includes(session.state) &&
        (!input.targetId || session.target.targetId === input.targetId),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
  // A collaborator's stopped Take is a proposal, never this actor's modal
  // workspace; opening Relay must not trap a person in stale remote review.
  return (
    relevant.find((session) => session.actorId === input.actorId) ??
    relevant.find((session) => session.state === "recording") ??
    null
  );
}
