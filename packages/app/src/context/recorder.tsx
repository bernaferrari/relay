import { createMemo, createSignal } from "solid-js";
import type {
  AuthoringActionSource,
  AuthoringInteraction,
  AuthoringObservation,
  AuthoringScreenObservation,
  AuthoringSession,
  AuthoringVideoClip,
  AppMap,
  OperationOutput,
  TargetProfile,
} from "@relay/protocol";
import { createSimpleContext } from "@relay/ui/context/helper";
import { useServer, type RecipeStep, type SnapshotNode, type SnapshotState } from "./server";
import { nodeAtPoint, targetFromStrategy, type PickStrategy } from "../lib/snapshot";
import { sentenceForStep } from "../lib/step-sentence";
import { targetIsPhysicalIos, targetIsReady } from "../lib/target-presentation";
import { toast } from "./toast";
import { humanError } from "../lib/human-error";
import { dispatchWithSafePointFallback, interactionSucceeded } from "../lib/ios-interaction-safety";
import type { InteractionAttemptOutcome } from "../lib/server-capture";
import {
  authoringTargetFromPhysicalIosStep,
  buildTapTarget,
  canRetryTapAtPoint,
  currentIosSemanticGeometry,
  hasUsableDeviceBounds,
  logicalBoundsFromCapture,
  physicalIosTapStep,
  semanticTapNode,
  stableLiveTapStep,
} from "../lib/recorder-tap-targeting";

export {
  authoringTargetFromPhysicalIosStep,
  buildTapTarget,
  canRetryTapAtPoint,
  currentIosSemanticGeometry,
  hasUsableDeviceBounds,
  logicalBoundsFromCapture,
  physicalIosTapStep,
  semanticTapNode,
  stableLiveTapStep,
};

export type RecLevel = "smart" | "element" | "point";

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

export const describeStep = sentenceForStep;

/**
 * A live Android key command can be either applied, unavailable, or an iOS
 * command whose outcome is unknown. Only the unavailable case may be followed
 * by the canonical semantic type action. The unknown case is a review stop,
 * never a reason to type again.
 */
export function canFlushBufferedTypeAfterLiveInput(outcome: InteractionAttemptOutcome): boolean {
  return outcome.status !== "ios-outcome-unknown";
}

function sessionRevision(session: AuthoringSession) {
  const take = session.take;
  return take?.revisions.find((revision) => revision.revision === take.currentRevision);
}

