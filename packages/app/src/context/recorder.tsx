import { createSignal } from "solid-js";
import type {
  AuthoringInteraction,
  AuthoringRecordingEdit,
  AuthoringSession,
  AuthoringVideoClip,
} from "@relay/protocol";
import { createSimpleContext } from "@relay/ui/context/helper";
import { useServer } from "./server";
import { nodeAtPoint, targetFromStrategy, type PickStrategy } from "../lib/snapshot";
import { targetIsPhysicalIos, targetIsReady } from "../lib/target-presentation";
import { toast } from "./toast";
import { humanError } from "../lib/human-error";
import {
  canFlushBufferedTypeAfterLiveInput,
  dispatchWithSafePointFallback,
  interactionSucceeded,
} from "../lib/ios-interaction-safety";
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
import {
  projectedObservation,
  sessionRevision,
  snapshotFromAuthoringSession,
  type CapturedMapScreen,
  type CapturedStartScreen,
} from "./recorder-projection";
import { createAuthorTestWorkflowBoundary } from "../lib/author-test-workflow-coordinator";
import { createSingleFlightAction } from "../lib/single-flight-action";
import { createPendingRecordingScopeActions } from "./recorder-pending-scope";
import { createRecorderAuthoringState } from "./recorder-authoring-state";

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
export {
  projectTake,
  selectProjectedAuthoringSession,
  snapshotFromAuthoringSession,
} from "./recorder-projection";
export type {
  CapturedMapScreen,
  CapturedStartScreen,
  RecordingIssue,
  RecordingTake,
  RecordingTakeAction,
} from "./recorder-projection";

export type RecLevel = "smart" | "element" | "point";

export { canFlushBufferedTypeAfterLiveInput } from "../lib/ios-interaction-safety";

