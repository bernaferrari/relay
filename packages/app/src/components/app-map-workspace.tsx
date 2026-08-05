import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { CanvasNote, AppMapCanvasState, ScreenVariant } from "@relay/protocol";
import { useRecipeDraft } from "../context/recipe-draft";
import { useRecorder } from "../context/recorder";
import { useServer } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { type MapTreeNode } from "../lib/app-map-tree";
import {
  addPlannedConnection,
  addPlannedScreenConnection,
  canvasConnections,
  type CanvasConnection,
} from "../lib/app-map-connection-draft";
import {
  buildCanvasGraphTree,
  ensureCanvasGraph,
  withCanvasGraph,
} from "../lib/app-map-canvas-graph";
import { EMPTY_APP_MAP_CANVAS_STATE } from "../lib/app-map-canvas-state";
import {
  canvasBounds,
  clampCanvasScale,
  fitCanvasViewport,
  openCanvasViewport,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  type CanvasPoint,
  type CanvasViewport,
} from "../lib/app-map-canvas-layout";
import {
  centerCanvasViewport,
  minimapViewportBounds,
  minimapWorldPoint,
} from "../lib/app-map-minimap";
import { zoomViewportAtPoint } from "../lib/viewport-zoom";
import { deviceReadiness } from "../lib/device-readiness";
import { projectAppMapRun } from "../lib/app-map-run-projection";
import { appMapRunReadiness } from "../lib/app-map-run-readiness";
import { toast } from "../context/toast";
import { AppMapEmptyState } from "./app-map-capture-review";
import { ConnectionInspector, GroupInspector, ScreenInspector } from "./app-map-canvas-primitives";
import { AppMapHistoryPanel } from "./app-map-history-panel";
import { appMapDeviceStatus } from "./device-status-label";
import { AppMapDeviceCompanionMount } from "./app-map-device-companion-mount";
import { AppMapOverviewToolbar, AppMapToolbar, type AppMapWorkspaceView } from "./app-map-toolbar";
import { AppMapMinimap } from "./app-map-minimap";
import { AppMapBrowseView } from "./app-map-browse-view";
import { AppMapAgentPanel } from "./app-map-agent-panel";
import { canvasWheelAction, createAppMapEventOrchestration } from "./app-map-events";
import { Icon } from "./icon";
import { mergeAppMapProjection, planAppMapProjection } from "../lib/app-map-projection";
import { AppMapProposalReview } from "./app-map-proposal-review";
import { caseStackCount } from "../lib/case-stack-presentation";
import { AppMapCanvasScene } from "./app-map-canvas-scene";
import { AppMapTakeReviewMount } from "./app-map-take-review-mount";
import { useAppMapAgentExploration } from "../lib/use-app-map-agent-exploration";
import { useAppMapCapturePanel } from "../lib/use-app-map-capture-panel";
import { useAppMapCaseStack } from "../lib/use-app-map-case-stack";
import { useAppMapConnectionBehaviors } from "../lib/use-app-map-connection-behaviors";
import { useAppMapFlowSetup } from "../lib/use-app-map-flow-setup";
import { useAppMapGroupOps } from "../lib/use-app-map-group-ops";
import { useAppMapProposalReview } from "../lib/use-app-map-proposal-review";
import { targetIsReady } from "../lib/target-presentation";
import {
  appMapLoadFailure,
  applyTargetSetToActiveFlow,
  buildMinimapEdges,
  buildMinimapNodes,
  buildPresenceGeometry,
  canvasPointFromClientRect,
  canvasProjectionUnchanged,
  clampGroupMenuPosition,
  captureContextLabel as buildCaptureContextLabel,
  canonicalNotesFor,
  canvasRemovalChanges,
  connectionPathTitle,
  createCanvasNote,
  recordedActionFromConnection,
  entryFlowsForScreen,
  findRunnableFlow,
  gateGraphRunReadiness,
  listReusableBehaviors,
  orderCanvasChanges,
  pushCanvasHistoryEntry,
  recipeStepsForRunReadiness,
  recordStateFromReadiness,
  selectedFlowSetupSummary,
  stepsForConnectionIds,
  visibleCanvasBoundsFromViewport,
} from "../lib/app-map-workspace-helpers";
import { useAppMapTakeReview } from "../lib/use-app-map-take-review";
import { useAppMapGraphEdits } from "../lib/use-app-map-graph-edits";
import { useAppMapTransitionReplay } from "../lib/use-app-map-transition-replay";
import { useAppMapRunFlow } from "../lib/use-app-map-run-flow";
import { useAppMapPresence } from "../lib/use-app-map-presence";
import { groupForScreen } from "../lib/app-map-groups";
import { bindAppMapWorkspaceShellEvents } from "../lib/app-map-workspace-shell-events";
import {
  screenshotOrientationEvidence,
  screenshotUrl,
  variantOrientationEvidence,
  variantScreenshotUrl,
} from "../lib/app-map-workspace-media";
import { AppMapLoadFeedback } from "./app-map-load-feedback";
import {
  APP_MAP_MARQUEE_THRESHOLD,
  canvasSelectionRect,
  mergeSelectedScreenIds,
  screenIdsInSelection,
  type CanvasSelectionRect,
} from "../lib/app-map-selection";
import { connectionActionSummaries } from "../lib/connection-action-presentation";

type AppMapLoadState =
  | { status: "idle" }
  | { status: "loading"; appMapId: string }
  | { status: "ready"; appMapId: string }
  | {
      status: "error";
      appMapId: string;
      title: string;
      guidance: string;
      detail?: string;
    };

type AppMapContextSurface = "agent" | "history" | "proposals" | null;

/**
 * The graph is the authoring surface for an App Map. A card is a captured
 * screen; the small actions attached to it are the things a person can do
 * there. Recording remains the only way to create the real transitions, so
 * the canvas never promises a route that the runner cannot execute.
 */