function projectedObservation(value: AuthoringObservation): AuthoringScreenObservation | undefined {
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

function issueFromSession(session: AuthoringSession | null): RecordingIssue | null {
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

export const { use: useRecorder, provider: RecorderProvider } = createSimpleContext({
  name: "Recorder",
  gate: false,
  init: () => {
    const server = useServer();
    const [interacting, setInteracting] = createSignal(false);
    const [localArming, setLocalArming] = createSignal(false);
    const [pendingGroup, setPendingGroup] = createSignal("");
    const [dismissedSessionIds, setDismissedSessionIds] = createSignal<ReadonlySet<string>>(
      new Set(),
    );
    const [pendingSourceScreenId, setPendingSourceScreenId] = createSignal<string>();
    const [pendingConnectionId, setPendingTransitionId] = createSignal<string>();

    const activeSession = createMemo(() =>
      selectProjectedAuthoringSession(server.authoringSessions(), {
        appMapId: server.selectedAppMapId(),
        targetId: server.selectedDevice(),
        actorId: server.actorId(),
        dismissedSessionIds: dismissedSessionIds(),
      }),
    );
    const ownsActiveSession = () => activeSession()?.actorId === server.actorId();
    const take = createMemo(() => {
      const session = activeSession();
      return session ? projectTake(session, server.authoringEvidenceUrl) : null;
    });
    const recording = createMemo(() => activeSession()?.state === "recording");
    const arming = createMemo(() => localArming() || activeSession()?.state === "preparing");
    const recordingIssue = createMemo(() => issueFromSession(activeSession()));
    const recordingGroup = createMemo(() => activeSession()?.group ?? pendingGroup());

    const targetReady = () =>
      targetIsReady(
        server.devices().find((device) => device.serial === server.selectedDevice()),
        server.health() === "online",
      );

    function setRecordingGroup(value: string): void {
      if (activeSession()) return;
      setPendingGroup(value.slice(0, 96));
    }

    function setRecordingSourceScreen(value: string | undefined): void {
      if (activeSession()) return;
      setPendingSourceScreenId(value);
    }

    function setRecordingTransition(value: string | undefined): void {
      if (activeSession()) return;
      setPendingTransitionId(value);
    }

    function startNextRecordingGroup(): void {
      if (!activeSession()) setPendingGroup("");
    }

    async function ensureControlLease(serial: string): Promise<string | null> {
      // Validate ownership at the server boundary; a renderer-local id can
      // expire after a process restart, while re-selecting is idempotent.
      await server.setSelectedDevice(serial);
      return server.selectedLeaseId();
    }

    async function ensureDirectControl(): Promise<boolean> {
      const serial = server.selectedDevice();
      if (!serial) return false;
      if (await ensureControlLease(serial)) return true;
      toast(
        humanError(
          server.controlIssue() || "Device control is not available yet. Try again in a moment.",
        ),
        "warning",
      );
      return false;
    }

    async function enterRecordModeCore(): Promise<boolean> {
      const existing = activeSession();
      if (existing) {
        if (!ownsActiveSession()) {
          toast("Another collaborator is using this device", "info");
          return false;
        }
        // On physical iOS, retain a valid observation when video cannot yet
        // start (for example, Home has no active app session).
        if (existing.state === "ready") {
          try {
            const session = await server.startAuthoringSession(existing.id);
            setInteracting(session.state === "recording");
            return session.state === "recording";
          } catch (error) {
            toast(humanError(error), "warning");
            return false;
          }
        }
        return false;
      }
      if (!targetReady()) {
        toast("Choose a ready device before recording", "info");
        window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
        return false;
      }
      const appMapId = server.selectedAppMapId();
      const device = server.devices().find((item) => item.serial === server.selectedDevice());
      const leaseId = device ? await ensureControlLease(device.serial) : null;
      if (!appMapId || !device || !leaseId) {
        toast(
          humanError(
            server.liveCaptureIssue() ||
              "Device control is not available yet. Try again in a moment.",
          ),
          "warning",
        );
        return false;
      }
      try {
        const appMap = await server.loadAppMap(appMapId);
        let session = await server.createAuthoringSession({
          appMapId,
          target:
            device.platform === "browser"
              ? { kind: "browser", platform: "browser", targetId: device.serial }
              : {
                  kind: "device",
                  platform: device.platform === "ios" ? "ios" : "android",
                  targetId: device.serial,
                },
          leaseId,
          expectedAppMapRevision: appMap.revision,
          ...(pendingSourceScreenId() ? { sourceScreenId: pendingSourceScreenId() } : {}),
          ...(pendingConnectionId() ? { pendingConnectionId: pendingConnectionId() } : {}),
          ...(pendingGroup().trim() ? { group: pendingGroup().trim() } : {}),
        });
        session = await server.observeAuthoringSession(session.id);
        if (session.state !== "ready") {
          toast(
            humanError(session.error || "Relay could not prepare this device for recording"),
            "warning",
          );
          return false;
        }
        session = await server.startAuthoringSession(session.id);
        setInteracting(session.state === "recording");
        return session.state === "recording";
      } catch (error) {
        toast(humanError(error), "warning");
        return false;
      }
    }

    async function enterRecordMode(): Promise<boolean> {
      if (localArming()) return false;
      setLocalArming(true);
      try {
        return await enterRecordModeCore();
      } finally {
        setLocalArming(false);
      }
    }

    /** Capture the current target through the authoritative observation
     * boundary, without opening a video transport. The canvas receives
     * identity + durable evidence without inventing an executable action. */
    async function captureStartScreen(
      appMapIdOverride?: string,
    ): Promise<CapturedStartScreen | null> {
      if (activeSession()) {
        toast("Finish the current recording before choosing a start screen", "info");
        return null;
      }
      if (!targetReady()) {
        toast("Choose a ready device before capturing the start screen", "info");
        window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
        return null;
      }
      const appMapId = appMapIdOverride ?? server.selectedAppMapId();
      const device = server.devices().find((item) => item.serial === server.selectedDevice());
      const leaseId = device ? await ensureControlLease(device.serial) : null;
      if (!appMapId || !device || !leaseId) {
        toast(
          humanError(
            server.liveCaptureIssue() ||
              "Device control is not available yet. Try again in a moment.",
          ),
          "warning",
        );
        return null;
      }

      let session: AuthoringSession | null = null;
      try {
        const appMap = await server.loadAppMap(appMapId);
        session = await server.createAuthoringSession({
          appMapId,
          target:
            device.platform === "browser"
              ? { kind: "browser", platform: "browser", targetId: device.serial }
              : {
                  kind: "device",
                  platform: device.platform === "ios" ? "ios" : "android",
                  targetId: device.serial,
                },
          leaseId,
          expectedAppMapRevision: appMap.revision,
        });
        session = await server.captureAuthoringScreen(session.id);
        if (session.state !== "reviewing")
          throw new Error(session.error || "Could not capture the current screen");
        const revision = sessionRevision(session);
        if (!revision) throw new Error("The captured screen did not include durable evidence");
        const observation = revision?.before ? projectedObservation(revision.before) : undefined;
        const screenshot = revision?.evidence.find((item) => item.kind === "screenshot");
        if (!observation) throw new Error("The device did not return a screen observation");
        await server.discardAuthoringSession(session.id);
        session = null;
        return {
          mapScope: {
            organizationId: appMap.organizationId,
            projectId: appMap.projectId,
            appMapId: appMap.id,
          },
          targetProfile: {
            id: `target:${device.platform === "ios" ? "ios" : device.platform === "browser" ? "browser" : "android"}:${device.serial}`,
            targetId: device.serial,
            source: device.platform === "browser" ? "browser" : "device",
            platform:
              device.platform === "ios"
                ? "ios"
                : device.platform === "browser"
                  ? "browser"
                  : "android",
            name: device.name?.trim() || device.serial,
            ...(typeof device.osVersion === "string" && device.osVersion.trim()
              ? { osVersion: device.osVersion.trim() }
              : {}),
            ...(revision.before?.bounds ? { viewport: { ...revision.before.bounds } } : {}),
            capabilities: ["snapshot", "screenshot"],
            observedAt: observation.capturedAt,
          },
          observation,
          evidenceIds: revision.evidence
            .filter((item) => item.kind === "screenshot")
            .map((item) => item.id),
          evidenceUris: revision.evidence
            .filter((item) => item.kind === "screenshot")
            .map((item) => item.uri),
          semanticNodes: revision.before?.nodes?.map((node) => structuredClone(node)) ?? [],
          ...(revision.before?.bounds ? { viewport: { ...revision.before.bounds } } : {}),
          ...(screenshot
            ? { screenshotUrl: server.authoringEvidenceUrl(screenshot.uri, screenshot.mime) }
            : {}),
        };
      } catch (error) {
        toast(humanError(error), "warning");
        return null;
      } finally {
        if (session) {
          if (session.state === "reviewing") {
            await server.discardAuthoringSession(session.id).catch(() => undefined);
          } else {
            await server.cancelAuthoringSession(session.id).catch(() => undefined);
          }
        }
      }
    }

    /** Save the current target as a canonical App Map screen through the same
     * operation used by the CLI and MCP. Unlike captureStartScreen, this
     * mutates the map and never creates a placeholder transition. */
    async function captureMapScreen(
      appMapIdOverride?: string,
      options: { title?: string; position?: { x: number; y: number } } = {},
    ): Promise<CapturedMapScreen | null> {
      if (activeSession()) {
        toast("Finish the current recording before saving another screen", "info");
        return null;
      }
      if (!targetReady()) {
        toast("Choose a ready device before saving its screen", "info");
        window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
        return null;
      }
      const appMapId = appMapIdOverride ?? server.selectedAppMapId();
      const device = server.devices().find((item) => item.serial === server.selectedDevice());
      const leaseId = device ? await ensureControlLease(device.serial) : null;
      if (!appMapId || !device || !leaseId) {
        toast(
          humanError(
            server.liveCaptureIssue() ||
              "Device control is not available yet. Try again in a moment.",
          ),
          "warning",
        );
        return null;
      }
      try {
        const appMap = await server.loadAppMap(appMapId);
        const result = await server.runAction("app-map.screen.capture", {
          appMapId,
          expectedRevision: appMap.revision,
          target:
            device.platform === "browser"
              ? { kind: "browser", platform: "browser", targetId: device.serial }
              : {
                  kind: "device",
                  platform: device.platform === "ios" ? "ios" : "android",
                  targetId: device.serial,
                },
          leaseId,
          ...(options.title?.trim() ? { title: options.title.trim() } : {}),
          ...(options.position ? { position: options.position } : {}),
        });
        // A short-lived Authoring Session keeps CLI, MCP, and UI on one
        // observation boundary; refresh projections after its invisible cleanup.
        await Promise.all([server.refreshAppMaps(), server.refreshAuthoringSessions()]);
        if (result.reviewProposalId) {
          toast("Screen changed · review the old and new capture before replacing it", "info");
        }
        return { ...result, appMap: await server.loadAppMap(appMapId) };
      } catch (error) {
        toast(humanError(error), "warning");
        return null;
      }
    }

    async function stopRecording(): Promise<void> {
      await flushType();
      const session = activeSession();
      if (!session || !ownsActiveSession() || session.state !== "recording") return;
      const stopped = await server.stopAuthoringSession(session.id);
      if (stopped.state === "cancelled") {
        setDismissedSessionIds((current) => new Set([...current, stopped.id]));
        setInteracting(false);
        toast("Nothing recorded · returned to the map", "info");
        return;
      }
      if (stopped.error) toast(humanError(stopped.error), "warning");
      setInteracting(true);
    }

    async function driveTap(
      fx: number,
      fy: number,
      alreadyApplied = false,
      imageSize?: { width: number; height: number },
    ): Promise<boolean> {
      if (server.health() !== "online") return false;
      try {
        const session = activeSession();
        const recordingHere = session?.state === "recording" && ownsActiveSession();
        // A recording session owns the lease and is the execute + record
        // boundary; a second direct path could race it on physical iOS.
        if (!recordingHere && !alreadyApplied && !(await ensureDirectControl())) return false;
        await flushType();
        const selectedDevice = server
          .devices()
          .find((device) => device.serial === server.selectedDevice());
        const physicalIos = targetIsPhysicalIos(selectedDevice);
        // A visible iPad surface is enough to aim a point; do not start a
        // slow XCTest traversal when the semantic plane is unavailable.
        const snapshot = recordingHere
          ? snapshotFromAuthoringSession(session)
          : (server.snapshot() ?? (physicalIos ? null : await server.captureUiSnapshot()));
        const liveFrame = server.liveFrame();
        const bounds = logicalBoundsFromCapture({
          snapshot,
          imageWidth: imageSize?.width ?? liveFrame?.width,
          imageHeight: imageSize?.height ?? liveFrame?.height,
        });
        if (!bounds) {
          toast("Relay needs a live screen to aim this gesture", "warning");
          return alreadyApplied;
        }
        const node =
          snapshot && (!physicalIos || currentIosSemanticGeometry(snapshot))
            ? nodeAtPoint(snapshot, fx, fy)
            : null;
        const semanticNode = semanticTapNode(snapshot, node);
        const target = buildTapTarget(bounds, semanticNode, fx, fy);
        const physicalIosStep = physicalIosTapStep(snapshot, semanticNode, target);
        const physicalIosTarget = physicalIos
          ? authoringTargetFromPhysicalIosStep(physicalIosStep, target)
          : target;
        if (recordingHere && session) {
          const primary = () =>
            server.interactAuthoringSession(session.id, {
              kind: "tap",
              target: physicalIosTarget,
              ...(alreadyApplied ? { applied: true } : {}),
            });
          if (physicalIos) {
            await dispatchWithSafePointFallback({
              platform: "ios",
              kind: "tap",
              hasPoint: !alreadyApplied && Boolean(target.point),
              attempt: primary,
              pointFallback: () =>
                server.interactAuthoringSession(session.id, {
                  kind: "tap",
                  target: { point: target.point! },
                }),
            });
          } else {
            try {
              await primary();
            } catch (error) {
              if (alreadyApplied || !target.point || !canRetryTapAtPoint(error)) throw error;
              await server.interactAuthoringSession(session.id, {
                kind: "tap",
                target: { point: target.point },
              });
            }
          }
          return true;
        }
        if (alreadyApplied) return true;
        // Core owns iOS selector fallback; every other failure is review-only.
        if (physicalIos) {
          if (!physicalIosStep) return false;
          const step =
            physicalIosStep.kind === "identifier"
              ? {
                  kind: "identifier" as const,
                  identifier: physicalIosStep.identifier,
                  point: { x: physicalIosStep.x, y: physicalIosStep.y },
                }
              : physicalIosStep.kind === "label"
                ? {
                    kind: "label" as const,
                    label: physicalIosStep.label,
                    point: { x: physicalIosStep.x, y: physicalIosStep.y },
                  }
                : physicalIosStep;
          const outcome = await dispatchWithSafePointFallback({
            platform: "ios",
            kind: step.kind,
            hasPoint: Boolean(target.point),
            attempt: () => server.interactStep(step),
            failedResult: (result) => !interactionSucceeded(result),
            failureForResult: (result) => result.iosFailure,
            pointFallback: () =>
              target.point
                ? server.interactStep({
                    kind: "point",
                    x: target.point.x,
                    y: target.point.y,
                  })
                : Promise.resolve({ status: "failed" as const }),
          });
          return interactionSucceeded(outcome);
        }
        const stableStep = stableLiveTapStep(target);
        if (!stableStep) return false;
        try {
          return interactionSucceeded(await server.interactStep(stableStep));
        } catch (error) {
          if (stableStep.kind === "point" || !target.point || !canRetryTapAtPoint(error)) {
            throw error;
          }
          return interactionSucceeded(
            await server.interactStep({ kind: "point", x: target.point.x, y: target.point.y }),
          );
        }
      } catch (error) {
        toast(humanError(error), "warning");
        return false;
      }
    }

    async function driveSwipe(
      from: { x: number; y: number },
      to: { x: number; y: number },
      durationMs: number,
      alreadyApplied = false,
      imageSize?: { width: number; height: number },
    ): Promise<boolean> {
      if (server.health() !== "online") return false;
      try {
        const session = activeSession();
        const recordingHere = session?.state === "recording" && ownsActiveSession();
        if (!recordingHere && !alreadyApplied && !(await ensureDirectControl())) return false;
        await flushType();
        const selectedDevice = server
          .devices()
          .find((device) => device.serial === server.selectedDevice());
        const physicalIos = targetIsPhysicalIos(selectedDevice);
        const snapshot = recordingHere
          ? snapshotFromAuthoringSession(session)
          : (server.snapshot() ?? (physicalIos ? null : await server.captureUiSnapshot()));
        const liveFrame = server.liveFrame();
        const bounds = logicalBoundsFromCapture({
          snapshot,
          imageWidth: imageSize?.width ?? liveFrame?.width,
          imageHeight: imageSize?.height ?? liveFrame?.height,
        });
        if (!bounds) return alreadyApplied;
        const pin = {
          anchor: { horizontal: "left" as const, vertical: "top" as const },
          referenceBounds: { ...bounds },
        };
        const interaction: AuthoringInteraction = {
          kind: "swipe",
          from: {
            x: Math.round(from.x * bounds.width),
            y: Math.round(from.y * bounds.height),
            ...pin,
          },
          to: {
            x: Math.round(to.x * bounds.width),
            y: Math.round(to.y * bounds.height),
            ...pin,
          },
          durationMs,
          ...(alreadyApplied ? { applied: true } : {}),
        };
        if (recordingHere && session) {
          await server.interactAuthoringSession(session.id, interaction);
          return true;
        }
        if (alreadyApplied) return true;
        return interactionSucceeded(
          await server.interactStep({
            kind: "swipe",
            from: interaction.from,
            to: interaction.to,
            durationMs,
          }),
        );
      } catch (error) {
        toast(humanError(error), "warning");
        return false;
      }
    }
    async function recordPick(
      strategy: PickStrategy,
      fx: number,
      fy: number,
      anchor: {
        horizontal: "left" | "center" | "right";
        vertical: "top" | "center" | "bottom";
      } = { horizontal: "left", vertical: "top" },
      relativeAnchor?: Parameters<typeof targetFromStrategy>[5],
    ): Promise<void> {
      const session = activeSession();
      if (!session || session.state !== "recording" || !ownsActiveSession()) return;
      const snapshot =
        snapshotFromAuthoringSession(session) ??
        server.snapshot() ??
        (await server.captureUiSnapshot());
      if (!hasUsableDeviceBounds(snapshot)) return;
      const target = targetFromStrategy(strategy, fx, fy, snapshot.bounds, anchor, relativeAnchor);
      try {
        await server.interactAuthoringSession(session.id, { kind: "tap", target });
      } catch (error) {
        toast(humanError(error), "warning");
      }
    }

    async function replayTake(): Promise<boolean> {
      const session = activeSession();
      if (!session || session.state !== "reviewing" || !ownsActiveSession()) return false;
      const replayed = await server.replayAuthoringTake(session.id);
      const attempt = replayed.take?.replayAttempts.at(-1);
      if (attempt?.outcome === "failed" && attempt.error) throw new Error(attempt.error);
      return attempt?.outcome === "passed";
    }

    async function keepTake(
      input: {
        destination?:
          | { kind: "new-screen"; title?: string }
          | { kind: "screen"; screenId: string }
          | { kind: "end" };
      } = {},
    ): Promise<AuthoringSession | null> {
      const session = activeSession();
      if (!session || session.state !== "reviewing" || !ownsActiveSession()) return null;
      // Close local review immediately; slow iOS map refreshes must not make a
      // successful approval look ignored. Restore it only on persistence failure.
      const dismissedIds = supersededReviewSessionIds(server.authoringSessions(), session);
      setDismissedSessionIds((current) => new Set([...current, ...dismissedIds]));
      try {
        const committed = await server.commitAuthoringSession(session.id, input);
        setPendingSourceScreenId(undefined);
        setPendingTransitionId(undefined);
        setPendingGroup("");
        toast(
          "Path kept on the map · record another, capture a screenshot, or run the path",
          "success",
        );
        return committed;
      } catch (error) {
        setDismissedSessionIds((current) => {
          const next = new Set(current);
          for (const id of dismissedIds) next.delete(id);
          return next;
        });
        throw error;
      }
    }

    async function discardTake(): Promise<void> {
      const session = activeSession();
      // Always clear local review chrome first so Discard never leaves the
      // person stuck on a dead review panel if the server call fails or the
      // session is no longer owned by this actor.
      setPendingSourceScreenId(undefined);
      setPendingTransitionId(undefined);
      setPendingGroup("");
      if (!session) {
        toast("Nothing left to discard", "info");
        return;
      }
      const dismissedIds = supersededReviewSessionIds(server.authoringSessions(), session);
      setDismissedSessionIds((current) => new Set([...current, ...dismissedIds]));
      if (!ownsActiveSession()) {
        // This is stale local presentation state, not a user-facing failure.
        // Clear it quietly instead of exposing internal session ownership.
        return;
      }
      try {
        if (session.state === "reviewing") await server.discardAuthoringSession(session.id);
        else await server.cancelAuthoringSession(session.id);
      } catch (error) {
        // Keep it dismissed locally so the map is usable; surface the failure.
        toast(humanError(error), "warning");
      }
    }

    async function removeTakeStep(index: number): Promise<void> {
      const current = take();
      const session = activeSession();
      if (!current || !session || !ownsActiveSession()) return;
      const actionId = current.actionIds[index];
      if (!actionId) return;
      const indexes = current.actionIds
        .map((id, position) => ({ id, position }))
        .filter((item) => item.id === actionId)
        .map((item) => item.position);
      if (indexes.length > 1) {
        await server.replaceAuthoringAction(session.id, actionId, {
          kind: "steps",
          steps: indexes
            .filter((position) => position !== index)
            .map((position) => current.steps[position]!),
        });
      } else {
        const actionIds = [...new Set(current.actionIds.filter((id) => id !== actionId))];
        await server.trimAuthoringTake(session.id, { actionIds });
      }
    }

    async function reorderTakeActions(actionIds: string[]): Promise<void> {
      const current = take();
      const session = activeSession();
      if (!current || !session || session.state !== "reviewing" || !ownsActiveSession()) return;
      await server.reorderAuthoringTake(session.id, [...actionIds]);
    }

    async function replaceTakeAction(
      actionId: string,
      interaction: AuthoringInteraction,
    ): Promise<void> {
      const current = take();
      const session = activeSession();
      if (
        !current ||
        !session ||
        session.state !== "reviewing" ||
        !ownsActiveSession() ||
        !current.actions.some((action) => action.id === actionId)
      )
        return;
      await server.replaceAuthoringAction(session.id, actionId, interaction);
    }

    async function removeTakeAction(actionId: string): Promise<void> {
      const current = take();
      const session = activeSession();
      if (!current || !session || session.state !== "reviewing" || !ownsActiveSession()) return;
      if (!current.actions.some((action) => action.id === actionId)) return;
      await server.trimAuthoringTake(session.id, {
        actionIds: current.actions
          .map((action) => action.id)
          .filter((candidate) => candidate !== actionId),
      });
    }

    async function setTakeVideoClip(videoClip: AuthoringVideoClip): Promise<void> {
      const session = activeSession();
      if (!session || !ownsActiveSession()) return;
      await server.trimAuthoringTake(session.id, {
        fromMs: videoClip.startMs,
        toMs: videoClip.endMs,
      });
    }

    const [typeBuffer, setTypeBuffer] = createSignal("");
    let typeTimer: ReturnType<typeof setTimeout> | undefined;
    let typeDelivery = Promise.resolve<InteractionAttemptOutcome>({ status: "failed" });

    function queueDeviceKey(
      input: { kind: "text"; text: string } | { kind: "key"; key: "enter" | "backspace" },
    ): void {
      typeDelivery = typeDelivery.then(async () => {
        if (!(await ensureDirectControl())) return { status: "failed" } as const;
        return server.keyDevice(input);
      });
    }

    function scheduleTypeFlush(): void {
      clearTimeout(typeTimer);
      typeTimer = setTimeout(() => void flushType(), 800);
    }

    async function flushType(): Promise<void> {
      if (typeTimer) clearTimeout(typeTimer);
      typeTimer = undefined;
      const text = typeBuffer();
      setTypeBuffer("");
      const delivery = await typeDelivery;
      typeDelivery = Promise.resolve({ status: "failed" });
      if (!text) return;
      if (!canFlushBufferedTypeAfterLiveInput(delivery)) return;
      const applied = interactionSucceeded(delivery);
      const session = activeSession();
      if (session?.state === "recording" && ownsActiveSession()) {
        await server.interactAuthoringSession(session.id, {
          kind: "type",
          text,
          ...(applied ? { applied: true } : {}),
        });
      } else if (!applied) {
        await server.interactStep({ kind: "type", text });
      }
    }

    function feedTypeKey(event: KeyboardEvent): boolean {
      if (event.key === "Escape") {
        void flushType();
        return true;
      }
      if (event.key === "Enter") {
        queueDeviceKey({ kind: "key", key: "enter" });
        void flushType();
        return true;
      }
      if (event.key === "Backspace") {
        queueDeviceKey({ kind: "key", key: "backspace" });
        setTypeBuffer((value) => Array.from(value).slice(0, -1).join(""));
        scheduleTypeFlush();
        return true;
      }
      if (Array.from(event.key).length === 1) {
        queueDeviceKey({ kind: "text", text: event.key });
        setTypeBuffer((value) => value + event.key);
        scheduleTypeFlush();
        return true;
      }
      return false;
    }

    async function forkRecipe(recipe: {
      title: string;
      description?: string;
      steps: RecipeStep[];
    }): Promise<void> {
      const saved = await server.saveRecipeRemote({
        title: `${recipe.title} (copy)`,
        description: recipe.description,
        steps: recipe.steps,
      });
      if (saved) {
        server.setSelectedRecipeId(saved.id);
        toast(`Created a copy of “${recipe.title}”`, "success");
      }
    }

    return {
      interacting,
      setInteracting,
      recording,
      arming,
      recordingIssue,
      recordingGroup,
      take,
      activeSession,
      ownsActiveSession,
      keepTake,
      replayTake,
      discardTake,
      removeTakeStep,
      reorderTakeActions,
      replaceTakeAction,
      removeTakeAction,
      setTakeVideoClip,
      setRecordingGroup,
      setRecordingSourceScreen,
      setRecordingTransition,
      startNextRecordingGroup,
      enterRecordMode,
      captureStartScreen,
      captureMapScreen,
      stopRecording,
      driveTap,
      driveSwipe,
      typeBuffer,
      feedTypeKey,
      flushType,
      recordPick,
      forkRecipe,
    };
  },
});
