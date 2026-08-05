import { createEffect, createSignal } from "solid-js";
import type { AppMap, AppMapCanvasState } from "@relay/protocol";
import type { Accessor } from "solid-js";
import type { MapTreeNode } from "./app-map-tree";
import { reviewTransition, type CanvasConnection } from "./app-map-connection-draft";
import {
  connectionReplayError,
  connectionReplayState,
  connectionReviewTarget,
  type AppMapReplayState,
} from "./app-map-workspace-helpers";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import type { DeviceInfo } from "./api-types";

export function useAppMapTransitionReplay(options: {
  activeAppMap: Accessor<AppMap | undefined>;
  canvasState: Accessor<AppMapCanvasState>;
  treeNodes: Accessor<MapTreeNode[]>;
  titleFor: (node: MapTreeNode) => string;
  selectedDevice: Accessor<DeviceInfo | null | undefined>;
  canonicalConnectionFor: (
    connection: CanvasConnection,
  ) => AppMap["connections"][string] | undefined;
  persistMetadata: (value: AppMapCanvasState) => void;
  canReplayOnDevice: () => Promise<boolean>;
}) {
  const server = useServer();
  const [transitionReplay, setTransitionReplay] = createSignal<{
    connectionId: string | null;
    state: AppMapReplayState;
    error?: string;
    jobId?: string;
  }>({ connectionId: null, state: "idle" });

  const replayStateFor = (connection: CanvasConnection): AppMapReplayState =>
    connectionReplayState(connection, transitionReplay());
  const replayErrorFor = (connection: CanvasConnection) =>
    connectionReplayError(connection, transitionReplay());

  const replayConnection = async (connection: CanvasConnection) => {
    if (!(await options.canReplayOnDevice())) return;
    const appMap = options.activeAppMap();
    const canonical = options.canonicalConnectionFor(connection);
    if (!appMap || !canonical) {
      toast("This connection is still syncing. Try again in a moment.", "info");
      return;
    }
    setTransitionReplay({ connectionId: connection.id, state: "running" });
    const title = `${options.titleFor(options.treeNodes().find((node) => node.id === connection.fromScreenId)!)} → ${options.titleFor(options.treeNodes().find((node) => node.id === connection.toScreenId)!)}`;
    const jobId = await server.runAppMapConnectionRemote(appMap.id, canonical.id, title);
    if (!jobId) {
      setTransitionReplay({
        connectionId: connection.id,
        state: "failed",
        error: "Relay could not start this replay",
      });
      return;
    }
    setTransitionReplay({ connectionId: connection.id, state: "running", jobId });
  };

  createEffect(() => {
    const replay = transitionReplay();
    if (!replay.jobId || !replay.connectionId) return;
    const job = server.jobs().find((candidate) => candidate.id === replay.jobId);
    if (!job || job.status === "queued" || job.status === "running" || job.status === "paused") {
      return;
    }
    const passed = job.status === "ok" || job.status === "healed";
    const error = passed ? undefined : job.error || "The connection did not reach its destination";
    const device = options.selectedDevice();
    const target = connectionReviewTarget({
      serial: device?.serial,
      selectedDeviceSerial: server.selectedDevice(),
      deviceName: device?.name,
      platform: device?.platform,
      passed,
      checkedAt: job.finishedAt ?? Date.now(),
      ...(error ? { error } : {}),
    });
    options.persistMetadata(
      reviewTransition(
        options.canvasState(),
        replay.connectionId,
        passed
          ? { status: "verified", targets: [target] }
          : { status: "failed", error: error!, targets: [target] },
        job.finishedAt ?? Date.now(),
      ),
    );
    setTransitionReplay({
      connectionId: replay.connectionId,
      state: passed ? "passed" : "failed",
      ...(error ? { error } : {}),
    });
    toast(passed ? "Connection verified on the device" : error!, passed ? "success" : "warning");
  });

  return {
    transitionReplay,
    setTransitionReplay,
    replayStateFor,
    replayErrorFor,
    replayConnection,
  };
}
