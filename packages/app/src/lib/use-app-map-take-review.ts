import { createEffect, createSignal } from "solid-js";
import type { AppMapCanvasState } from "@relay/protocol";
import type { MapTreeNode } from "./app-map-tree";
import type { CanvasConnection } from "./app-map-connection-draft";
import {
  resolveTakeReviewDestination,
  takeReplayFromLatest,
  type AppMapReplayState,
} from "./app-map-workspace-helpers";
import { screenForObservation, type TakeDestination } from "./app-map-canvas-graph";
import { useRecorder } from "../context/recorder";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { targetIsReady } from "./target-presentation";
import type { DeviceInfo } from "./api-types";

type GraphLike = NonNullable<AppMapCanvasState["graph"]>;

/**
 * Owns take-review destination resolution, replay state, and keep/discard/rewrite.
 * Recording entry points stay in the workspace so device/canvas selection can
 * resume the same intent.
 */
export function useAppMapTakeReview(options: {
  loadedAppMapId: () => string | null;
  graph: () => GraphLike;
  connections: () => CanvasConnection[];
  treeNodes: () => MapTreeNode[];
  titleFor: (node: MapTreeNode) => string;
  selectedNodeId: () => string | null;
  selectedDevice: () => DeviceInfo | null | undefined;
  setCaptureOpen: (open: boolean) => void;
  openDevicePicker: () => void;
  selectNode: (node: MapTreeNode) => void;
  getPendingConnectionId: () => string | null;
  setPendingConnectionId: (id: string | null) => void;
  getRecordingSourceScreenId: () => string | null;
  setRecordingSourceScreenId: (id: string | null) => void;
  onPathKept?: (testId?: string) => void;
}) {
  const recorder = useRecorder();
  const server = useServer();
  const [reviewStepIndex, setReviewStepIndex] = createSignal(0);
  const [reviewDestination, setReviewDestination] = createSignal<TakeDestination>({
    kind: "new-screen",
  });
  const [takeReplay, setTakeReplay] = createSignal<{
    takeId: string | null;
    state: AppMapReplayState;
    error?: string;
  }>({ takeId: null, state: "idle" });
  let destinationResolvedForTake = "";
  let replayHydratedForTakeRevision = "";

  createEffect(() => {
    const take = recorder.take();
    const lastIndex = Math.max(0, (take?.state === "review" ? take.steps.length : 1) - 1);
    setReviewStepIndex((index) => Math.min(lastIndex, Math.max(0, index)));
    const key = take
      ? `${take.id}:${take.revision}:${take.latestReplay?.outcome ?? "none"}:${take.latestReplay?.error ?? ""}`
      : "";
    if (replayHydratedForTakeRevision === key) return;
    replayHydratedForTakeRevision = key;
    const replay = take?.state === "review" ? take.latestReplay : undefined;
    setTakeReplay(
      takeReplayFromLatest({
        takeId: take?.id,
        outcome: replay?.outcome,
        error: replay?.error,
      }),
    );
  });

  createEffect(() => {
    const take = recorder.take();
    if (!take || take.state !== "review" || options.loadedAppMapId() !== take.appMapId) return;
    const match = screenForObservation(options.graph(), take.destinationObservation);
    const plannedConnectionId = take.pendingConnectionId ?? options.getPendingConnectionId();
    const planned = plannedConnectionId
      ? options.connections().find((connection) => connection.id === plannedConnectionId)
      : undefined;
    const key = `${take.id}:${take.revision}:${planned?.id ?? "unplanned"}`;
    if (destinationResolvedForTake === key) return;
    destinationResolvedForTake = key;
    setReviewDestination(
      resolveTakeReviewDestination({
        matchedScreenId: match?.id,
        plannedToScreenId: planned?.toScreenId,
      }),
    );
  });

  const canReplayOnDevice = async () => {
    // Replay performs its own authoritative observation. Requiring a cached
    // live PNG here traps physical-iPad reviews after Stop, precisely when the
    // exclusive runner has released and the cached preview may be absent.
    let device = options.selectedDevice();
    if (!targetIsReady(device, server.health() === "online")) {
      await server.refreshDevices();
      device = options.selectedDevice();
    }
    if (targetIsReady(device, server.health() === "online") && device) {
      // A long review or renderer refresh may outlive its short control lease.
      // Re-selecting the same target is an idempotent lease refresh; the
      // person should not have to leave review and choose the iPad again.
      if (!server.selectedLeaseId()) await server.setSelectedDevice(device.serial);
      if (server.selectedLeaseId() && !server.controlIssue()) return true;
    }
    toast("Choose a ready device before trying this path", "info");
    options.openDevicePicker();
    return false;
  };

  const replayTake = async () => {
    const take = recorder.take();
    if (!take || !(await canReplayOnDevice())) return;
    setTakeReplay({ takeId: take.id, state: "running" });
    let passed = false;
    let error: string | undefined;
    try {
      passed = await recorder.replayTake();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    setTakeReplay(
      passed
        ? { takeId: take.id, state: "passed" }
        : { takeId: take.id, state: "failed", error: error ?? "Replay did not pass" },
    );
    if (!passed) options.setCaptureOpen(true);
  };

  const keepTake = async () => {
    const take = recorder.take();
    if (!take || takeReplay().takeId !== take.id || takeReplay().state !== "passed") return;
    const appMapId = server.selectedAppMapId();
    const committed = await recorder.keepTake({
      destination: reviewDestination(),
    });
    if (committed) {
      const next = appMapId ? await server.loadAppMap(appMapId) : null;
      const destination = committed.committedConnectionId
        ? next?.connections[committed.committedConnectionId]?.destination
        : undefined;
      const createdTestId = committed.committedTestId;
      options.setPendingConnectionId(null);
      options.setRecordingSourceScreenId(null);
      recorder.setRecordingTransition(undefined);
      setReviewDestination({ kind: "new-screen" });
      // Review is a temporary decision point. Once the person keeps it, return
      // them to the graph and select the just-added screen so "Record from
      // here" is the natural next action instead of leaving a stale device
      // inspector open beside the canvas.
      options.setCaptureOpen(false);
      setTakeReplay({ takeId: null, state: "idle" });
      toast(
        createdTestId ? "Path approved · your Test is ready to run" : "Path approved",
        "success",
      );
      if (createdTestId) options.onPathKept?.(createdTestId);
      requestAnimationFrame(() => {
        const addedScreen =
          destination?.kind === "screen"
            ? options.treeNodes().find((node) => node.id === destination.screenId)
            : undefined;
        if (addedScreen) options.selectNode(addedScreen);
      });
    }
  };

  const discardTake = async () => {
    options.setPendingConnectionId(null);
    options.setRecordingSourceScreenId(null);
    recorder.setRecordingTransition(undefined);
    setReviewDestination({ kind: "new-screen" });
    await recorder.discardTake();
    setTakeReplay({ takeId: null, state: "idle" });
  };

  const rewriteTake = async () => {
    const take = recorder.take();
    if (!take) return;
    const sourceScreenId =
      take.sourceScreenId ?? options.getRecordingSourceScreenId() ?? options.selectedNodeId();
    await recorder.discardTake();
    options.setRecordingSourceScreenId(sourceScreenId);
    recorder.setRecordingSourceScreen(sourceScreenId ?? undefined);
    const pending = take.pendingConnectionId ?? options.getPendingConnectionId();
    options.setPendingConnectionId(pending);
    recorder.setRecordingTransition(pending ?? undefined);
    const source = options.treeNodes().find((node) => node.id === sourceScreenId);
    if (source) recorder.setRecordingGroup(options.titleFor(source));
    setTakeReplay({ takeId: null, state: "idle" });
    options.setCaptureOpen(true);
    void recorder.enterRecordMode();
  };

  return {
    reviewStepIndex,
    setReviewStepIndex,
    reviewDestination,
    setReviewDestination,
    takeReplay,
    setTakeReplay,
    canReplayOnDevice,
    replayTake,
    keepTake,
    discardTake,
    rewriteTake,
  };
}