export const { use: useRecorder, provider: RecorderProvider } = createSimpleContext({
  name: "Recorder",
  gate: false,
  init: () => {
    const server = useServer();
    const [interacting, setInteracting] = createSignal(false);
    const [localArming, setLocalArming] = createSignal(false);
    const [checkpointBusy, setCheckpointBusy] = createSignal(false);
    const [pendingGroup, setPendingGroup] = createSignal("");
    const [pendingSourceScreenId, setPendingSourceScreenId] = createSignal<string>();
    const [pendingConnectionId, setPendingTransitionId] = createSignal<string>();
    const { workflow: authoringWorkflow, snapshot: workflowSnapshot } =
      createAuthorTestWorkflowBoundary({
        client: { invoke: (id, value) => server.runAction(id, value) },
        refreshAuthoringSessions: server.refreshAuthoringSessions,
        refreshAppMaps: server.refreshAppMaps,
      });

    const {
      activeSession,
      ownsActiveSession,
      take,
      needsAttention: authoringNeedsAttention,
      restoring: restoringAuthoring,
      recording,
      arming,
      issue: recordingIssue,
      group: recordingGroup,
      canRetireRecordingAttempt,
      retireRecordingAttempt,
    } = createRecorderAuthoringState({
      server,
      workflow: authoringWorkflow,
      workflowSnapshot,
      localArming,
      pendingGroup,
    });

    const targetReady = () =>
      targetIsReady(
        server.devices().find((device) => device.serial === server.selectedDevice()),
        server.health() === "online",
      );

    const {
      setRecordingGroup,
      setRecordingSourceScreen,
      setRecordingTransition,
      startNextRecordingGroup,
    } = createPendingRecordingScopeActions({
      hasActiveSession: () => Boolean(activeSession()),
      setGroup: setPendingGroup,
      setSourceScreenId: setPendingSourceScreenId,
      setTransitionId: setPendingTransitionId,
    });

    async function ensureControlLease(serial: string): Promise<string | null> {
      // Validate ownership at the server boundary; a renderer-local id can
      // expire after a process restart, while re-selecting is idempotent.
      await server.setSelectedDevice(serial);
      return server.selectedLeaseId();
    }

    async function ensureDirectControl(): Promise<boolean> {
      if (restoringAuthoring()) {
        toast("Relay is restoring the canonical recording state", "info");
        return false;
      }
      if (authoringNeedsAttention()) {
        toast("Inspect the uncertain recording outcome before controlling this device", "warning");
        return false;
      }
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
      if (restoringAuthoring()) return false;
      if (authoringNeedsAttention()) {
        toast("Inspect the uncertain recording outcome before recording again", "warning");
        return false;
      }
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
            const snapshot = await authoringWorkflow.inspect(existing.id);
            if (!snapshot) {
              toast(
                "This older recording preparation cannot be resumed safely. Cancel it and record the Test again.",
                "warning",
              );
              return false;
            }
            setInteracting(snapshot.stage === "recording");
            return snapshot.stage === "recording";
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
        const snapshot = await authoringWorkflow.start({
          kind: "author-test",
          actorId: server.actorId(),
          title: pendingGroup().trim() || "New Test",
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
          revision: { exact: appMap.revision },
          ...(pendingSourceScreenId() ? { sourceScreenId: pendingSourceScreenId() } : {}),
          ...(pendingConnectionId() ? { pendingConnectionId: pendingConnectionId() } : {}),
        });
        if (snapshot.stage !== "recording") {
          toast(
            humanError(
              snapshot.problems.at(-1)?.detail ||
                "Relay could not prepare this device for recording",
            ),
            "warning",
          );
          return false;
        }
        setInteracting(true);
        return true;
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

    async function inspectRecording(): Promise<boolean> {
      const snapshot = workflowSnapshot();
      const sessionId = snapshot?.authoring?.sessionId ?? activeSession()?.id;
      const inspected = sessionId
        ? await authoringWorkflow.inspect(sessionId)
        : snapshot?.workflow
          ? await authoringWorkflow.inspectDurable(snapshot)
          : undefined;
      return Boolean(inspected && inspected.phase !== "needs-attention");
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
      const stopped = await authoringWorkflow.advance(session.id, { action: "stop" });
      if (!stopped) return;
      if (stopped.stage === "cancelled") {
        setInteracting(false);
        toast("Nothing recorded · returned to the map", "info");
        return;
      }
      const problem = stopped.problems.at(-1);
      if (problem) toast(humanError(problem.detail), "warning");
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
        const recordingHere = recording() && session?.state === "recording" && ownsActiveSession();
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
          // The canonical authoring operation owns selector fallback. A second
          // renderer mutation would be unsafe after an uncertain outcome.
          await authoringWorkflow.record(session.id, {
            kind: "tap",
            target: physicalIosTarget,
            ...(alreadyApplied ? { applied: true } : {}),
          });
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
        const recordingHere = recording() && session?.state === "recording" && ownsActiveSession();
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
          await authoringWorkflow.record(session.id, interaction);
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
      if (
        !session ||
        session.state !== "recording" ||
        !ownsActiveSession() ||
        authoringNeedsAttention()
      )
        return;
      const snapshot =
        snapshotFromAuthoringSession(session) ??
        server.snapshot() ??
        (await server.captureUiSnapshot());
      if (!hasUsableDeviceBounds(snapshot)) return;
      const target = targetFromStrategy(strategy, fx, fy, snapshot.bounds, anchor, relativeAnchor);
      try {
        await authoringWorkflow.record(session.id, { kind: "tap", target });
      } catch (error) {
        toast(humanError(error), "warning");
      }
    }

    async function replayTake(): Promise<boolean> {
      const session = activeSession();
      if (!session || session.state !== "reviewing" || !ownsActiveSession()) return false;
      const replayed = await authoringWorkflow.advance(session.id, { action: "replay" });
      const attempt = replayed?.review?.latestReplay;
      if (attempt?.outcome === "failed" && attempt.error) throw new Error(attempt.error);
      return attempt?.outcome === "passed";
    }

    async function editTake(edit: AuthoringRecordingEdit): Promise<void> {
      const session = activeSession();
      if (!session || session.state !== "reviewing" || !ownsActiveSession()) return;
      await authoringWorkflow.proved(session.id, { action: "edit", edit });
    }

    const addCheckpoint = createSingleFlightAction({
      onBusyChange: setCheckpointBusy,
      action: async (label: string = "Checkpoint"): Promise<void> => {
        const session = activeSession();
        if (!session || session.state !== "recording" || !ownsActiveSession()) return;
        try {
          const snapshot = await authoringWorkflow.advance(session.id, {
            action: "checkpoint",
            label,
          });
          const problem = snapshot?.problems.at(-1);
          if (problem) throw new Error(problem.detail);
        } catch (error) {
          toast(humanError(error, "Could not save this checkpoint"), "warning");
        }
      },
    });

    async function keepTake(
      input: {
        destination?:
          | { kind: "new-screen"; title?: string }
          | { kind: "screen"; screenId: string }
          | { kind: "end" };
      } = {},
    ): Promise<Pick<AuthoringSession, "committedConnectionId" | "committedTestId"> | null> {
      const session = activeSession();
      if (!session || session.state !== "reviewing" || !ownsActiveSession()) return null;
      const committed = await authoringWorkflow.advance(session.id, {
        action: "approve",
        ...input,
      });
      if (committed?.stage !== "committed") {
        const problem = committed?.problems.at(-1);
        if (problem) throw new Error(problem.detail);
        return null;
      }
      setPendingSourceScreenId(undefined);
      setPendingTransitionId(undefined);
      setPendingGroup("");
      return {
        ...(committed.authoring?.committedConnectionId
          ? { committedConnectionId: committed.authoring.committedConnectionId }
          : {}),
        ...(committed.authoring?.committedTestId
          ? { committedTestId: committed.authoring.committedTestId }
          : {}),
      };
    }

    async function discardTake(): Promise<void> {
      const session = activeSession();
      if (!session) {
        toast("Nothing left to discard", "info");
        return;
      }
      if (!ownsActiveSession()) {
        toast("Only the recording owner can discard this Take", "info");
        return;
      }
      try {
        await authoringWorkflow.proved(session.id, {
          action: session.state === "reviewing" ? "discard" : "cancel",
        });
        setPendingSourceScreenId(undefined);
        setPendingTransitionId(undefined);
        setPendingGroup("");
      } catch (error) {
        toast(humanError(error), "warning");
      }
    }

    async function removeTakeStep(index: number): Promise<void> {
      const current = take();
      if (!current) return;
      const actionId = current.actionIds[index];
      if (!actionId) return;
      const indexes = current.actionIds
        .map((id, position) => ({ id, position }))
        .filter((item) => item.id === actionId)
        .map((item) => item.position);
      if (indexes.length > 1) {
        await editTake({
          kind: "replace",
          actionId,
          interaction: {
            kind: "steps",
            steps: indexes
              .filter((position) => position !== index)
              .map((position) => current.steps[position]!),
          },
        });
      } else {
        await editTake({ kind: "remove", actionIds: [actionId] });
      }
    }

    async function reorderTakeActions(actionIds: string[]): Promise<void> {
      await editTake({ kind: "reorder", actionIds: [...actionIds] });
    }

    async function replaceTakeAction(
      actionId: string,
      interaction: AuthoringInteraction,
    ): Promise<void> {
      const current = take();
      if (!current?.actions.some((action) => action.id === actionId)) return;
      await editTake({ kind: "replace", actionId, interaction });
    }

    async function removeTakeAction(actionId: string): Promise<void> {
      const current = take();
      if (!current?.actions.some((action) => action.id === actionId)) return;
      await editTake({ kind: "remove", actionIds: [actionId] });
    }

    async function setTakeVideoClip(videoClip: AuthoringVideoClip): Promise<void> {
      await editTake({ kind: "clip", fromMs: videoClip.startMs, toMs: videoClip.endMs });
    }

    const [typeBuffer, setTypeBuffer] = createSignal("");
    let typeTimer: ReturnType<typeof setTimeout> | undefined;
    let typeDelivery: ReturnType<typeof server.keyDevice> = Promise.resolve({ status: "failed" });

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
      if (session?.state === "recording" && ownsActiveSession() && !authoringNeedsAttention()) {
        await authoringWorkflow.record(session.id, {
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

    return {
      interacting,
      setInteracting,
      checkpointBusy,
      authoringNeedsAttention,
      recording,
      arming,
      recordingIssue,
      recordingGroup,
      take,
      activeSession,
      ownsActiveSession,
      keepTake,
      replayTake,
      editTake,
      addCheckpoint,
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
      inspectRecording,
      canRetireRecordingAttempt,
      retireRecordingAttempt,
      captureStartScreen,
      captureMapScreen,
      stopRecording,
      driveTap,
      driveSwipe,
      typeBuffer,
      feedTypeKey,
      flushType,
      recordPick,
    };
  },
});
