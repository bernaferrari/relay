import type { AppMapCanvasState } from "@relay/protocol";
import { createEffect, createSignal, type Accessor, type Setter } from "solid-js";
import { useAppMapExecution } from "../context/app-map-execution";
import { useRecorder } from "../context/recorder";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import type { DeviceInfo } from "./api-types";
import { buildCanvasGraphTree } from "./app-map-canvas-graph";
import type { CanvasConnection } from "./app-map-connection-draft";
import type { CanvasGrid } from "./app-map-grid";
import type { MapTreeNode } from "./app-map-tree";
import { mergeAppMapProjection } from "./app-map-projection";
import { captureContextLabel, createCanvasNote } from "./app-map-workspace-helpers";
import { targetIsReady } from "./target-presentation";
import { useAppMapTakeReview } from "./use-app-map-take-review";
import type { CanvasViewport } from "./app-map-canvas-layout";

type Graph = NonNullable<AppMapCanvasState["graph"]>;

/** Recording, one-shot capture, notes, and take review as one authoring intent. */
export function useAppMapCaptureActions(options: {
  loadedAppMapId: Accessor<string | null>;
  graph: Accessor<Graph>;
  connections: Accessor<CanvasConnection[]>;
  treeNodes: Accessor<MapTreeNode[]>;
  groups: Accessor<AppMapCanvasState["groups"]>;
  titleFor: (node: MapTreeNode) => string;
  selectedNodeId: Accessor<string | null>;
  selectedNode: Accessor<MapTreeNode | null>;
  selectedDevice: Accessor<DeviceInfo | null | undefined>;
  hereScreenId: Accessor<string | null>;
  recordState: Accessor<string>;
  canvasState: Accessor<AppMapCanvasState>;
  setCanvasState: Setter<AppMapCanvasState>;
  capturedScreenUrls: Accessor<Record<string, string>>;
  setCapturedScreenUrls: Setter<Record<string, string>>;
  view: Accessor<CanvasViewport>;
  grid: Accessor<CanvasGrid>;
  canvasElement: Accessor<HTMLElement | undefined>;
  persistNotes: (notes: NonNullable<AppMapCanvasState["notes"]>) => void;
  selectNode: (node: MapTreeNode) => void;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedConnectionId: (id: string | null) => void;
  setCaptureOpen: (open: boolean) => void;
  openDevicePicker: () => void;
  openLiveDevice: () => void;
  openDeviceSettings: () => void;
  onPathKept?: (testId?: string) => void;
}) {
  const server = useServer();
  const execution = useAppMapExecution();
  const recorder = useRecorder();
  const [busy, setBusy] = createSignal(false);
  const [waitingForTarget, setWaitingForTarget] = createSignal(false);
  let pendingConnectionId: string | null = null;
  let recordingSourceScreenId: string | null = null;
  let resumeAfterDeviceSelection = false;

  createEffect(() => {
    if (!waitingForTarget()) return;
    const state = options.recordState();
    if (state === "setup-ios") {
      setWaitingForTarget(false);
      recordingSourceScreenId = null;
      recorder.setRecordingSourceScreen(undefined);
      recorder.setRecordingGroup("");
      options.openDeviceSettings();
      return;
    }
    if (state !== "ready") return;
    setWaitingForTarget(false);
    options.openLiveDevice();
    void recorder.enterRecordMode();
  });

  const useCurrentScreenAsStart = async (): Promise<boolean> => {
    if (busy() || options.treeNodes().length > 0) return false;
    setBusy(true);
    try {
      const captured = await recorder.captureMapScreen(undefined, { title: "Start" });
      if (!captured) return false;
      options.setCanvasState(mergeAppMapProjection(options.canvasState(), captured.appMap));
      if (captured.variant.screenshotUri) {
        options.setCapturedScreenUrls((urls) => ({
          ...urls,
          [captured.screen.id]: server.authoringEvidenceUrl(
            captured.variant.screenshotUri!,
            "image/png",
          ),
        }));
      }
      options.setSelectedNodeId(captured.screen.id);
      options.setSelectedConnectionId(null);
      options.setCaptureOpen(false);
      toast("Start screen saved · record a path or capture more screenshots", "success");
      return true;
    } finally {
      setBusy(false);
    }
  };

  const captureCurrentScreen = async () => {
    if (busy()) return;
    if (!targetIsReady(options.selectedDevice(), server.health() === "online")) {
      options.openDevicePicker();
      return;
    }
    setBusy(true);
    try {
      const captured = await recorder.captureMapScreen();
      if (!captured) return;
      const next = mergeAppMapProjection(options.canvasState(), captured.appMap);
      options.setCanvasState(next);
      if (captured.variant.screenshotUri) {
        options.setCapturedScreenUrls((urls) => ({
          ...urls,
          [captured.screen.id]: server.authoringEvidenceUrl(
            captured.variant.screenshotUri!,
            "image/png",
          ),
        }));
      }
      const node = buildCanvasGraphTree(
        next.graph ?? options.graph(),
        execution.steps(),
        next.groups ?? options.groups(),
      ).nodes.find((candidate) => candidate.id === captured.screen.id);
      if (node) options.selectNode(node);
      toast(captured.created ? "Screen saved to the map" : "Screenshot refreshed", "success");
    } finally {
      setBusy(false);
    }
  };

  const addNote = () => {
    const element = options.canvasElement();
    const note = createCanvasNote({
      viewport: options.view(),
      clientWidth: element?.clientWidth,
      clientHeight: element?.clientHeight,
      grid: options.grid(),
    });
    options.persistNotes([...(options.canvasState().notes ?? []), note]);
  };

  const recordFromNode = (screen: MapTreeNode | null) => {
    recordingSourceScreenId = screen?.id ?? options.selectedNodeId();
    recorder.setRecordingSourceScreen(recordingSourceScreenId ?? undefined);
    if (screen) recorder.setRecordingGroup(options.titleFor(screen));
    const state = options.recordState();
    if (state === "setup-ios") {
      recordingSourceScreenId = null;
      recorder.setRecordingSourceScreen(undefined);
      recorder.setRecordingGroup("");
      options.openDeviceSettings();
      return;
    }
    if (state !== "ready") {
      if (
        state === "enable-developer-mode" ||
        state === "preparing-ios" ||
        state === "preparing-screen" ||
        state === "checking-ios"
      ) {
        options.openLiveDevice();
        setWaitingForTarget(true);
        return;
      }
      resumeAfterDeviceSelection = true;
      options.openDevicePicker();
      return;
    }
    resumeAfterDeviceSelection = false;
    options.openLiveDevice();
    void recorder.enterRecordMode();
  };

  const recordFromHere = () => {
    const liveScreenId = options.hereScreenId();
    const liveNode = liveScreenId
      ? (options.treeNodes().find((node) => node.id === liveScreenId) ?? null)
      : null;
    if (liveNode) {
      options.selectNode(liveNode);
      recordFromNode(liveNode);
      return;
    }
    recordFromNode(options.selectedNode());
  };
  const recordConnection = (connection: CanvasConnection) => {
    const screen = options.treeNodes().find((node) => node.id === connection.fromScreenId) ?? null;
    pendingConnectionId = connection.id;
    recorder.setRecordingTransition(connection.id);
    recordFromNode(screen);
  };

  const takeReview = useAppMapTakeReview({
    loadedAppMapId: options.loadedAppMapId,
    graph: options.graph,
    connections: options.connections,
    treeNodes: options.treeNodes,
    titleFor: options.titleFor,
    selectedNodeId: options.selectedNodeId,
    selectedDevice: options.selectedDevice,
    setCaptureOpen: options.setCaptureOpen,
    openDevicePicker: options.openDevicePicker,
    selectNode: options.selectNode,
    getPendingConnectionId: () => pendingConnectionId,
    setPendingConnectionId: (id) => {
      pendingConnectionId = id;
    },
    getRecordingSourceScreenId: () => recordingSourceScreenId,
    setRecordingSourceScreenId: (id) => {
      recordingSourceScreenId = id;
    },
    onPathKept: options.onPathKept,
  });

  return {
    busy,
    waitingForTarget,
    captureCurrentScreen,
    useCurrentScreenAsStart,
    addNote,
    recordFromHere,
    recordConnection,
    captureContextLabel: () =>
      captureContextLabel({
        pendingConnectionId,
        connections: options.connections(),
        nodes: options.treeNodes(),
        titleFor: options.titleFor,
      }),
    onDeviceSelected: () => {
      if (!resumeAfterDeviceSelection) return;
      resumeAfterDeviceSelection = false;
      setWaitingForTarget(true);
    },
    recordingSourceScreenId: () => recordingSourceScreenId,
    ...takeReview,
  };
}