export function AppMapWorkspace(props: {
  onOpenTargets: () => void;
  onOpenActions: () => void;
  onOpenVariables: () => void;
  onOpenRun?: (id: string) => void;
  navigatorOpen?: boolean;
  addNoteOnReady?: boolean;
  onAddNoteHandled?: () => void;
}) {
  const server = useServer();
  const draft = useRecipeDraft();
  const recorder = useRecorder();
  const workbench = useWorkbench();
  // State must exist before a Solid memo reads it: createMemo evaluates its
  // computation immediately, including when the component is recreated by HMR.
  // App Map is the only persisted authoring document. This compact canvas
  // projection is renderer state only; it is rebuilt from the App Map and is
  // never loaded from or saved to a parallel canvas document.
  const [canvasState, setCanvasState] = createSignal<AppMapCanvasState>(EMPTY_APP_MAP_CANVAS_STATE);
  const [loadedAppMapId, setLoadedAppMapId] = createSignal<string | null>(null);
  const [appMapLoadState, setAppMapLoadState] = createSignal<AppMapLoadState>({
    status: "idle",
  });
  const currentLoadFailure = () => {
    const state = appMapLoadState();
    return state.status === "error" ? state : undefined;
  };
  const [appMapLoadAttempt, setAppMapLoadAttempt] = createSignal(0);
  const [workspaceView, setWorkspaceView] = createSignal<AppMapWorkspaceView>("map");
  const [contextSurface, setContextSurface] = createSignal<AppMapContextSurface>(null);
  const surfaceOpen = (surface: Exclude<AppMapContextSurface, null>) =>
    contextSurface() === surface;
  const setSurfaceOpen = (surface: Exclude<AppMapContextSurface, null>, open: boolean) =>
    setContextSurface((current) => (open ? surface : current === surface ? null : current));
  const agentOpen = () => surfaceOpen("agent");
  const historyOpen = () => surfaceOpen("history");
  const proposalReviewOpen = () => surfaceOpen("proposals");
  const setAgentOpen = (open: boolean) => setSurfaceOpen("agent", open);
  const setHistoryOpen = (open: boolean) => setSurfaceOpen("history", open);
  const setProposalReviewOpen = (open: boolean) => setSurfaceOpen("proposals", open);
  const graph = createMemo(() => ensureCanvasGraph(canvasState(), draft.steps()));
  const activeFlow = createMemo(() => graph().flows[0] ?? null);
  const activeAppMap = createMemo(() =>
    server.appMaps().find((candidate) => candidate.id === server.selectedAppMapId()),
  );
  // Exploration belongs to the workspace, not to its drawer. Closing the
  // drawer only hides progress; it never cancels a 20-minute agent run.
  const agentExploration = useAppMapAgentExploration(activeAppMap);
  const { proposalBusyId, proposalError, decideProposal } = useAppMapProposalReview(activeAppMap);
  const pendingProposals = createMemo(() =>
    Object.values(activeAppMap()?.proposals ?? {})
      .filter((proposal) => proposal.status === "pending")
      .sort((left, right) => left.createdAt - right.createdAt),
  );
  const tree = createMemo(() => buildCanvasGraphTree(graph(), draft.steps()));
  const hasMap = () => tree().nodes.length > 0;
  const selectedDevice = createMemo(
    () => server.devices().find((device) => device.serial === server.selectedDevice()) ?? null,
  );
  const mapRunJob = createMemo(() => {
    const appMapId = server.selectedAppMapId();
    if (!appMapId) return null;
    return server.jobs().find((job) => job.action === appMapId) ?? null;
  });
  const runProjection = createMemo(() => {
    const job = mapRunJob();
    return projectAppMapRun({
      graph: graph(),
      recipeSteps: job?.recipeSnapshot?.steps ?? draft.steps(),
      job,
    });
  });
  let requestedAppleSetupFor = "";
  let appMapMutationQueue = Promise.resolve();
  let appliedCanonicalRevision = "";
  createEffect(() => {
    const device = selectedDevice();
    const setup = server.appleDeviceSetup();
    if (device?.platform !== "ios" || setup) {
      requestedAppleSetupFor = "";
      return;
    }
    const requestKey = device.serial;
    if (requestedAppleSetupFor === requestKey) return;
    requestedAppleSetupFor = requestKey;
    void server.refreshAppleDeviceSetup().catch(() => {
      // A cold detailed Xcode inspection can exceed the short UI request
      // budget. That timeout is not proof of broken setup; live readiness is
      // authoritative and continues preparing the device.
    });
  });
  const recordState = (): Parameters<typeof AppMapEmptyState>[0]["recordState"] => {
    const device = selectedDevice();
    const liveFrame = server.liveFrame();
    return recordStateFromReadiness(
      deviceReadiness(device, server.health() === "online", {
        ...(device?.platform === "ios" ? { appleSetup: server.appleDeviceSetup() } : {}),
        liveCaptureIssue: server.liveCaptureIssue(),
        recordingIssue: recorder.recordingIssue(),
        requireLiveScreen: true,
        liveScreenAvailable:
          Boolean(liveFrame?.base64) && (!liveFrame?.serial || liveFrame.serial === device?.serial),
      }),
    );
  };
  const canRecord = () =>
    recordState() === "ready" && Boolean(server.selectedLeaseId()) && !server.controlIssue();
  const livePanelStatus = () => {
    const device = selectedDevice();
    const liveFrame = server.liveFrame();
    return appMapDeviceStatus({
      readiness: deviceReadiness(device, server.health() === "online", {
        ...(device?.platform === "ios" ? { appleSetup: server.appleDeviceSetup() } : {}),
        liveCaptureIssue: server.liveCaptureIssue(),
        recordingIssue: recorder.recordingIssue(),
        requireLiveScreen: true,
        liveScreenAvailable:
          Boolean(liveFrame?.base64) && (!liveFrame?.serial || liveFrame.serial === device?.serial),
      }),
      deviceSelected: Boolean(device),
      serverOnline: server.health() === "online",
      discovering: server.deviceDiscoveryStatus() === "scanning",
      recording: recorder.recording(),
      controlReady: Boolean(server.selectedLeaseId()),
      controlIssue: server.controlIssue(),
    });
  };
  const liveScreenSrc = createMemo(() => {
    const device = selectedDevice();
    const liveFrame = server.liveFrame();
    const belongsToSelectedDevice =
      Boolean(device) && (!liveFrame?.serial || liveFrame.serial === device?.serial);
    return liveFrame?.base64 && belongsToSelectedDevice
      ? `data:${liveFrame.mime || "image/png"};base64,${liveFrame.base64}`
      : undefined;
  });
  const [view, setView] = createSignal<CanvasViewport>({ x: 72, y: 68, scale: 0.78 });
  const connections = createMemo(() => canvasConnections(tree(), draft.steps(), canvasState()));
  const [selectedNodeIds, setSelectedNodeIds] = createSignal<string[]>([]);
  const [selectedGroupId, setSelectedGroupId] = createSignal<string | null>(null);
  const [renamingGroupId, setRenamingGroupId] = createSignal<string | null>(null);
  const [groupMenu, setGroupMenu] = createSignal<{
    x: number;
    y: number;
    groupId?: string;
    screenIds: string[];
  } | null>(null);
  const [selectedNodeId, setSelectedNodeIdValue] = createSignal<string | null>(null);
  const setSelectedNodeId = (id: string | null) => {
    setSelectedNodeIdValue(id);
    setSelectedNodeIds(id ? [id] : []);
    setSelectedGroupId(null);
  };
  const [screenInspectorOpen, setScreenInspectorOpen] = createSignal(false);
  const [selectedConnectionId, setSelectedConnectionId] = createSignal<string | null>(null);
  const [keyboardConnectionSourceId, setKeyboardConnectionSourceId] = createSignal<string | null>(
    null,
  );
  const [startCaptureBusy, setStartCaptureBusy] = createSignal(false);
  const [capturedScreenUrls, setCapturedScreenUrls] = createSignal<Record<string, string>>({});
  const [connectionPreview, setConnectionPreview] = createSignal<CanvasPoint | null>(null);
  const [renamingNodeId, setRenamingNodeId] = createSignal<string | null>(null);
  const [deviceCompanionOrientation, setDeviceCompanionOrientation] = createSignal<
    "portrait" | "landscape" | "square" | "unknown"
  >("unknown");
  const [waitingForRecordTarget, setWaitingForRecordTarget] = createSignal(false);
  const [canvasTool, setCanvasTool] = createSignal<"select" | "hand">("select");
  const [selectionMarquee, setSelectionMarquee] = createSignal<{
    pointerId: number;
    start: CanvasPoint;
    current: CanvasPoint;
    startClient: CanvasPoint;
    baseIds: string[];
    additive: boolean;
    moved: boolean;
  } | null>(null);
  const [canvasClientSize, setCanvasClientSize] = createSignal({ width: 0, height: 0 });
  const [, setLocalCursor] = createSignal<CanvasPoint | undefined>();
  let canvas: HTMLElement | undefined;
  let canvasResizeObserver: ResizeObserver | undefined;
  let pan: { x: number; y: number; view: CanvasViewport } | undefined;
  let nodeDrag:
    | {
        id: string;
        ids: string[];
        x: number;
        y: number;
        origins: Record<string, CanvasPoint>;
        groupId?: string;
        moved: boolean;
        before: AppMapCanvasState;
      }
    | undefined;
  let noteDrag:
    | {
        id: string;
        x: number;
        y: number;
        origin: CanvasPoint;
        moved: boolean;
        before: AppMapCanvasState;
      }
    | undefined;
  let connectionDrag:
    | {
        fromScreenId: string;
        pointerId: number;
        origin: CanvasPoint;
        point: CanvasPoint;
      }
    | undefined;
  let pendingConnectionId: string | null = null;
  let suppressNodeSelectionClick = false;
  let recordingSourceScreenId: string | null = null;
  let recordRequestedAfterDeviceSelection = false;
  let deviceAutoOpenedForMap = "";
  let initiallyFittedAppMapId = "";
  let pointerMoveFrame: number | undefined;
  let pendingPointerMove: { x: number; y: number } | undefined;
  type CanvasHistoryEntry = {
    before: AppMapCanvasState;
    after: AppMapCanvasState;
    at: number;
  };
  let canvasUndoStack: CanvasHistoryEntry[] = [];
  let canvasRedoStack: CanvasHistoryEntry[] = [];
  const [canvasHistoryDepth, setCanvasHistoryDepth] = createSignal({ undo: 0, redo: 0 });
  const clearCanvasHistory = () => {
    canvasUndoStack = [];
    canvasRedoStack = [];
    setCanvasHistoryDepth({ undo: 0, redo: 0 });
  };

  const observeCanvas = (element: HTMLElement) => {
    canvas = element;
    canvasResizeObserver?.disconnect();
    setCanvasClientSize({ width: element.clientWidth, height: element.clientHeight });
    if (typeof ResizeObserver === "undefined") return;
    canvasResizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setCanvasClientSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    canvasResizeObserver.observe(element);
  };
  const canvasPointFromClient = (clientX: number, clientY: number): CanvasPoint => {
    if (!canvas) return { x: 0, y: 0 };
    return canvasPointFromClientRect(clientX, clientY, canvas.getBoundingClientRect(), view());
  };
  const marqueeRect = createMemo<CanvasSelectionRect | null>(() => {
    const marquee = selectionMarquee();
    return marquee?.moved ? canvasSelectionRect(marquee.start, marquee.current) : null;
  });
  const applyCanvasPointerMove = (clientX: number, clientY: number) => {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const viewport = view();
    setLocalCursor({
      x: (clientX - rect.left - viewport.x) / viewport.scale,
      y: (clientY - rect.top - viewport.y) / viewport.scale,
    });
    if (connectionDrag) {
      connectionDrag.point = {
        x: (clientX - rect.left - viewport.x) / viewport.scale,
        y: (clientY - rect.top - viewport.y) / viewport.scale,
      };
      setConnectionPreview({ ...connectionDrag.point });
      return;
    }
    if (nodeDrag) {
      const moved = Math.hypot(clientX - nodeDrag.x, clientY - nodeDrag.y) > 4;
      if (!moved && !nodeDrag.moved) return;
      if (!nodeDrag.moved && !nodeDrag.groupId && !selectedNodeIds().includes(nodeDrag.id)) {
        setSelectedNodeIds([...nodeDrag.ids]);
        setSelectedNodeIdValue(nodeDrag.id);
        setSelectedGroupId(null);
      }
      nodeDrag.moved = true;
      setCanvasState((current) => ({
        ...current,
        positions: {
          ...current.positions,
          ...Object.fromEntries(
            nodeDrag!.ids.map((id) => {
              const origin = nodeDrag!.origins[id]!;
              return [
                id,
                {
                  x: origin.x + (clientX - nodeDrag!.x) / viewport.scale,
                  y: origin.y + (clientY - nodeDrag!.y) / viewport.scale,
                },
              ];
            }),
          ),
        },
      }));
      return;
    }
    if (noteDrag) {
      const moved = Math.hypot(clientX - noteDrag.x, clientY - noteDrag.y) > 4;
      if (!moved && !noteDrag.moved) return;
      noteDrag.moved = true;
      setCanvasState((current) => ({
        ...current,
        notes: (current.notes ?? []).map((note) =>
          note.id === noteDrag!.id
            ? {
                ...note,
                x: noteDrag!.origin.x + (clientX - noteDrag!.x) / viewport.scale,
                y: noteDrag!.origin.y + (clientY - noteDrag!.y) / viewport.scale,
                updatedAt: Date.now(),
              }
            : note,
        ),
      }));
      return;
    }
    const marquee = selectionMarquee();
    if (marquee) {
      const moved =
        marquee.moved ||
        Math.hypot(clientX - marquee.startClient.x, clientY - marquee.startClient.y) >
          APP_MAP_MARQUEE_THRESHOLD;
      const current = canvasPointFromClient(clientX, clientY);
      setSelectionMarquee({ ...marquee, current, moved });
      if (!moved) return;
      const hits = screenIdsInSelection(
        tree().nodes.map((node) => node.id),
        positions(),
        canvasSelectionRect(marquee.start, current),
      );
      const selected = mergeSelectedScreenIds(marquee.baseIds, hits, marquee.additive);
      setSelectedNodeIds(selected);
      setSelectedNodeIdValue(selected.at(-1) ?? null);
      setSelectedGroupId(null);
      setSelectedConnectionId(null);
      setScreenInspectorOpen(false);
      return;
    }
    if (!pan) return;
    setView({
      ...pan.view,
      x: pan.view.x + clientX - pan.x,
      y: pan.view.y + clientY - pan.y,
    });
  };
  const scheduleCanvasPointerMove = (clientX: number, clientY: number) => {
    pendingPointerMove = { x: clientX, y: clientY };
    if (pointerMoveFrame !== undefined) return;
    pointerMoveFrame = requestAnimationFrame(() => {
      pointerMoveFrame = undefined;
      const pending = pendingPointerMove;
      pendingPointerMove = undefined;
      if (pending) applyCanvasPointerMove(pending.x, pending.y);
    });
  };
  const flushCanvasPointerMove = (clientX: number, clientY: number) => {
    if (pointerMoveFrame !== undefined) cancelAnimationFrame(pointerMoveFrame);
    pointerMoveFrame = undefined;
    pendingPointerMove = undefined;
    applyCanvasPointerMove(clientX, clientY);
  };

  const {
    captureOpen,
    setCaptureOpen,
    captureClosing,
    closeCapturePanel,
    openCapturePanel,
    openDevicePicker,
  } = useAppMapCapturePanel({
    clearContextSurface: () => setContextSurface(null),
  });
  onCleanup(() => {
    if (pointerMoveFrame !== undefined) cancelAnimationFrame(pointerMoveFrame);
  });

  const reviewingTake = () => recorder.take()?.state === "review";

  createEffect(() => {
    const appMapId = server.selectedAppMapId();
    appMapLoadAttempt();
    deviceAutoOpenedForMap = "";
    setSelectedNodeId(null);
    setSelectedGroupId(null);
    setRenamingGroupId(null);
    setScreenInspectorOpen(false);
    setSelectedConnectionId(null);
    setKeyboardConnectionSourceId(null);
    setCapturedScreenUrls({});
    setRenamingNodeId(null);
    setContextSurface(null);
    setCaptureOpen(false);
    clearCanvasHistory();
    appliedCanonicalRevision = "";
    if (!appMapId) {
      setLoadedAppMapId(null);
      setAppMapLoadState({ status: "idle" });
      setCanvasState(EMPTY_APP_MAP_CANVAS_STATE);
      return;
    }
    setLoadedAppMapId(null);
    setAppMapLoadState({ status: "loading", appMapId });
    void server
      .loadAppMap(appMapId)
      .then((appMap) => {
        if (server.selectedAppMapId() === appMapId) {
          setCanvasState(mergeAppMapProjection(EMPTY_APP_MAP_CANVAS_STATE, appMap));
          setLoadedAppMapId(appMapId);
          setAppMapLoadState({ status: "ready", appMapId });
          void server.refreshRuns(appMapId);
        }
      })
      .catch((error: unknown) => {
        if (server.selectedAppMapId() === appMapId) {
          setAppMapLoadState({ status: "error", appMapId, ...appMapLoadFailure(error) });
        }
      });
  });

  createEffect(() => {
    const appMapId = server.selectedAppMapId();
    const appMap = server.appMaps().find((candidate) => candidate.id === appMapId);
    if (!appMapId || !appMap || loadedAppMapId() !== appMapId) return;
    const revisionKey = `${appMapId}:${appMap.revision}`;
    if (appliedCanonicalRevision === revisionKey) return;
    appliedCanonicalRevision = revisionKey;
    const current = canvasState();
    const value = mergeAppMapProjection(current, appMap);
    if (canvasProjectionUnchanged(value, current)) {
      return;
    }
    clearCanvasHistory();
    setCanvasState(value);
  });

  // A blank App Map starts with its device companion visible: the first screen
  // is established there, not through a modal or a second empty-state CTA.
  // Populated maps keep the canvas unobstructed until Device is requested.
  createEffect(() => {
    const appMapId = server.selectedAppMapId();
    if (
      !appMapId ||
      loadedAppMapId() !== appMapId ||
      props.navigatorOpen ||
      hasMap() ||
      deviceAutoOpenedForMap === appMapId
    )
      return;
    deviceAutoOpenedForMap = appMapId;
    setCaptureOpen(true);
  });
  // Recording starts from the navigator as well as from this workspace. The
  // drawer must follow that state so a fresh map never appears to be an
  // empty graph while it is already capturing real work.
  createEffect(() => {
    if (recorder.recording() || recorder.take()) setCaptureOpen(true);
  });

  createEffect(() => {
    if (!props.navigatorOpen || recorder.recording()) return;
    deviceAutoOpenedForMap = "";
    setCaptureOpen(false);
  });

  // Selecting a ready device from the first-recording prompt is not a second
  // task the person has to finish manually. An iPad that still needs its
  // runner is different: take the person straight to setup and do not leave a
  // hidden request that could start recording later without another choice.
  createEffect(() => {
    if (!waitingForRecordTarget()) return;
    const state = recordState();
    if (state === "setup-ios") {
      setWaitingForRecordTarget(false);
      recordingSourceScreenId = null;
      recorder.setRecordingSourceScreen(undefined);
      recorder.setRecordingGroup("");
      window.dispatchEvent(
        new CustomEvent("relay:open-settings", { detail: { section: "devices" } }),
      );
      return;
    }
    if (state !== "ready") return;
    setWaitingForRecordTarget(false);
    setCaptureOpen(true);
    void recorder.enterRecordMode();
  });
  const positions = () => canvasState().positions;
  const groups = () => canvasState().groups ?? [];
  const titleFor = (node: MapTreeNode) =>
    canvasState().screenTitles?.[node.id]?.trim() || node.title;
  const hasCanvasContent = () => hasMap() || (canvasState().notes?.length ?? 0) > 0;
  const positionFor = (node: MapTreeNode): CanvasPoint => positions()[node.id] ?? node;
  const selectedNode = createMemo(
    () => tree().nodes.find((node) => node.id === selectedNodeId()) ?? null,
  );
  const selectedGroup = createMemo(
    () => groups().find((group) => group.id === selectedGroupId()) ?? null,
  );
  const selectedConnection = createMemo(
    () => connections().find((connection) => connection.id === selectedConnectionId()) ?? null,
  );
  const selectedEntryFlows = createMemo(() =>
    entryFlowsForScreen(activeAppMap(), selectedNodeId()),
  );
  const selectedFlowSetup = createMemo(() =>
    selectedFlowSetupSummary(selectedEntryFlows(), activeAppMap()?.routines),
  );
  const canonicalConnectionFor = (connection: CanvasConnection) =>
    activeAppMap()?.connections[connection.id];
  const {
    caseStackBusy,
    caseStackFor,
    saveConnectionCaseStack,
    attachConnectionCaseStack,
    detachConnectionCaseStack,
  } = useAppMapCaseStack({
    activeAppMap,
    canonicalConnectionFor,
  });
  const { setSelectedFlowSetup } = useAppMapFlowSetup({
    activeAppMap,
    selectedEntryFlows,
  });
  const baseGraphRunReadiness = createMemo(() =>
    appMapRunReadiness({
      graph: graph(),
      recipeSteps: recipeStepsForRunReadiness(draft.steps(), activeAppMap()?.connections),
      selection: {
        screenId: selectedNodeId(),
        transitionId: selectedConnectionId(),
      },
    }),
  );
  const runnableFlow = createMemo(() =>
    findRunnableFlow(activeAppMap(), baseGraphRunReadiness().transitionPath),
  );
  const graphRunReadiness = createMemo(() =>
    gateGraphRunReadiness(baseGraphRunReadiness(), Boolean(runnableFlow())),
  );
  const { runCanvasGraph, refreshMapScreenshots } = useAppMapRunFlow({
    activeAppMap,
    runnableFlow,
    graphRunReadiness,
  });
  const reusableBehaviors = createMemo(() => listReusableBehaviors(activeAppMap()));
  const bounds = createMemo(() =>
    canvasBounds(tree().nodes, canvasState().notes ?? [], positionFor),
  );
  const minimapNodes = createMemo(() =>
    buildMinimapNodes({
      nodes: tree().nodes,
      notes: canvasState().notes ?? [],
      bounds: bounds(),
      positionFor,
      selectedNodeId: selectedNodeId(),
      screenStates: Object.fromEntries(
        Object.entries(runProjection().screens).map(([id, screen]) => [id, screen.state]),
      ),
    }),
  );
  const minimapEdges = createMemo(() =>
    buildMinimapEdges({
      nodes: tree().nodes,
      connections: connections(),
      bounds: bounds(),
      positionFor,
      selectedConnectionId: selectedConnectionId(),
      transitionStates: Object.fromEntries(
        Object.entries(runProjection().transitions).map(([id, transition]) => [
          id,
          transition.state,
        ]),
      ),
    }),
  );
  const minimapViewport = createMemo(() =>
    minimapViewportBounds(view(), canvasClientSize(), bounds()),
  );
  const presenceGeometry = createMemo(() =>
    buildPresenceGeometry({
      nodes: tree().nodes,
      connections: connections(),
      positionFor,
    }),
  );
  const { remoteAwareness } = useAppMapPresence({
    recording: () => recorder.recording(),
  });

  const fit = () => {
    const element = canvas;
    if (!element || !hasCanvasContent()) return;
    setView(
      fitCanvasViewport({ width: element.clientWidth, height: element.clientHeight }, bounds()),
    );
  };

  const openAtReadableScale = () => {
    const element = canvas;
    if (!element || !hasCanvasContent()) return;
    setView(
      openCanvasViewport({ width: element.clientWidth, height: element.clientHeight }, bounds()),
    );
  };

  createEffect(() => {
    const appMapId = loadedAppMapId();
    if (!appMapId || appMapLoadState().status !== "ready" || initiallyFittedAppMapId === appMapId)
      return;
    // Fit an existing map once when it opens. A blank map is also marked as
    // handled so its first capture does not yank the camera away from the user.
    initiallyFittedAppMapId = appMapId;
    if (hasCanvasContent()) requestAnimationFrame(openAtReadableScale);
  });

  const selectStep = (index: number) => {
    workbench.focusStep(index);
    draft.setExpandedStep(index);
  };
  const selectNode = (node: MapTreeNode, event?: MouseEvent) => {
    if (suppressNodeSelectionClick) return;
    if (event?.shiftKey) {
      const current = selectedNodeIds();
      const next = current.includes(node.id)
        ? current.filter((id) => id !== node.id)
        : [...current, node.id];
      setSelectedNodeIds(next);
      setSelectedNodeIdValue(next.at(-1) ?? null);
    } else {
      setSelectedNodeId(node.id);
    }
    setSelectedGroupId(null);
    setSelectedConnectionId(null);
    // Selection is also the entry point to object properties. This mirrors a
    // canvas editor: click a screen, see its details; Esc or the close button
    // dismisses them without clearing the selection.
    setScreenInspectorOpen(!event?.shiftKey);
    setRenamingNodeId(null);
    if (node.representativeStepIndex >= 0) selectStep(node.representativeStepIndex);
  };
  const zoom = (delta: number, clientPoint?: CanvasPoint) => {
    const element = canvas;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const anchor = clientPoint
      ? { x: clientPoint.x - rect.left, y: clientPoint.y - rect.top }
      : { x: rect.width / 2, y: rect.height / 2 };
    setView((current) =>
      zoomViewportAtPoint(current, clampCanvasScale(current.scale + delta), anchor),
    );
  };
  const revealScreen = (screenId: string) => {
    const element = canvas;
    const node = tree().nodes.find((candidate) => candidate.id === screenId);
    if (!element || !node) return;
    const position = positionFor(node);
    const scale = Math.max(view().scale, 0.72);
    setView({
      scale,
      x: element.clientWidth / 2 - (position.x + SCREEN_CARD_WIDTH / 2) * scale,
      y: element.clientHeight / 2 - (position.y + SCREEN_CARD_HEIGHT / 2) * scale,
    });
    requestAnimationFrame(() => {
      const card = Array.from(
        element.querySelectorAll<HTMLElement>("[data-app-map-screen-id]"),
      ).find((candidate) => candidate.dataset.appMapScreenId === screenId);
      card?.focus({ preventScroll: true });
    });
  };
  const visibleCanvasBounds = createMemo(() =>
    visibleCanvasBoundsFromViewport({ viewport: view(), client: canvasClientSize() }),
  );
  function persistAppMapCanvas(
    value: AppMapCanvasState,
    previous?: AppMapCanvasState,
    variantsByScreen?: Readonly<Record<string, readonly ScreenVariant[]>>,
  ): void {
    const appMapId = server.selectedAppMapId();
    if (!appMapId) return;
    appMapMutationQueue = appMapMutationQueue
      .then(async () => {
        let appMap = await server.loadAppMap(appMapId);
        const projectedGraph = ensureCanvasGraph(value, draft.steps());
        const projectedChanges = planAppMapProjection({
          appMap,
          graph: projectedGraph,
          positions: value.positions,
          groups: value.groups ?? [],
          recipeSteps: draft.steps(),
          ...(variantsByScreen ? { variantsByScreen } : {}),
        });
        const removals = previous ? canvasRemovalChanges(previous, value, appMap) : [];
        const changes = orderCanvasChanges([...projectedChanges, ...removals]);
        const canonicalNotes = canonicalNotesFor(value.notes ?? [], appMap);
        const notesChanged = JSON.stringify(appMap.notes) !== JSON.stringify(canonicalNotes);
        if (!changes.length && !notesChanged) return;
        appMap = (
          await server.runAction("app-map.commit", {
            appMapId,
            expectedRevision: appMap.revision,
            summary: "Updated App Map canvas",
            changes,
            ...(notesChanged ? { patch: { notes: canonicalNotes } } : {}),
          })
        ).appMap;
        await server.refreshAppMaps();
      })
      .catch(async (error) => {
        // Reconcile a failed optimistic edit with the canonical App Map. Do
        // not overwrite a newer local gesture that is already queued.
        if (canvasState() === value) {
          try {
            const current = await server.loadAppMap(appMapId);
            setCanvasState(mergeAppMapProjection(canvasState(), current));
          } catch {
            // Preserve the local state when even the recovery read is offline.
          }
        }
        toast(error instanceof Error ? error.message : "The App Map could not be saved", "warning");
      });
  }
  const persistMetadata = (
    value: AppMapCanvasState,
    options: {
      before?: AppMapCanvasState;
      recordHistory?: boolean;
      variantsByScreen?: Readonly<Record<string, readonly ScreenVariant[]>>;
    } = {},
  ) => {
    if (!server.selectedAppMapId()) return;
    const before = structuredClone(options.before ?? canvasState());
    const canvasChanged = JSON.stringify(before) !== JSON.stringify(value);
    const hasVariantEvidence = Object.values(options.variantsByScreen ?? {}).some(
      (variants) => variants.length > 0,
    );
    if (!canvasChanged && !hasVariantEvidence) return;
    if (canvasChanged && options.recordHistory !== false) {
      canvasUndoStack = pushCanvasHistoryEntry(canvasUndoStack, {
        before,
        after: structuredClone(value),
        at: Date.now(),
      });
      canvasRedoStack = [];
      setCanvasHistoryDepth({ undo: canvasUndoStack.length, redo: 0 });
    }
    if (canvasChanged) setCanvasState(value);
    persistAppMapCanvas(value, before, options.variantsByScreen);
  };
  const persistNotes = (notes: CanvasNote[], before?: AppMapCanvasState) => {
    persistMetadata(withCanvasGraph({ ...canvasState(), notes }, graph()), { before });
  };
  const chooseTargetSet = (targetSetId?: string) => {
    const flow = activeFlow();
    if (!flow) return;
    const next = applyTargetSetToActiveFlow(graph(), flow.id, targetSetId);
    persistMetadata(withCanvasGraph(canvasState(), next));
  };
  createEffect(() => {
    window.dispatchEvent(
      new CustomEvent("relay:target-set-state", {
        detail: { targetSetId: activeFlow()?.targetSetId },
      }),
    );
  });
  onMount(() => {
    const unbind = bindAppMapWorkspaceShellEvents({
      onChooseTargetSet: chooseTargetSet,
      onToggleHistory: () => {
        const opening = !historyOpen();
        if (opening) setCaptureOpen(false);
        setHistoryOpen(opening);
      },
      onRevealScreen: (detail) => {
        if (!detail.screenId || !detail.appMapId || detail.appMapId !== server.selectedAppMapId()) {
          return;
        }
        setWorkspaceView("map");
        setSelectedNodeId(detail.screenId);
        queueMicrotask(() => revealScreen(detail.screenId!));
      },
    });
    onCleanup(() => {
      unbind();
      canvasResizeObserver?.disconnect();
    });
  });
  const useCurrentScreenAsStart = async (): Promise<boolean> => {
    if (startCaptureBusy() || hasMap()) return false;
    setStartCaptureBusy(true);
    try {
      const captured = await recorder.captureMapScreen(undefined, { title: "Start" });
      if (!captured) return false;
      setCanvasState(mergeAppMapProjection(canvasState(), captured.appMap));
      if (captured.variant.screenshotUri) {
        setCapturedScreenUrls((urls) => ({
          ...urls,
          [captured.screen.id]: server.authoringEvidenceUrl(
            captured.variant.screenshotUri!,
            "image/png",
          ),
        }));
      }
      setSelectedNodeId(captured.screen.id);
      setSelectedConnectionId(null);
      setCaptureOpen(false);
      toast("Start screen added", "success");
      return true;
    } finally {
      setStartCaptureBusy(false);
    }
  };
  const captureCurrentScreen = async () => {
    if (startCaptureBusy()) return;
    if (!targetIsReady(selectedDevice(), server.health() === "online")) {
      toast("Choose a connected device before capturing its screen", "info");
      openDevicePicker();
      return;
    }
    setStartCaptureBusy(true);
    try {
      const captured = await recorder.captureMapScreen();
      if (!captured) return;
      const next = mergeAppMapProjection(canvasState(), captured.appMap);
      setCanvasState(next);
      if (captured.variant.screenshotUri) {
        setCapturedScreenUrls((urls) => ({
          ...urls,
          [captured.screen.id]: server.authoringEvidenceUrl(
            captured.variant.screenshotUri!,
            "image/png",
          ),
        }));
      }
      const node = buildCanvasGraphTree(next.graph ?? graph(), draft.steps()).nodes.find(
        (candidate) => candidate.id === captured.screen.id,
      );
      if (node) selectNode(node);
      toast(captured.created ? "Screen added to the map" : "Existing screen refreshed", "success");
    } finally {
      setStartCaptureBusy(false);
    }
  };
  const addNote = () => {
    const element = canvas;
    const note = createCanvasNote({
      viewport: view(),
      clientWidth: element?.clientWidth,
      clientHeight: element?.clientHeight,
    });
    persistNotes([...(canvasState().notes ?? []), note]);
  };
  let automaticFirstNoteHandledFor = "";
  createEffect(() => {
    const appMapId = server.selectedAppMapId();
    if (
      !appMapId ||
      automaticFirstNoteHandledFor === appMapId ||
      !props.addNoteOnReady ||
      loadedAppMapId() !== appMapId
    )
      return;
    automaticFirstNoteHandledFor = appMapId;
    addNote();
    props.onAddNoteHandled?.();
  });
  const {
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
  } = useAppMapTakeReview({
    loadedAppMapId,
    graph,
    connections,
    treeNodes: () => tree().nodes,
    titleFor,
    selectedNodeId,
    selectedDevice,
    setCaptureOpen,
    openDevicePicker,
    selectNode,
    getPendingConnectionId: () => pendingConnectionId,
    setPendingConnectionId: (id) => {
      pendingConnectionId = id;
    },
    getRecordingSourceScreenId: () => recordingSourceScreenId,
    setRecordingSourceScreenId: (id) => {
      recordingSourceScreenId = id;
    },
  });
  const recordFromNode = (screen: MapTreeNode | null) => {
    // Preserve intent before device setup. A target selection should resume
    // this same recording request, not leave the user at an unrelated empty
    // canvas asking what comes next.
    recordingSourceScreenId = screen?.id ?? selectedNodeId();
    recorder.setRecordingSourceScreen(recordingSourceScreenId ?? undefined);
    if (screen) recorder.setRecordingGroup(titleFor(screen));
    const state = recordState();
    if (state === "setup-ios") {
      // Setup is a separate, explicit task. Do not preserve a hidden capture
      // request (or its grouping) that could be applied after setup completes.
      recordingSourceScreenId = null;
      recorder.setRecordingSourceScreen(undefined);
      recorder.setRecordingGroup("");
      window.dispatchEvent(
        new CustomEvent("relay:open-settings", { detail: { section: "devices" } }),
      );
      return;
    }
    if (state !== "ready") {
      // Recording is one intent, even when the live frame is still arriving.
      // Show the selected device's truthful progress in place and continue
      // automatically once it becomes controllable; never make the person
      // click Record a second time after "Starting live view" finishes.
      if (
        state === "enable-developer-mode" ||
        state === "preparing-ios" ||
        state === "preparing-screen" ||
        state === "checking-ios"
      ) {
        setCaptureOpen(true);
        setWaitingForRecordTarget(true);
        return;
      }
      recordRequestedAfterDeviceSelection = true;
      openDevicePicker();
      return;
    }
    // A recording group is a lightweight, executable breadcrumb: it makes the
    // outline say which screen the captured actions belong to without adding a
    // second, non-runnable graph model.
    recordRequestedAfterDeviceSelection = false;
    setCaptureOpen(true);
    void recorder.enterRecordMode();
    // Keep the graph visible: the device is already alongside it, and a new
    // action will appear on the selected screen as soon as it is captured.
  };
  const recordFromHere = () => recordFromNode(selectedNode());
  const captureContextLabel = () =>
    buildCaptureContextLabel({
      pendingConnectionId,
      connections: connections(),
      nodes: tree().nodes,
      titleFor,
    });
  const recordConnection = (connection: CanvasConnection) => {
    const screen = tree().nodes.find((node) => node.id === connection.fromScreenId) ?? null;
    pendingConnectionId = connection.id;
    recorder.setRecordingTransition(connection.id);
    recordFromNode(screen);
  };
  const { setTransitionReplay, replayStateFor, replayErrorFor, replayConnection } =
    useAppMapTransitionReplay({
      activeAppMap,
      canvasState,
      treeNodes: () => tree().nodes,
      titleFor,
      selectedDevice,
      canonicalConnectionFor,
      persistMetadata,
      canReplayOnDevice,
    });
  const {
    updateConnectionWait,
    attachBackBehavior,
    attachAutomaticBehavior,
    attachReusableBehavior,
    saveReusableBehavior: saveReusableBehaviorBase,
  } = useAppMapConnectionBehaviors({
    activeAppMap,
    canonicalConnectionFor,
    onConnectionActionsChanged: (connectionId) =>
      setTransitionReplay({ connectionId, state: "idle" }),
  });
  const saveReusableBehavior = async (connection: CanvasConnection) => {
    await saveReusableBehaviorBase(
      connection,
      [
        recordedActionFromConnection(
          connection,
          stepsForConnectionIds(draft.steps(), connection.stepIds),
        ),
      ],
      connectionPathTitle(connection, tree().nodes, titleFor),
    );
  };
  const beginConnection = (event: PointerEvent, fromScreenId: string) => {
    const element = canvas;
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    const point = canvasPointFromClientRect(
      event.clientX,
      event.clientY,
      element.getBoundingClientRect(),
      view(),
    );
    connectionDrag = { fromScreenId, pointerId: event.pointerId, origin: point, point };
    element.setPointerCapture(event.pointerId);
  };
  const {
    chooseKeyboardConnection,
    createKeyboardDestination,
    removeConnection,
    removeScreen,
    renameScreen,
  } = useAppMapGraphEdits({
    canvasState,
    graph,
    treeNodes: () => tree().nodes,
    draftSteps: () => draft.steps(),
    positionFor,
    titleFor,
    persistMetadata,
    setKeyboardConnectionSourceId,
    setSelectedConnectionId,
    setSelectedNodeId,
    setScreenInspectorOpen,
    setRenamingNodeId,
  });
  const { groupSelection, ungroup, ungroupSelection, renameGroup, selectGroup } = useAppMapGroupOps(
    {
      activeAppMap,
      canvasState,
      groups,
      selectedNodeIds,
      persistMetadata,
      setSelectedNodeIdValue,
      setSelectedNodeIds,
      setSelectedConnectionId,
      setSelectedGroupId,
      setRenamingGroupId,
      setScreenInspectorOpen,
      setRenamingNodeId,
      setGroupMenu: () => setGroupMenu(null),
    },
  );
  const openGroupMenu = (event: MouseEvent, options: { groupId?: string; screenIds: string[] }) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    setGroupMenu({
      ...clampGroupMenuPosition({ clientX: event.clientX, clientY: event.clientY, rect }),
      ...options,
    });
  };
  const undo = () => {
    const entry = canvasUndoStack.pop();
    if (!entry) {
      draft.undo();
      return;
    }
    canvasRedoStack.push(entry);
    setCanvasHistoryDepth({ undo: canvasUndoStack.length, redo: canvasRedoStack.length });
    persistMetadata(structuredClone(entry.before), {
      before: canvasState(),
      recordHistory: false,
    });
  };
  const redo = () => {
    const entry = canvasRedoStack.pop();
    if (!entry) {
      draft.redo();
      return;
    }
    canvasUndoStack.push(entry);
    setCanvasHistoryDepth({ undo: canvasUndoStack.length, redo: canvasRedoStack.length });
    persistMetadata(structuredClone(entry.after), {
      before: canvasState(),
      recordHistory: false,
    });
  };

  createAppMapEventOrchestration({
    devicePanelOpen: captureOpen,
    runReadiness: graphRunReadiness,
    canvasTool,
    renamingScreen: () => Boolean(renamingNodeId()),
    onDeviceSelected: () => {
      if (!recordRequestedAfterDeviceSelection) return;
      recordRequestedAfterDeviceSelection = false;
      setWaitingForRecordTarget(true);
    },
    onToggleDevicePanel: () => {
      setHistoryOpen(false);
      if (captureOpen()) closeCapturePanel();
      else setCaptureOpen(true);
    },
    onCloseDevicePanel: closeCapturePanel,
    onRunMap: runCanvasGraph,
    onUndoRequest: (event, shouldRedo) => {
      const canUndo = canvasHistoryDepth().undo > 0 || draft.canUndo();
      const canRedo = canvasHistoryDepth().redo > 0 || draft.canRedo();
      if (shouldRedo ? !canRedo : !canUndo) return;
      event.preventDefault();
      if (shouldRedo) redo();
      else undo();
    },
    onToolChange: setCanvasTool,
    onCaptureScreen: () => void captureCurrentScreen(),
    onAddNote: addNote,
    onCreateConnection: () => {
      const node = selectedNode();
      if (node) setKeyboardConnectionSourceId(node.id);
      else toast("Select the screen where this connection begins", "info");
    },
    onRecord: () => {
      if (recorder.recording()) {
        void recorder.stopRecording();
        return;
      }
      if (!hasCanvasContent()) {
        void useCurrentScreenAsStart();
        return;
      }
      const connection = selectedConnection();
      if (connection) recordConnection(connection);
      else if (selectedNode()) recordFromHere();
      else toast("Select a screen or connection to record", "info");
    },
    onGroupSelection: groupSelection,
    onUngroupSelection: () => {
      const group = selectedGroup();
      if (group) ungroup(group);
      else ungroupSelection();
    },
    onDeleteSelection: () => {
      const group = selectedGroup();
      if (group) {
        ungroup(group);
        return;
      }
      const connection = selectedConnection();
      if (connection) {
        removeConnection(connection);
        return;
      }
      const node = selectedNode();
      if (node) removeScreen(node);
    },
    onEscape: () => {
      const marquee = selectionMarquee();
      if (marquee) {
        setSelectedNodeIds(marquee.baseIds);
        setSelectedNodeIdValue(marquee.baseIds.at(-1) ?? null);
        setSelectionMarquee(null);
        return;
      }
      if (contextSurface()) {
        setContextSurface(null);
        return;
      }
      setSelectedNodeId(null);
      setSelectedGroupId(null);
      setRenamingGroupId(null);
      setGroupMenu(null);
      setScreenInspectorOpen(false);
      setSelectedConnectionId(null);
      setKeyboardConnectionSourceId(null);
      setHistoryOpen(false);
    },
  });

  return (
    <section
      class={cn(
        "app-map-canvas relative grid min-h-0 flex-1 overflow-hidden",
        appMapLoadState().status === "ready" && reviewingTake()
          ? "grid-cols-[minmax(280px,320px)_minmax(0,1fr)] max-[760px]:grid-cols-1 max-[760px]:grid-rows-[minmax(260px,42%)_minmax(0,1fr)]"
          : "grid-cols-1",
      )}
      aria-busy={appMapLoadState().status === "loading"}
    >
      <Show when={appMapLoadState().status === "ready" && !reviewingTake()}>
        <section
          ref={observeCanvas}
          class={cn(
            "relative isolate flex min-h-0 min-w-0 touch-none select-none overflow-hidden",
            canvasTool() === "hand" ? "cursor-grab active:cursor-grabbing" : "cursor-default",
          )}
          aria-label="App Map"
          onWheel={(event) => {
            if (!hasCanvasContent()) return;
            const action = canvasWheelAction({
              deltaX: event.deltaX,
              deltaY: event.deltaY,
              deltaMode: event.deltaMode,
              shiftKey: event.shiftKey,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              viewportHeight: event.currentTarget.clientHeight,
            });
            if (!action) return;
            event.preventDefault();
            if (action.kind === "zoom") {
              zoom(action.delta, { x: event.clientX, y: event.clientY });
              return;
            }
            setView((current) => ({
              ...current,
              x: current.x + action.x,
              y: current.y + action.y,
            }));
          }}
          onPointerDown={(event) => {
            const target = event.target as HTMLElement;
            const isCanvasBackground = !target.closest(
              "[data-app-map-screen-id], [data-app-map-group-id], aside, button, input, textarea",
            );
            if (!target.closest("[data-app-map-group-menu]")) setGroupMenu(null);
            const wantsPan = canvasTool() === "hand" || event.button === 1;
            if (hasCanvasContent() && wantsPan && !target.closest("button")) {
              pan = { x: event.clientX, y: event.clientY, view: view() };
              event.currentTarget.setPointerCapture(event.pointerId);
              return;
            }
            if (!hasCanvasContent() || !isCanvasBackground || event.button !== 0) return;
            const point = canvasPointFromClient(event.clientX, event.clientY);
            setSelectedGroupId(null);
            setSelectedConnectionId(null);
            setScreenInspectorOpen(false);
            setSelectionMarquee({
              pointerId: event.pointerId,
              start: point,
              current: point,
              startClient: { x: event.clientX, y: event.clientY },
              baseIds: event.shiftKey ? [...selectedNodeIds()] : [],
              additive: event.shiftKey,
              moved: false,
            });
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            scheduleCanvasPointerMove(event.clientX, event.clientY);
          }}
          onPointerUp={(event) => {
            flushCanvasPointerMove(event.clientX, event.clientY);
            const marquee = selectionMarquee();
            if (marquee?.pointerId === event.pointerId) {
              if (!marquee.moved && !marquee.additive) setSelectedNodeId(null);
              setSelectionMarquee(null);
              return;
            }
            if (connectionDrag) {
              const source = connectionDrag.fromScreenId;
              const hit = document.elementFromPoint(event.clientX, event.clientY);
              const target = hit?.closest<HTMLElement>("[data-app-map-screen-id]")?.dataset
                .appMapScreenId;
              let next: AppMapCanvasState | null = null;
              if (target && target !== source) {
                next = addPlannedConnection(
                  canvasState(),
                  {
                    fromScreenId: source,
                    toScreenId: target,
                  },
                  Date.now(),
                  draft.steps(),
                );
              } else if (
                !target &&
                hit?.closest('[aria-label="App Map"]') === event.currentTarget &&
                !hit.closest("button, aside, header") &&
                Math.hypot(
                  connectionDrag.point.x - connectionDrag.origin.x,
                  connectionDrag.point.y - connectionDrag.origin.y,
                ) > 72
              ) {
                next = addPlannedScreenConnection(
                  canvasState(),
                  {
                    fromScreenId: source,
                    position: {
                      x: Math.max(24, connectionDrag.point.x - 98),
                      y: Math.max(64, connectionDrag.point.y - 124),
                    },
                  },
                  Date.now(),
                  draft.steps(),
                );
              }
              if (next) {
                const connection = next.graph?.transitions.at(-1);
                persistMetadata(next);
                setSelectedConnectionId(connection?.id ?? null);
                setSelectedNodeId(null);
              }
              connectionDrag = undefined;
              setConnectionPreview(null);
              return;
            }
            if (nodeDrag?.moved) {
              // Membership changes only through Group/Ungroup. The Group's
              // visual bounds derive from its members and resize while they move.
              persistMetadata(withCanvasGraph(canvasState(), graph()), { before: nodeDrag.before });
              suppressNodeSelectionClick = true;
              queueMicrotask(() => {
                suppressNodeSelectionClick = false;
              });
            }
            if (noteDrag?.moved) persistNotes(canvasState().notes ?? [], noteDrag.before);
            nodeDrag = undefined;
            noteDrag = undefined;
            pan = undefined;
          }}
          onPointerCancel={() => {
            if (pointerMoveFrame !== undefined) cancelAnimationFrame(pointerMoveFrame);
            pointerMoveFrame = undefined;
            pendingPointerMove = undefined;
            connectionDrag = undefined;
            setConnectionPreview(null);
            nodeDrag = undefined;
            noteDrag = undefined;
            pan = undefined;
            const marquee = selectionMarquee();
            if (marquee) {
              setSelectedNodeIds(marquee.baseIds);
              setSelectedNodeIdValue(marquee.baseIds.at(-1) ?? null);
              setSelectionMarquee(null);
            }
          }}
          onPointerLeave={() => setLocalCursor(undefined)}
        >
          <div class="app-map-grid pointer-events-none absolute inset-0" aria-hidden="true" />
          <AppMapOverviewToolbar
            screenCount={tree().nodes.length}
            connectionCount={connections().length}
            view={workspaceView()}
            proposalCount={pendingProposals().length}
            shiftForDevice={captureOpen() && Boolean(selectedDevice())}
            wideDevice={deviceCompanionOrientation() === "landscape"}
            onViewChange={(next) => {
              setWorkspaceView(next);
              setHistoryOpen(false);
              setKeyboardConnectionSourceId(null);
            }}
            onOpenProposals={() => setProposalReviewOpen(true)}
          />
          <Show when={proposalReviewOpen()}>
            <AppMapProposalReview
              proposals={pendingProposals()}
              busyId={proposalBusyId()}
              error={proposalError()}
              onApprove={(proposalId) => void decideProposal(proposalId, "approve")}
              onReject={(proposalId) => void decideProposal(proposalId, "reject")}
              onRequestChanges={(proposalId, reason) =>
                void decideProposal(proposalId, "reject", reason)
              }
              onClose={() => setProposalReviewOpen(false)}
            />
          </Show>
          <Show when={agentOpen() && activeAppMap()}>
            <AppMapAgentPanel
              exploration={agentExploration}
              onOpenTargets={() => {
                setAgentOpen(false);
                openDevicePicker();
              }}
              onClose={() => {
                setAgentOpen(false);
                queueMicrotask(() =>
                  document
                    .querySelector<HTMLButtonElement>('[aria-label="Explore with Relay"]')
                    ?.focus(),
                );
              }}
              onProposalReady={() => {
                setAgentOpen(false);
                setProposalReviewOpen(true);
              }}
            />
          </Show>
          <Show
            when={workspaceView() === "map"}
            fallback={
              <Show when={activeAppMap()}>
                {(appMap) => (
                  <AppMapBrowseView
                    mode={workspaceView() === "coverage" ? "coverage" : "screens"}
                    appMap={appMap()}
                    runs={server.persistedRuns()}
                    recipeId={appMap().id}
                    targetNameForId={(targetId) =>
                      server.devices().find((target) => target.serial === targetId)?.name
                    }
                    deviceOpen={captureOpen()}
                    imageForScreen={(screenId) => {
                      const node = tree().nodes.find((candidate) => candidate.id === screenId);
                      if (!node) return capturedScreenUrls()[screenId] ?? "";
                      return (
                        screenshotUrl(server, draft.steps()[node.representativeStepIndex]) ||
                        capturedScreenUrls()[screenId] ||
                        variantScreenshotUrl(server, appMap(), screenId) ||
                        ""
                      );
                    }}
                    orientationEvidenceForScreen={(screenId) => {
                      const node = tree().nodes.find((candidate) => candidate.id === screenId);
                      return node
                        ? screenshotOrientationEvidence(
                            server,
                            draft.steps()[node.representativeStepIndex],
                          ) || variantOrientationEvidence(appMap(), screenId)
                        : undefined;
                    }}
                    stateForScreen={(screenId) => runProjection().screens[screenId]?.state}
                    onOpenScreen={(screenId) => {
                      setWorkspaceView("map");
                      setSelectedNodeId(screenId);
                      setScreenInspectorOpen(false);
                      setSelectedConnectionId(null);
                      queueMicrotask(() => revealScreen(screenId));
                    }}
                    onOpenRun={(runId) => {
                      server.setSelectedJobId(runId);
                      props.onOpenRun?.(runId);
                    }}
                    onToggleDevice={() =>
                      captureOpen() ? closeCapturePanel() : openCapturePanel()
                    }
                    onCaptureScreen={() => void captureCurrentScreen()}
                    onOpenAgent={() => {
                      closeCapturePanel();
                      setHistoryOpen(false);
                      setAgentOpen(true);
                    }}
                    refreshScreenshotsHint={
                      graphRunReadiness().ready
                        ? "Replay the flow and compare fresh captures with approved baselines"
                        : graphRunReadiness().reason
                    }
                    onRefreshScreenshots={refreshMapScreenshots}
                  />
                )}
              </Show>
            }
          >
            <Show when={historyOpen()}>
              <AppMapHistoryPanel
                loading={draft.historyLoading()}
                entries={draft.savedHistory()}
                activity={Object.values(activeAppMap()?.activity ?? {}).sort(
                  (left, right) => right.at - left.at,
                )}
                onClose={() => setHistoryOpen(false)}
                onRestore={(updatedAt) => {
                  void draft.restoreSavedHistory(updatedAt);
                  setHistoryOpen(false);
                }}
              />
            </Show>
            <Show
              when={hasCanvasContent()}
              fallback={
                <AppMapEmptyState
                  take={recorder.take()}
                  recordState={recordState()}
                  selectedDeviceName={
                    selectedDevice()?.name ?? server.selectedDevice() ?? undefined
                  }
                  deviceOpen={captureOpen()}
                  deviceSelected={Boolean(selectedDevice())}
                  liveScreenSrc={liveScreenSrc()}
                  captureBusy={startCaptureBusy()}
                  onStartRecording={recordFromHere}
                  onCaptureScreen={() => void captureCurrentScreen()}
                  onAddNote={addNote}
                  onToggleDevice={() => (captureOpen() ? closeCapturePanel() : openCapturePanel())}
                />
              }
            >
              <div
                class="absolute top-0 left-0 origin-top-left will-change-transform"
                style={{
                  width: `${bounds().width}px`,
                  height: `${bounds().height}px`,
                  transform: `translate3d(${view().x}px, ${view().y}px, 0) scale(${view().scale})`,
                }}
              >
                <Show when={marqueeRect()}>
                  {(selection) => (
                    <div
                      class="pointer-events-none absolute z-50 rounded-[4px] border border-[var(--text-interactive-base)] bg-[color-mix(in_srgb,var(--product-accent-soft)_48%,transparent)]"
                      data-app-map-marquee
                      aria-hidden="true"
                      style={{
                        transform: `translate3d(${selection().left}px, ${selection().top}px, 0)`,
                        width: `${selection().width}px`,
                        height: `${selection().height}px`,
                        "border-width": `${1 / view().scale}px`,
                      }}
                    />
                  )}
                </Show>
                <AppMapCanvasScene
                  nodes={tree().nodes}
                  connections={connections()}
                  notes={canvasState().notes ?? []}
                  groups={groups()}
                  width={bounds().width}
                  height={bounds().height}
                  viewportScale={view().scale}
                  visibleBounds={visibleCanvasBounds()}
                  selectedNodeId={selectedNodeId()}
                  selectedNodeIds={selectedNodeIds()}
                  selectedGroupId={selectedGroupId()}
                  selectedConnectionId={selectedConnectionId()}
                  renamingNodeId={renamingNodeId()}
                  renamingGroupId={renamingGroupId()}
                  keyboardConnectionSourceId={keyboardConnectionSourceId()}
                  connectionPreview={
                    connectionPreview() && connectionDrag
                      ? {
                          fromScreenId: connectionDrag.fromScreenId,
                          point: connectionPreview()!,
                        }
                      : undefined
                  }
                  awareness={remoteAwareness()}
                  presenceGeometry={presenceGeometry()}
                  positionFor={positionFor}
                  titleFor={titleFor}
                  imageFor={(node) =>
                    screenshotUrl(server, draft.steps()[node.representativeStepIndex]) ||
                    capturedScreenUrls()[node.id] ||
                    variantScreenshotUrl(server, activeAppMap(), node.id) ||
                    ""
                  }
                  orientationEvidenceFor={(node) =>
                    screenshotOrientationEvidence(
                      server,
                      draft.steps()[node.representativeStepIndex],
                    ) || variantOrientationEvidence(activeAppMap(), node.id)
                  }
                  detailsOpen={screenInspectorOpen()}
                  isFlowStart={(node) =>
                    !connections().some((connection) => connection.toScreenId === node.id)
                  }
                  screenRunState={(screenId) => runProjection().screens[screenId]?.state}
                  connectionRunState={(connectionId) =>
                    runProjection().transitions[connectionId]?.state
                  }
                  caseCountFor={(connection) => {
                    const stack = caseStackFor(connection);
                    return stack
                      ? caseStackCount(stack, server.projectVariables().value)
                      : undefined;
                  }}
                  onSelectNode={selectNode}
                  onNodeContextMenu={(event, node) => {
                    if (!selectedNodeIds().includes(node.id)) setSelectedNodeId(node.id);
                    openGroupMenu(event, {
                      screenIds: selectedNodeIds().includes(node.id)
                        ? selectedNodeIds()
                        : [node.id],
                    });
                  }}
                  onSelectConnection={(connection) => {
                    setSelectedConnectionId(connection.id);
                    setSelectedNodeId(null);
                    setScreenInspectorOpen(false);
                  }}
                  onRenameNode={(node) => setRenamingNodeId(node.id)}
                  onOpenNodeDetails={(node) => {
                    selectNode(node);
                    setScreenInspectorOpen(true);
                  }}
                  onCommitNodeRename={renameScreen}
                  onConnectStart={(event, node) => beginConnection(event, node.id)}
                  onConnectKeyboard={(node) => {
                    selectNode(node);
                    setKeyboardConnectionSourceId(node.id);
                  }}
                  onNodePointerDown={(event, node) => {
                    if (event.button !== 0) return;
                    if (canvasTool() === "hand") {
                      event.stopPropagation();
                      pan = { x: event.clientX, y: event.clientY, view: view() };
                      canvas?.setPointerCapture(event.pointerId);
                      return;
                    }
                    event.stopPropagation();
                    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
                    const ids = selectedNodeIds().includes(node.id) ? selectedNodeIds() : [node.id];
                    nodeDrag = {
                      id: node.id,
                      ids,
                      x: event.clientX,
                      y: event.clientY,
                      origins: Object.fromEntries(
                        ids.flatMap((id) => {
                          const member = tree().nodes.find((candidate) => candidate.id === id);
                          return member ? [[id, { ...positionFor(member) }] as const] : [];
                        }),
                      ),
                      moved: false,
                      before: structuredClone(canvasState()),
                    };
                  }}
                  onSelectGroup={selectGroup}
                  onGroupPointerDown={(event, group) => {
                    if (canvasTool() === "hand" || event.button !== 0) return;
                    event.stopPropagation();
                    selectGroup(group);
                    event.currentTarget.setPointerCapture(event.pointerId);
                    nodeDrag = {
                      id: group.id,
                      ids: [...group.screenIds],
                      x: event.clientX,
                      y: event.clientY,
                      origins: Object.fromEntries(
                        group.screenIds.flatMap((id) => {
                          const member = tree().nodes.find((candidate) => candidate.id === id);
                          return member ? [[id, { ...positionFor(member) }] as const] : [];
                        }),
                      ),
                      groupId: group.id,
                      moved: false,
                      before: structuredClone(canvasState()),
                    };
                  }}
                  onGroupContextMenu={(event, group) => {
                    selectGroup(group);
                    openGroupMenu(event, { groupId: group.id, screenIds: [...group.screenIds] });
                  }}
                  onRenameGroup={(group) => {
                    selectGroup(group);
                    setRenamingGroupId(group.id);
                  }}
                  onCommitGroupRename={renameGroup}
                  onUngroup={ungroup}
                  onGroupSelection={groupSelection}
                  onChooseKeyboardConnection={chooseKeyboardConnection}
                  onCreateKeyboardDestination={createKeyboardDestination}
                  onCancelKeyboardConnection={() => setKeyboardConnectionSourceId(null)}
                  onNotePointerDown={(event, note) => {
                    event.stopPropagation();
                    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
                    noteDrag = {
                      id: note.id,
                      x: event.clientX,
                      y: event.clientY,
                      origin: { x: note.x, y: note.y },
                      moved: false,
                      before: structuredClone(canvasState()),
                    };
                  }}
                  onNoteText={(note, text) =>
                    setCanvasState((current) => ({
                      ...current,
                      notes: (current.notes ?? []).map((entry) =>
                        entry.id === note.id ? { ...entry, text, updatedAt: Date.now() } : entry,
                      ),
                    }))
                  }
                  onCommitNote={(note, previousText) => {
                    const before = withCanvasGraph(
                      {
                        ...canvasState(),
                        notes: (canvasState().notes ?? []).map((entry) =>
                          entry.id === note.id ? { ...entry, text: previousText } : entry,
                        ),
                      },
                      graph(),
                    );
                    persistNotes(canvasState().notes ?? [], before);
                  }}
                  onDeleteNote={(note) =>
                    persistNotes(
                      (canvasState().notes ?? []).filter((entry) => entry.id !== note.id),
                    )
                  }
                />
              </div>
              <Show when={groupMenu()}>
                {(menu) => {
                  const menuGroup = () =>
                    menu().groupId
                      ? groups().find((group) => group.id === menu().groupId)
                      : undefined;
                  const hasGroupedScreen = () =>
                    menu().screenIds.some((screenId) =>
                      Boolean(groupForScreen(groups(), screenId)),
                    );
                  return (
                    <aside
                      role="menu"
                      aria-label="Group actions"
                      data-app-map-group-menu
                      data-canvas-shortcuts="ignore"
                      class="absolute z-50 grid w-48 gap-0.5 rounded-[10px] bg-[var(--map-control-surface)] p-1.5 shadow-[var(--map-elevation-panel)]"
                      style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <Show
                        when={menuGroup()}
                        fallback={
                          <>
                            <Show when={menu().screenIds.length > 1}>
                              <button
                                type="button"
                                role="menuitem"
                                class="flex h-8 items-center justify-between rounded-[7px] px-2.5 text-left text-[12px] text-[var(--text-strong)] hover:bg-[var(--v2-background-bg-layer-02)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                                onClick={groupSelection}
                              >
                                <span class="inline-flex items-center gap-2">
                                  <Icon name="group" size={13} /> Group
                                </span>
                                <kbd class="text-[10px] text-[var(--text-weak)]">⌘G</kbd>
                              </button>
                            </Show>
                            <Show when={hasGroupedScreen()}>
                              <button
                                type="button"
                                role="menuitem"
                                class="flex h-8 items-center justify-between rounded-[7px] px-2.5 text-left text-[12px] text-[var(--text-strong)] hover:bg-[var(--v2-background-bg-layer-02)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                                onClick={ungroupSelection}
                              >
                                <span>Ungroup</span>
                                <kbd class="text-[10px] text-[var(--text-weak)]">⇧⌘G</kbd>
                              </button>
                            </Show>
                            <Show when={menu().screenIds.length < 2 && !hasGroupedScreen()}>
                              <p class="px-2.5 py-2 text-[11px]/[1.45] text-[var(--text-weak)]">
                                Shift-click another screen to group them.
                              </p>
                            </Show>
                          </>
                        }
                      >
                        {(group) => (
                          <>
                            <button
                              type="button"
                              role="menuitem"
                              class="flex h-8 items-center justify-between rounded-[7px] px-2.5 text-left text-[12px] text-[var(--text-strong)] hover:bg-[var(--v2-background-bg-layer-02)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                              onClick={() => {
                                setGroupMenu(null);
                                setRenamingGroupId(group().id);
                              }}
                            >
                              <span>Rename Group</span>
                              <kbd class="text-[10px] text-[var(--text-weak)]">F2</kbd>
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              class="flex h-8 items-center justify-between rounded-[7px] px-2.5 text-left text-[12px] text-[var(--text-strong)] hover:bg-[var(--v2-background-bg-layer-02)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
                              onClick={() => ungroup(group())}
                            >
                              <span>Ungroup</span>
                              <kbd class="text-[10px] text-[var(--text-weak)]">⇧⌘G</kbd>
                            </button>
                          </>
                        )}
                      </Show>
                    </aside>
                  );
                }}
              </Show>
              <Show when={!captureOpen()}>
                <Show
                  when={selectedGroup()}
                  fallback={
                    <Show
                      when={selectedConnection()}
                      fallback={
                        <ScreenInspector
                          node={screenInspectorOpen() ? selectedNode() : null}
                          title={selectedNode() ? titleFor(selectedNode()!) : ""}
                          image={
                            selectedNode()
                              ? screenshotUrl(
                                  server,
                                  draft.steps()[selectedNode()!.representativeStepIndex],
                                ) ||
                                capturedScreenUrls()[selectedNode()!.id] ||
                                variantScreenshotUrl(server, activeAppMap(), selectedNode()!.id) ||
                                undefined
                              : undefined
                          }
                          orientationEvidence={
                            selectedNode()
                              ? screenshotOrientationEvidence(
                                  server,
                                  draft.steps()[selectedNode()!.representativeStepIndex],
                                ) || variantOrientationEvidence(activeAppMap(), selectedNode()!.id)
                              : undefined
                          }
                          runState={
                            selectedNode()
                              ? runProjection().screens[selectedNode()!.id]?.state
                              : undefined
                          }
                          isFlowStart={
                            selectedNode()
                              ? !connections().some(
                                  (connection) => connection.toScreenId === selectedNode()!.id,
                                )
                              : false
                          }
                          connections={connections().filter(
                            (connection) => connection.fromScreenId === selectedNode()?.id,
                          )}
                          flowSetup={selectedFlowSetup()}
                          onFlowSetup={(routineId) => void setSelectedFlowSetup(routineId)}
                          onSelectConnection={(connection) => {
                            setSelectedConnectionId(connection.id);
                            setSelectedNodeId(null);
                            setScreenInspectorOpen(false);
                          }}
                          onRemove={() => {
                            const node = selectedNode();
                            if (node) removeScreen(node);
                          }}
                          onClose={() => setScreenInspectorOpen(false)}
                        />
                      }
                    >
                      {(connection) => (
                        <ConnectionInspector
                          connection={connection()}
                          actionCount={canonicalConnectionFor(connection())?.actions.reduce(
                            (count, action) =>
                              count +
                              (action.kind === "recorded" || action.kind === "steps"
                                ? action.steps.length
                                : 1),
                            0,
                          )}
                          actions={connectionActionSummaries(
                            canonicalConnectionFor(connection())?.actions ?? [],
                            activeAppMap(),
                          )}
                          onChangeWait={(actionId, stepId, waitMs) =>
                            void updateConnectionWait(connection(), actionId, stepId, waitMs)
                          }
                          sourceTitle={titleFor(
                            tree().nodes.find((node) => node.id === connection().fromScreenId)!,
                          )}
                          targetTitle={titleFor(
                            tree().nodes.find((node) => node.id === connection().toScreenId)!,
                          )}
                          setup={{
                            behaviors: reusableBehaviors(),
                            onRecord: () => recordConnection(connection()),
                            onBack: () => attachBackBehavior(connection()),
                            onAutomatic: () => attachAutomaticBehavior(connection()),
                            onAttachBehavior: (recipeId) =>
                              attachReusableBehavior(connection(), recipeId),
                          }}
                          replay={{
                            state: replayStateFor(connection()),
                            canEditActions: draft
                              .steps()
                              .some((step) => step.id === connection().stepId),
                            ...(replayErrorFor(connection())
                              ? { error: replayErrorFor(connection()) }
                              : {}),
                            onRun: () => void replayConnection(connection()),
                            onRewrite: () => recordConnection(connection()),
                            onSaveReusable: () => void saveReusableBehavior(connection()),
                            onSelectStep: () => {
                              const index = draft
                                .steps()
                                .findIndex((step) => step.id === connection().stepId);
                              if (index < 0) return;
                              selectStep(index);
                              props.onOpenActions();
                            },
                          }}
                          cases={{
                            ...(caseStackFor(connection())
                              ? { stack: caseStackFor(connection()) }
                              : {}),
                            stacks: Object.values(activeAppMap()?.caseStacks ?? {}),
                            variables: server.projectVariables().value,
                            busy: caseStackBusy(),
                            onSave: (value) => void saveConnectionCaseStack(connection(), value),
                            onAttach: (caseStackId) =>
                              void attachConnectionCaseStack(connection(), caseStackId),
                            onDetach: () => void detachConnectionCaseStack(connection()),
                            onOpenVariables: props.onOpenVariables,
                          }}
                          onRemove={() => removeConnection(connection())}
                          onClose={() => setSelectedConnectionId(null)}
                        />
                      )}
                    </Show>
                  }
                >
                  {(group) => (
                    <GroupInspector
                      group={group()}
                      screens={group()
                        .screenIds.map((id) => tree().nodes.find((node) => node.id === id))
                        .flatMap((node) => (node ? [{ id: node.id, title: titleFor(node) }] : []))}
                      onSelectScreen={(screenId) => {
                        setSelectedGroupId(null);
                        setSelectedNodeId(screenId);
                        setScreenInspectorOpen(true);
                      }}
                      onRename={() => setRenamingGroupId(group().id)}
                      onUngroup={() => ungroup(group())}
                      onClose={() => setSelectedGroupId(null)}
                    />
                  )}
                </Show>
              </Show>
              <AppMapToolbar
                tool={canvasTool()}
                deviceOpen={captureOpen()}
                shiftForDevice={Boolean((captureOpen() && selectedDevice()) || agentOpen())}
                wideDevice={deviceCompanionOrientation() === "landscape"}
                explorationState={agentExploration.state()}
                explorationCount={agentExploration.workers().length}
                onToolChange={setCanvasTool}
                onCaptureScreen={() => void captureCurrentScreen()}
                onCreateConnection={() => {
                  const node = selectedNode();
                  if (node) setKeyboardConnectionSourceId(node.id);
                  else toast("Select the screen where this connection begins", "info");
                }}
                onAddNote={addNote}
                onExplore={() => {
                  closeCapturePanel();
                  setHistoryOpen(false);
                  setAgentOpen(true);
                }}
                onToggleDevice={() => (captureOpen() ? closeCapturePanel() : openCapturePanel())}
              />
              <AppMapMinimap
                scale={view().scale}
                nodes={minimapNodes()}
                edges={minimapEdges()}
                viewport={minimapViewport()}
                shiftForSidePanel={Boolean((captureOpen() && selectedDevice()) || agentOpen())}
                wideDevice={deviceCompanionOrientation() === "landscape"}
                onZoomOut={() => zoom(-0.1)}
                onZoomIn={() => zoom(0.1)}
                onFit={fit}
                onNavigate={(ratio) => {
                  const element = canvas;
                  if (!element) return;
                  setView((current) =>
                    centerCanvasViewport(
                      current,
                      { width: element.clientWidth, height: element.clientHeight },
                      minimapWorldPoint(ratio, bounds()),
                    ),
                  );
                }}
              />
            </Show>
          </Show>
        </section>
      </Show>
      <Show when={appMapLoadState().status === "ready" && reviewingTake() && recorder.take()}>
        {(take) => (
          <AppMapTakeReviewMount
            selectedIndex={reviewStepIndex()}
            sourceTitle={
              graph().screens.find(
                (screen) => screen.id === (take().sourceScreenId ?? recordingSourceScreenId),
              )?.title ??
              selectedNode()?.title ??
              "Start"
            }
            screens={graph().screens}
            destination={reviewDestination()}
            onSelect={setReviewStepIndex}
            onDestination={setReviewDestination}
            onKeep={() => void keepTake()}
            onDiscard={() => void discardTake()}
            onReplay={() => void replayTake()}
            onRewrite={() => void rewriteTake()}
            takeReplay={takeReplay}
            setTakeReplay={setTakeReplay}
            setReviewStepIndex={setReviewStepIndex}
          />
        )}
      </Show>
      <Show when={appMapLoadState().status === "ready" && captureOpen() && !reviewingTake()}>
        <AppMapDeviceCompanionMount
          closing={captureClosing()}
          deviceSelected={Boolean(selectedDevice())}
          deviceLabel={selectedDevice()?.name ?? selectedDevice()?.serial}
          status={livePanelStatus()}
          captureBusy={startCaptureBusy()}
          canRecord={canRecord()}
          hasCanvasContent={hasCanvasContent()}
          selectedConnection={selectedConnection}
          selectedNode={selectedNode}
          nodes={() => tree().nodes}
          titleFor={titleFor}
          captureContextLabel={captureContextLabel()}
          onClose={closeCapturePanel}
          onOpenTargets={props.onOpenTargets}
          onRecordFromHere={recordFromHere}
          onRecordConnection={recordConnection}
          onOrientation={setDeviceCompanionOrientation}
        />
      </Show>
      <Show when={appMapLoadState().status !== "ready"}>
        <AppMapLoadFeedback
          status={currentLoadFailure() ? "error" : "loading"}
          failure={currentLoadFailure()}
          onRetry={() => setAppMapLoadAttempt((attempt) => attempt + 1)}
        />
      </Show>
    </section>
  );
}
