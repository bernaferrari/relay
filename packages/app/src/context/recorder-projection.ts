import type {
  AuthoringActionSource,
  AuthoringObservation,
  AuthoringScreenObservation,
  AuthoringSession,
  AuthoringVideoClip,
  AppMap,
  OperationOutput,
  TargetProfile,
} from "@relay/protocol";
import type { RecipeStep, SnapshotNode, SnapshotState } from "./server";

export type RecordingTakeAction = {
  id: string;
  source: AuthoringActionSource;
  label?: string;
  steps: RecipeStep[];
  stepStartIndex: number;
  evidenceUrl?: string;
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
  const actions: RecordingTakeAction[] = [];
  const steps: RecipeStep[] = [];
  const actionIds: string[] = [];
  const stepEvidenceUrls: string[] = [];
  for (const action of revision.actions) {
    const screenshot = action.evidenceIds
      .map((id) => evidenceById.get(id))
      .find((item) => item?.kind === "screenshot");
    const projectedSteps = action.steps.map((step) => structuredClone(step));
    actions.push({
      id: action.id,
      source: action.source,
      ...(action.label ? { label: action.label } : {}),
      steps: projectedSteps,
      stepStartIndex: steps.length,
      ...(screenshot ? { evidenceUrl: evidenceUrl(screenshot.uri, screenshot.mime) } : {}),
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
  const latestReplay = take.replayAttempts
    .filter((attempt) => attempt.takeRevision === revision.revision)
    .at(-1);
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

export function selectProjectedAuthoringSession(
  sessions: readonly AuthoringSession[],
  input: {
    appMapId: string | null;
    targetId: string | null;
    actorId: string;
    dismissedSessionIds?: ReadonlySet<string>;
  },
): AuthoringSession | null {
  const relevant = sessions
    .filter(
      (session) =>
        session.appMapId === input.appMapId &&
        !input.dismissedSessionIds?.has(session.id) &&
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

export function supersededReviewSessionIds(
  sessions: readonly AuthoringSession[],
  current: AuthoringSession,
): string[] {
  return sessions
    .filter(
      (session) =>
        session.state === "reviewing" &&
        session.actorId === current.actorId &&
        session.appMapId === current.appMapId &&
        session.target.targetId === current.target.targetId &&
        session.updatedAt <= current.updatedAt,
    )
    .map((session) => session.id);
}
