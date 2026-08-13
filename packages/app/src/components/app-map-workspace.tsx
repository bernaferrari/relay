import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type {
  CanvasNote,
  AppMapCanvasState,
  ConnectionPresentation,
  ScreenVariant,
} from "@relay/protocol";
import { useRecipeDraft } from "../context/recipe-draft";
import { useRecorder } from "../context/recorder";
import { useServer } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { type MapTreeNode } from "../lib/app-map-tree";
import { canvasConnections, type CanvasConnection } from "../lib/app-map-connection-draft";
import {
  connectorAutoLanes,
  connectorHasAutomaticSourceLane,
  connectorPresentationWithAutoLane,
} from "../lib/app-map-connector-lanes";
import { connectionLabelMode } from "../lib/connection-presentation";
import {
  buildCanvasGraphTree,
  ensureCanvasGraph,
  withCanvasGraph,
} from "../lib/app-map-canvas-graph";
import { compactCanvasPositions } from "../lib/app-map-auto-layout";
import { EMPTY_APP_MAP_CANVAS_STATE } from "../lib/app-map-canvas-state";
import {
  canvasBounds,
  canvasEdgeGeometry,
  clampCanvasScale,
  fitCanvasViewport,
  openCanvasViewport,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  screenCardGeometry,
  type CanvasPoint,
  type CanvasScreenRotation,
  type ScreenCardGeometry,
  type CanvasViewport,
} from "../lib/app-map-canvas-layout";
import {
  canvasGridForScale,
  canvasGridPresentation,
  snapCanvasPointToGrid,
} from "../lib/app-map-grid";
import {
  centerCanvasViewport,
  minimapViewportBounds,
  minimapWorldPoint,
} from "../lib/app-map-minimap";
import { zoomViewportAtPoint } from "../lib/viewport-zoom";
import { selectionDetailsScreenId } from "../lib/app-map-selection";
import { deviceReadiness } from "../lib/device-readiness";
import { projectAppMapRun } from "../lib/app-map-run-projection";
import {
  appMapRunReadiness,
  appMapRunTarget,
  findRunnableFlow,
  gateGraphRunReadiness,
} from "../lib/app-map-run-readiness";
import { toast } from "../context/toast";
import { AppMapEmptyState } from "./app-map-capture-review";
import { ConnectionInspector, ScreenInspector } from "./app-map-canvas-primitives";
import { AppMapHistoryPanel } from "./app-map-history-panel";
import { appMapDeviceStatus } from "./device-status-label";
import { AppMapDeviceCompanionMount } from "./app-map-device-companion-mount";
import { AppMapOverviewToolbar, AppMapToolbar, type AppMapWorkspaceView } from "./app-map-toolbar";
import { AppMapMinimap } from "./app-map-minimap";
import { AppMapBrowseView } from "./app-map-browse-view";
import { AppMapAgentPanel } from "./app-map-agent-panel";
import {
  canvasOwnsWheel,
  canvasWheelAction,
  createAppMapEventOrchestration,
} from "./app-map-events";
import {
  connectionStepsFromActions,
  mergeAppMapProjection,
  planAppMapProjection,
  screenRestoreSnapshotFor,
  type AppMapScreenRestoreSnapshot,
} from "../lib/app-map-projection";
import { AppMapProposalReview } from "./app-map-proposal-review";
import { caseStackCount } from "../lib/case-stack-presentation";
import { AppMapCanvasScene } from "./app-map-canvas-scene";
import { AppMapTakeReviewMount } from "./app-map-take-review-mount";
import { useAppMapAgentExploration } from "../lib/use-app-map-agent-exploration";
import { useAppMapCapturePanel } from "../lib/use-app-map-capture-panel";
import { useAppMapCaseStack } from "../lib/use-app-map-case-stack";
import { useAppMapConnectionBehaviors } from "../lib/use-app-map-connection-behaviors";
import { useAppMapFlowSetup } from "../lib/use-app-map-flow-setup";
import { useAppMapProposalReview } from "../lib/use-app-map-proposal-review";
import { targetIsReady } from "../lib/target-presentation";
import {
  appMapCommitSummary,
  applyTargetSetToActiveFlow,
  buildMinimapEdges,
  buildMinimapNodes,
  buildPresenceGeometry,
  captureContextLabel as buildCaptureContextLabel,
  canvasRemovalChanges,
  connectionPathTitle,
  createCanvasNote,
  recordedActionFromConnection,
  entryFlowsForScreen,
  listReusableBehaviors,
  noteChangesFor,
  orderCanvasChanges,
  recipeStepsForRunReadiness,
  recordStateFromReadiness,
  selectedFlowSetupSummary,
  stepsForConnectionIds,
  visibleCanvasBoundsFromViewport,
} from "../lib/app-map-workspace-helpers";
import { createAppMapCanvasHistory } from "../lib/app-map-canvas-history";
import { useAppMapDocumentProjection } from "../lib/use-app-map-document-projection";
import { useAppMapTakeReview } from "../lib/use-app-map-take-review";
import { useAppMapGraphEdits } from "../lib/use-app-map-graph-edits";
import { useAppMapTransitionReplay } from "../lib/use-app-map-transition-replay";
import { useAppMapRunFlow } from "../lib/use-app-map-run-flow";
import { useAppMapPresence } from "../lib/use-app-map-presence";
import { bindAppMapWorkspaceShellEvents } from "../lib/app-map-workspace-shell-events";
import {
  CANVAS_COMBINE_CARD_HEIGHT,
  CANVAS_COMBINE_CARD_WIDTH,
  canvasCombineCards,
  type CanvasCombineSection,
} from "../lib/app-map-combine-canvas";
import {
  applicationIdsMatch,
  expectedAndroidApplicationId,
  matchLiveScreen,
} from "../lib/app-map-live-location";
import {
  screenshotOrientationEvidence,
  screenshotUrl,
  variantOrientationEvidence,
  variantScreenshotUrl,
} from "../lib/app-map-workspace-media";
import { AppMapLoadFeedback } from "./app-map-load-feedback";
import { connectionActionSummaries } from "../lib/connection-action-presentation";
import { useAppMapCanvasGestures } from "./use-app-map-canvas-gestures";

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
  onOpenCombine?: (combineId?: string, section?: CanvasCombineSection) => void;
  navigatorOpen?: boolean;
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
  const groups = () => canvasState().groups ?? [];
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
  const tree = createMemo(() => buildCanvasGraphTree(graph(), draft.steps(), groups()));
  const hasMap = () => tree().nodes.length > 0;
  const selectedDevice = createMemo(
    () => server.devices().find((device) => device.serial === server.selectedDevice()) ?? null,
  );
  const mapRunJob = createMemo(() => {
    const appMapId = server.selectedAppMapId();
    if (!appMapId) return null;
    return server.jobs().find((job) => job.action === appMapId) ?? null;
  });
  const liveRunJob = createMemo(() => {
    const jobId = server.selectedJobId();
    if (!jobId) return null;
    const job = server.jobs().find((candidate) => candidate.id === jobId);
    if (!job || !["queued", "running", "paused"].includes(job.status)) return null;
    const serial = server.selectedDevice();
    return !job.serial || !serial || job.serial === serial ? job : null;
  });
  const liveRunPresentation = createMemo(() => {
    const job = liveRunJob();
    if (!job) return undefined;
    return {
      title: job.title?.trim() || "App map",
      state: job.status as "queued" | "running" | "paused",
      completedSteps: job.steps?.length ?? 0,
      ...(job.recipeSnapshot?.steps.length ? { totalSteps: job.recipeSnapshot.steps.length } : {}),
      ...(job.matrixCase?.world ? { caseLabel: job.matrixCase.world } : {}),
    };
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
  const liveDeviceReadiness = createMemo(() => {
    const device = selectedDevice();
    const liveFrame = server.liveFrame();
    return deviceReadiness(device, server.health() === "online", {
      ...(device?.platform === "ios" ? { appleSetup: server.appleDeviceSetup() } : {}),
      liveCaptureIssue: server.liveCaptureIssue(),
      recordingIssue: recorder.recordingIssue(),
      requireLiveScreen: true,
      liveScreenAvailable:
        Boolean(liveFrame?.base64) && (!liveFrame?.serial || liveFrame.serial === device?.serial),
    });
  });
  const recordState = (): Parameters<typeof AppMapEmptyState>[0]["recordState"] =>
    recordStateFromReadiness(liveDeviceReadiness());
  const canRecord = () =>
    recordState() === "ready" && Boolean(server.selectedLeaseId()) && !server.controlIssue();
  const livePanelStatus = () => {
    const device = selectedDevice();
    return appMapDeviceStatus({
      readiness: liveDeviceReadiness(),
      deviceSelected: Boolean(device),
      serverOnline: server.health() === "online",
      discovering: server.deviceDiscoveryStatus() === "scanning",
      recording: recorder.recording(),
      controlReady: Boolean(server.selectedLeaseId()),
      controlIssue: server.controlIssue(),
      controlTakeoverAvailable: server.canTakeControlOfSelectedDevice(),
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
  const canvasGrid = createMemo(() => canvasGridForScale(view().scale));
  const canvasGridVisual = createMemo(() => canvasGridPresentation(view(), canvasGrid()));
  const connections = createMemo(() => canvasConnections(tree(), draft.steps(), canvasState()));
  const [selectedNodeIds, setSelectedNodeIds] = createSignal<string[]>([]);
  const [selectedNodeId, setSelectedNodeIdValue] = createSignal<string | null>(null);
  const setSelectedNodeId = (id: string | null) => {
    setSelectedNodeIdValue(id);
    setSelectedNodeIds(id ? [id] : []);
  };
  const [screenInspectorOpen, setScreenInspectorOpen] = createSignal(false);
  const [selectedConnectionId, setSelectedConnectionId] = createSignal<string | null>(null);
  const [startCaptureBusy, setStartCaptureBusy] = createSignal(false);
  const [capturedScreenUrls, setCapturedScreenUrls] = createSignal<Record<string, string>>({});
  const [canvasScreenRotations, setCanvasScreenRotations] = createSignal<
    Record<string, CanvasScreenRotation>
  >({});

  const [renamingNodeId, setRenamingNodeId] = createSignal<string | null>(null);
  const [deviceCompanionOrientation, setDeviceCompanionOrientation] = createSignal<
    "portrait" | "landscape" | "square" | "unknown"
  >("unknown");
  const [waitingForRecordTarget, setWaitingForRecordTarget] = createSignal(false);
  const [canvasTool, setCanvasTool] = createSignal<"select" | "hand">("select");
  let pendingConnectionId: string | null = null;
  let recordingSourceScreenId: string | null = null;
  let recordRequestedAfterDeviceSelection = false;
  let deviceAutoOpenedForMap = "";
  let initiallyFittedAppMapId = "";
  const canvasHistory = createAppMapCanvasHistory<AppMapCanvasState, AppMapScreenRestoreSnapshot>();
  const positions = () => canvasState().positions;
  const positionFor = (node: MapTreeNode): CanvasPoint => positions()[node.id] ?? node;
  const resolvedPositions = createMemo(() =>
    Object.fromEntries(tree().nodes.map((node) => [node.id, positionFor(node)] as const)),
  );
  const orientationEvidenceForNode = (node: MapTreeNode) =>
    screenshotOrientationEvidence(server, draft.steps()[node.representativeStepIndex]) ||
    variantOrientationEvidence(activeAppMap(), node.id);
  const geometryForNode = (node: MapTreeNode): ScreenCardGeometry =>
    screenCardGeometry(orientationEvidenceForNode(node));
  const screenGeometries = createMemo<Record<string, ScreenCardGeometry>>(() =>
    Object.fromEntries(tree().nodes.map((node) => [node.id, geometryForNode(node)] as const)),
  );
  const autoConnectionLanes = createMemo(() =>
    connectorAutoLanes(
      connections(),
      (screenId) => {
        const node = tree().nodes.find((candidate) => candidate.id === screenId);
        return node ? positionFor(node) : undefined;
      },
      (screenId) => screenGeometries()[screenId],
    ),
  );
  const canvasGestures = useAppMapCanvasGestures({
    view,
    setView,
    canvasState,
    setCanvasState,
    screenIds: () => tree().nodes.map((node) => node.id),
    // Marquee hit-testing must use the same resolved positions as the scene.
    // Newly authored and auto-laid-out screens are not necessarily persisted
    // in canvasState.positions yet.
    positions: () => resolvedPositions(),
    geometries: () => screenGeometries(),
    grid: canvasGrid,
    selectedNodeIds,
    setSelectedNodeIds,
    setSelectedNodeId: setSelectedNodeIdValue,
    connectionGeometries: () =>
      connections().map((connection) => ({
        id: connection.id,
        geometry: canvasEdgeGeometry(
          {
            from: connection.fromScreenId,
            to: connection.toScreenId,
            kind: connection.kind,
            sourceAnchor: connection.sourceAnchor,
            sourceRotation: canvasScreenRotations()[connection.fromScreenId],
            presentation: connectorPresentationWithAutoLane(connection, autoConnectionLanes()),
            automaticSourceLane: connectorHasAutomaticSourceLane(connection, autoConnectionLanes()),
          },
          tree().nodes,
          positionFor,
          undefined,
          geometryForNode,
        ),
      })),
    setSelectedConnectionId,
    clearSecondarySelection: () => {
      setSelectedConnectionId(null);
      setScreenInspectorOpen(false);
    },
    onSelectionSettled: (ids) => setScreenInspectorOpen(Boolean(selectionDetailsScreenId(ids))),
    onCommitNodeDrag: (before) =>
      persistMetadata(withCanvasGraph(canvasState(), graph()), { before }),
    onCommitNoteDrag: (before) => persistNotes(canvasState().notes ?? [], before),
  });

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
  const openLiveDevice = () => {
    if (!captureOpen()) server.resetLivePreview();
    openCapturePanel();
    const serial = server.selectedDevice();
    if (serial) void server.setSelectedDevice(serial);
  };

  const reviewingTake = () => recorder.take()?.state === "review";
  const {
    loadedAppMapId,
    loadState: appMapLoadState,
    loadFailure: currentLoadFailure,
    retry: retryAppMapLoad,
  } = useAppMapDocumentProjection({
    canvasState,
    setCanvasState,
    onDocumentReset: () => {
      deviceAutoOpenedForMap = "";
      setSelectedNodeId(null);
      setScreenInspectorOpen(false);
      setSelectedConnectionId(null);
      setCapturedScreenUrls({});
      setCanvasScreenRotations({});
      setRenamingNodeId(null);
      setContextSurface(null);
      setCaptureOpen(false);
      canvasHistory.clear();
    },
    onCanonicalProjectionChange: canvasHistory.clear,
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
    openLiveDevice();
  });
  // Recording starts from the navigator as well as from this workspace. The
  // drawer must follow that state so a fresh map never appears to be an
  // empty graph while it is already capturing real work.
  createEffect(() => {
    if (recorder.recording() || recorder.take()) openLiveDevice();
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
    openLiveDevice();
    void recorder.enterRecordMode();
  });
  const titleFor = (node: MapTreeNode) =>
    canvasState().screenTitles?.[node.id]?.trim() || node.title;
  const titleForScreen = (screenId: string) => {
    const node = tree().nodes.find((candidate) => candidate.id === screenId);
    return node ? titleFor(node) : "Untitled screen";
  };
  const hasCanvasContent = () => hasMap() || (canvasState().notes?.length ?? 0) > 0;
  const liveLocation = createMemo(() =>
    matchLiveScreen(Object.values(activeAppMap()?.screens ?? {}), [
      server.snapshot()?.screenIdentity?.fingerprint,
      server.liveFrame()?.visualFingerprint,
      server.liveFrame()?.fingerprint,
    ]),
  );
  const expectedApplicationId = createMemo(() =>
    expectedAndroidApplicationId(Object.values(activeAppMap()?.screenVariants ?? {})),
  );
  const liveApplicationId = createMemo(
    () => server.snapshot()?.foregroundApp ?? server.snapshot()?.treeApp,
  );
  const liveDeviceOutsideMapApp = createMemo(() => {
    const expected = expectedApplicationId();
    const actual = liveApplicationId();
    return Boolean(expected && actual && !applicationIdsMatch(expected, actual));
  });
  const liveDeviceUnmapped = createMemo(
    () =>
      !liveDeviceOutsideMapApp() &&
      liveLocation().kind === "unknown" &&
      Boolean(selectedDevice()) &&
      Boolean(server.liveFrame()?.base64) &&
      !server.controlIssue(),
  );
  const hereScreenId = createMemo(() => {
    const location = liveLocation();
    return location.kind === "here" ? location.screenId : null;
  });
  const hereScreenTitle = createMemo(() => {
    const id = hereScreenId();
    const node = id ? tree().nodes.find((candidate) => candidate.id === id) : undefined;
    return node ? titleFor(node) : undefined;
  });
  const combineCards = createMemo(() => {
    const map = activeAppMap();
    if (!map) return [];
    return canvasCombineCards(
      map,
      (screenId) => {
        const node = tree().nodes.find((candidate) => candidate.id === screenId);
        return node ? { position: positionFor(node), title: titleFor(node) } : undefined;
      },
      server.jobs(),
    );
  });
  const selectedNode = createMemo(
    () => tree().nodes.find((node) => node.id === selectedNodeId()) ?? null,
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
  const runReadinessSteps = createMemo(() =>
    recipeStepsForRunReadiness(draft.steps(), activeAppMap()?.connections),
  );
  const baseGraphRunReadiness = createMemo(() =>
    appMapRunReadiness({
      graph: graph(),
      recipeSteps: runReadinessSteps(),
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
  const { runCanvasGraph } = useAppMapRunFlow({
    activeAppMap,
    runnableFlow,
    transitionPath: () => graphRunReadiness().transitionPath,
    onRunStarting: openLiveDevice,
  });
  const runTargetForScreen = (screenId: string) => {
    return appMapRunTarget({
      appMap: activeAppMap(),
      graph: graph(),
      recipeSteps: runReadinessSteps(),
      selection: { screenId },
    });
  };
  const reusableBehaviors = createMemo(() => listReusableBehaviors(activeAppMap()));
  const bounds = createMemo(() =>
    canvasBounds(
      tree().nodes,
      canvasState().notes ?? [],
      positionFor,
      combineCards().map((card) => ({
        ...card.position,
        width: CANVAS_COMBINE_CARD_WIDTH,
        height: CANVAS_COMBINE_CARD_HEIGHT,
      })),
    ),
  );
  const usableCanvasClientSize = () => {
    const observed = canvasGestures.canvasClientSize();
    const element = canvasGestures.canvasElement();
    // ResizeObserver can report the mount-time zero size before a hidden
    // workspace becomes visible. Actions such as Fit must use the current DOM
    // box rather than remaining pinned to that stale first observation.
    const client = {
      width: element?.clientWidth || observed.width,
      height: element?.clientHeight || observed.height,
    };
    // Read these signals so orientation/opening changes recompute even when
    // the outer canvas itself did not resize.
    deviceCompanionOrientation();
    const reservesRightSide =
      window.innerWidth > 900 && ((captureOpen() && Boolean(selectedDevice())) || agentOpen());
    if (!reservesRightSide) return client;
    const panel = element
      ?.closest(".app-map-canvas")
      ?.querySelector<HTMLElement>(".ui-device-companion, [aria-label='Map with AI']");
    const reservedWidth = (panel?.getBoundingClientRect().width ?? 376) + 32;
    return { width: Math.max(320, client.width - reservedWidth), height: client.height };
  };
  const minimapNodes = createMemo(() =>
    buildMinimapNodes({
      nodes: tree().nodes,
      notes: canvasState().notes ?? [],
      matrices: combineCards().map((card) => ({ id: card.id, position: card.position })),
      bounds: bounds(),
      positionFor,
      selectedNodeIds: selectedNodeIds(),
      screenStates: Object.fromEntries(
        Object.entries(runProjection().screens).map(([id, screen]) => [id, screen.state]),
      ),
    }),
  );
  const minimapEdges = createMemo(() =>
    buildMinimapEdges({
      nodes: tree().nodes,
      connections: connections(),
      positionFor,
      geometryForNode,
      sourceRotationFor: (screenId) => canvasScreenRotations()[screenId] ?? "none",
      viewportScale: view().scale,
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
    minimapViewportBounds(view(), usableCanvasClientSize(), bounds()),
  );
  const presenceGeometry = createMemo(() =>
    buildPresenceGeometry({
      nodes: tree().nodes,
      connections: connections(),
      positionFor,
      geometryForNode,
      sourceRotationFor: (screenId) => canvasScreenRotations()[screenId] ?? "none",
      viewportScale: view().scale,
    }),
  );
  const { remoteAwareness } = useAppMapPresence({
    recording: () => recorder.recording(),
  });

  const fit = () => {
    const element = canvasGestures.canvasElement();
    if (!element || !hasCanvasContent()) return;
    setView(fitCanvasViewport(usableCanvasClientSize(), bounds()));
  };

  const openAtReadableScale = () => {
    const element = canvasGestures.canvasElement();
    if (!element || !hasCanvasContent()) return;
    setView(openCanvasViewport(usableCanvasClientSize(), bounds()));
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
    if (canvasGestures.nodeSelectionSuppressed()) return;
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
    setSelectedConnectionId(null);
    // Selection is the entry point to object properties; closing Details keeps selection.
    setScreenInspectorOpen(!event?.shiftKey);
    setRenamingNodeId(null);
    if (node.representativeStepIndex >= 0) selectStep(node.representativeStepIndex);
  };
  const zoom = (delta: number, clientPoint?: CanvasPoint) => {
    const element = canvasGestures.canvasElement();
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
    const element = canvasGestures.canvasElement();
    const node = tree().nodes.find((candidate) => candidate.id === screenId);
    if (!element || !node) return;
    const position = positionFor(node);
    const scale = Math.max(view().scale, 0.72);
    const client = usableCanvasClientSize();
    setView({
      scale,
      x: client.width / 2 - (position.x + SCREEN_CARD_WIDTH / 2) * scale,
      y: client.height / 2 - (position.y + SCREEN_CARD_HEIGHT / 2) * scale,
    });
    requestAnimationFrame(() => {
      const card = Array.from(
        element.querySelectorAll<HTMLElement>("[data-app-map-screen-id]"),
      ).find((candidate) => candidate.dataset.appMapScreenId === screenId);
      card?.focus({ preventScroll: true });
    });
  };
  const visibleCanvasBounds = createMemo(() =>
    visibleCanvasBoundsFromViewport({
      viewport: view(),
      client: canvasGestures.canvasClientSize(),
    }),
  );
  function persistAppMapCanvas(
    value: AppMapCanvasState,
    previous?: AppMapCanvasState,
    variantsByScreen?: Readonly<Record<string, readonly ScreenVariant[]>>,
    restore?: AppMapScreenRestoreSnapshot,
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
          ...(restore ? { restore } : {}),
        });
        const removals = previous ? canvasRemovalChanges(previous, value, appMap) : [];
        const noteChanges = noteChangesFor(value.notes ?? [], appMap, previous?.notes ?? []);
        const changes = orderCanvasChanges([...projectedChanges, ...removals, ...noteChanges]);
        if (!changes.length) return;
        appMap = (
          await server.runAction("app-map.commit", {
            appMapId,
            expectedRevision: appMap.revision,
            summary: appMapCommitSummary({ appMap, changes }),
            changes,
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
        toast(error instanceof Error ? error.message : "The map could not be saved", "warning");
      });
  }
  const persistMetadata = (
    value: AppMapCanvasState,
    options: {
      before?: AppMapCanvasState;
      recordHistory?: boolean;
      variantsByScreen?: Readonly<Record<string, readonly ScreenVariant[]>>;
      restore?: AppMapScreenRestoreSnapshot;
    } = {},
  ) => {
    if (!server.selectedAppMapId()) return;
    const before = structuredClone(options.before ?? canvasState());
    const canvasChanged = JSON.stringify(before) !== JSON.stringify(value);
    const hasVariantEvidence = Object.values(options.variantsByScreen ?? {}).some(
      (variants) => variants.length > 0,
    );
    if (!canvasChanged && !hasVariantEvidence) return;
    const restore =
      options.restore ??
      (() => {
        const appMap = activeAppMap();
        if (!appMap) return undefined;
        const removedScreenIds = canvasRemovalChanges(before, value, appMap).flatMap((change) =>
          change.kind === "screen.remove" ? [change.screenId] : [],
        );
        return screenRestoreSnapshotFor(appMap, removedScreenIds);
      })();
    if (canvasChanged && options.recordHistory !== false) {
      canvasHistory.record({
        before,
        after: structuredClone(value),
        at: Date.now(),
        ...(restore ? { restore } : {}),
      });
    }
    if (canvasChanged) setCanvasState(value);
    persistAppMapCanvas(value, before, options.variantsByScreen, options.restore);
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
  const tidyMap = () => {
    // The canvas may display a raw iPad capture in a rotated orientation.
    // Pass that same presentation transform into the pure layout pass so
    // sibling reading order follows what the user sees, not raw image axes.
    const screenRotations = canvasScreenRotations();
    const arranged = compactCanvasPositions(graph(), {
      sourceRotationFor: (screenId) => screenRotations[screenId] ?? "none",
    });
    if (!Object.keys(arranged).length) return;
    persistMetadata({ ...canvasState(), positions: arranged });
    requestAnimationFrame(fit);
    toast("Map tidied", "success");
  };
  onMount(() => {
    const unbind = bindAppMapWorkspaceShellEvents({
      onChooseTargetSet: chooseTargetSet,
      onTidyMap: tidyMap,
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
      toast("Start screen saved · record a path or capture more screenshots", "success");
      return true;
    } finally {
      setStartCaptureBusy(false);
    }
  };
  const captureCurrentScreen = async () => {
    if (startCaptureBusy()) return;
    if (!targetIsReady(selectedDevice(), server.health() === "online")) {
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
      const node = buildCanvasGraphTree(
        next.graph ?? graph(),
        draft.steps(),
        next.groups ?? groups(),
      ).nodes.find((candidate) => candidate.id === captured.screen.id);
      if (node) selectNode(node);
      toast(captured.created ? "Screen saved to the map" : "Screenshot refreshed", "success");
    } finally {
      setStartCaptureBusy(false);
    }
  };
  const addNote = () => {
    const element = canvasGestures.canvasElement();
    const note = createCanvasNote({
      viewport: view(),
      clientWidth: element?.clientWidth,
      clientHeight: element?.clientHeight,
      grid: canvasGrid(),
    });
    persistNotes([...(canvasState().notes ?? []), note]);
  };
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
        openLiveDevice();
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
    openLiveDevice();
    void recorder.enterRecordMode();
    // Keep the graph visible: the device is already alongside it, and a new
    // action will appear on the selected screen as soon as it is captured.
  };
  const recordFromHere = () => {
    const liveScreenId = hereScreenId();
    const liveNode = liveScreenId
      ? (tree().nodes.find((node) => node.id === liveScreenId) ?? null)
      : null;
    if (liveNode) {
      selectNode(liveNode);
      recordFromNode(liveNode);
      return;
    }
    recordFromNode(selectedNode());
  };
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
  const { removeConnection, removeScreen, renameScreen } = useAppMapGraphEdits({
    canvasState,
    graph,
    titleFor,
    persistMetadata,
    setSelectedConnectionId,
    setSelectedNodeId,
    setScreenInspectorOpen,
    setRenamingNodeId,
  });
  const undo = () => {
    const entry = canvasHistory.undo();
    if (!entry) {
      draft.undo();
      return;
    }
    persistMetadata(structuredClone(entry.before), {
      before: canvasState(),
      recordHistory: false,
      ...(entry.restore ? { restore: entry.restore } : {}),
    });
  };
  const redo = () => {
    const entry = canvasHistory.redo();
    if (!entry) {
      draft.redo();
      return;
    }
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
      else openLiveDevice();
    },
    onOpenDevicePanel: () => {
      setHistoryOpen(false);
      openLiveDevice();
    },
    onCloseDevicePanel: closeCapturePanel,
    onRunMap: runCanvasGraph,
    onUndoRequest: (event, shouldRedo) => {
      const canUndo = canvasHistory.depth().undo > 0 || draft.canUndo();
      const canRedo = canvasHistory.depth().redo > 0 || draft.canRedo();
      if (shouldRedo ? !canRedo : !canUndo) return;
      event.preventDefault();
      if (shouldRedo) redo();
      else undo();
    },
    onToolChange: setCanvasTool,
    onCaptureScreen: () => void captureCurrentScreen(),
    onAddNote: addNote,
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
      else if (hereScreenId() || selectedNode()) recordFromHere();
      else toast("Select a screen or path to record", "info");
    },
    onDeleteSelection: () => {
      const connection = selectedConnection();
      if (connection) {
        removeConnection(connection);
        return;
      }
      const node = selectedNode();
      if (node) removeScreen(node);
    },
    onEscape: () => {
      if (canvasGestures.cancelMarquee()) return;
      if (contextSurface()) {
        setContextSurface(null);
        return;
      }
      setSelectedNodeId(null);
      setScreenInspectorOpen(false);
      setSelectedConnectionId(null);
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
      style={{
        "--app-map-device-panel-width":
          deviceCompanionOrientation() === "landscape"
            ? "clamp(420px, 36vw, 560px)"
            : "clamp(340px, 28vw, 400px)",
        "--app-map-side-panel-reserve":
          captureOpen() && selectedDevice()
            ? "calc(var(--app-map-device-panel-width) + 32px)"
            : agentOpen()
              ? "408px"
              : "16px",
      }}
      aria-busy={appMapLoadState().status === "loading"}
    >
      <Show when={appMapLoadState().status === "ready" && !reviewingTake()}>
        <section
          ref={canvasGestures.observeCanvas}
          class={cn(
            "relative isolate flex min-h-0 min-w-0 select-none overflow-hidden",
            workspaceView() === "map" && "touch-none",
            canvasTool() === "hand" ? "cursor-grab active:cursor-grabbing" : "cursor-default",
          )}
          aria-label="Map"
          onWheel={(event) => {
            const target = event.target as HTMLElement;
            if (
              !canvasOwnsWheel({
                workspaceView: workspaceView(),
                hasCanvasContent: hasCanvasContent(),
                insideOverlay: Boolean(
                  target.closest("aside, [role='dialog'], [data-app-map-native-scroll]"),
                ),
              })
            )
              return;
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
              "[data-app-map-screen-id], aside, button, input, textarea",
            );
            const wantsPan = canvasTool() === "hand" || event.button === 1;
            if (hasCanvasContent() && wantsPan && !target.closest("button")) {
              canvasGestures.beginPan(event.clientX, event.clientY);
              event.currentTarget.setPointerCapture(event.pointerId);
              return;
            }
            if (!hasCanvasContent() || !isCanvasBackground || event.button !== 0) return;
            canvasGestures.beginMarquee(event);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) =>
            canvasGestures.schedulePointerMove(event.clientX, event.clientY)
          }
          onPointerUp={canvasGestures.finishPointer}
          onPointerCancel={canvasGestures.cancelPointer}
        >
          <div
            class="app-map-grid pointer-events-none absolute inset-0"
            aria-hidden="true"
            style={{
              "--app-map-grid-size": `${canvasGridVisual().screenSpacing}px`,
              "--app-map-grid-offset-x": `${canvasGridVisual().offset.x}px`,
              "--app-map-grid-offset-y": `${canvasGridVisual().offset.y}px`,
            }}
          />
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
            }}
            onOpenProposals={() => setProposalReviewOpen(true)}
          />
          <Show when={proposalReviewOpen() && activeAppMap()}>
            {(appMap) => (
              <AppMapProposalReview
                appMap={appMap()}
                proposals={pendingProposals()}
                busyId={proposalBusyId()}
                error={proposalError()}
                evidenceUrl={(uri) => server.authoringEvidenceUrl(uri, "image/png")}
                onApprove={(proposalId) => void decideProposal(proposalId, "approve")}
                onReject={(proposalId) => void decideProposal(proposalId, "reject")}
                onRequestChanges={(proposalId, reason) =>
                  void decideProposal(proposalId, "reject", reason)
                }
                onClose={() => setProposalReviewOpen(false)}
              />
            )}
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
                  document.querySelector<HTMLButtonElement>('[aria-label="Map with AI"]')?.focus(),
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
                    onToggleDevice={() => (captureOpen() ? closeCapturePanel() : openLiveDevice())}
                    onCaptureScreen={() => void captureCurrentScreen()}
                    onOpenAgent={() => {
                      closeCapturePanel();
                      setHistoryOpen(false);
                      setAgentOpen(true);
                    }}
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
                  onAddNote={addNote}
                  onToggleDevice={() => (captureOpen() ? closeCapturePanel() : openLiveDevice())}
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
                <Show when={canvasGestures.marqueeRect()}>
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
                <For each={canvasGestures.snapGuides()}>
                  {(guide) => {
                    const vertical =
                      guide.kind === "alignment" ? guide.axis === "x" : guide.axis === "y";
                    const segments = guide.segments ?? [guide];
                    const positions = guide.parallelPositions ?? [guide.position];
                    const lines = positions.flatMap((position) =>
                      segments.map((segment) => ({ position, segment })),
                    );
                    const hairline = 1 / view().scale;
                    const capLength = 5 / view().scale;
                    return (
                      <For each={lines}>
                        {({ position, segment }) => {
                          const length = Math.max(hairline, segment.end - segment.start);
                          const spacing = guide.kind === "spacing";
                          return (
                            <div class="contents" aria-hidden="true">
                              <div
                                class="pointer-events-none absolute z-[49] bg-[var(--text-interactive-base)]"
                                data-app-map-snap-guide={guide.kind}
                                style={
                                  vertical
                                    ? {
                                        left: `${position}px`,
                                        top: `${segment.start}px`,
                                        width: `${hairline}px`,
                                        height: `${length}px`,
                                      }
                                    : {
                                        left: `${segment.start}px`,
                                        top: `${position}px`,
                                        width: `${length}px`,
                                        height: `${hairline}px`,
                                      }
                                }
                              />
                              <Show when={spacing}>
                                <For each={[segment.start, segment.end]}>
                                  {(endpoint) => (
                                    <div
                                      class="pointer-events-none absolute z-[49] bg-[var(--text-interactive-base)]"
                                      data-app-map-snap-cap
                                      style={
                                        vertical
                                          ? {
                                              left: `${position - capLength / 2}px`,
                                              top: `${endpoint}px`,
                                              width: `${capLength}px`,
                                              height: `${hairline}px`,
                                            }
                                          : {
                                              left: `${endpoint}px`,
                                              top: `${position - capLength / 2}px`,
                                              width: `${hairline}px`,
                                              height: `${capLength}px`,
                                            }
                                      }
                                    />
                                  )}
                                </For>
                              </Show>
                            </div>
                          );
                        }}
                      </For>
                    );
                  }}
                </For>
                <AppMapCanvasScene
                  nodes={tree().nodes}
                  connections={connections()}
                  notes={canvasState().notes ?? []}
                  width={bounds().width}
                  height={bounds().height}
                  viewportScale={view().scale}
                  visibleBounds={visibleCanvasBounds()}
                  selectedNodeId={selectedNodeId()}
                  selectedNodeIds={selectedNodeIds()}
                  selectedConnectionId={selectedConnectionId()}
                  renamingNodeId={renamingNodeId()}
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
                  orientationEvidenceFor={orientationEvidenceForNode}
                  onScreenRotationChange={(nodeId, rotation) =>
                    setCanvasScreenRotations((current) =>
                      current[nodeId] === rotation ? current : { ...current, [nodeId]: rotation },
                    )
                  }
                  isFlowStart={(node) => graph().flows.some((flow) => flow.screenId === node.id)}
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
                  connectionLabelMode={(connection) =>
                    connectionLabelMode(
                      connection,
                      activeAppMap()?.connections[connection.id]
                        ? connectionStepsFromActions(
                            activeAppMap()!.connections[connection.id]!.actions,
                          )
                        : draft.steps(),
                    )
                  }
                  onSelectNode={selectNode}
                  onSelectConnection={(connection) => {
                    setSelectedConnectionId(connection.id);
                    setSelectedNodeId(null);
                    setScreenInspectorOpen(false);
                  }}
                  onChangeConnectionPresentation={(connection, presentation) => {
                    const next = structuredClone(graph());
                    const transition = next.transitions.find((item) => item.id === connection.id);
                    if (!transition) return;
                    if (presentation && Object.keys(presentation).length) {
                      transition.presentation = structuredClone(
                        presentation as ConnectionPresentation,
                      );
                    } else {
                      delete transition.presentation;
                    }
                    transition.updatedAt = Date.now();
                    persistMetadata(withCanvasGraph(canvasState(), next));
                  }}
                  onRenameNode={(node) => setRenamingNodeId(node.id)}
                  onOpenNodeDetails={(node) => {
                    selectNode(node);
                    setScreenInspectorOpen(true);
                  }}
                  canRunToScreen={(screenId) => Boolean(runTargetForScreen(screenId))}
                  onRunToScreen={(node) => {
                    const target = runTargetForScreen(node.id);
                    if (!target) return;
                    selectNode(node);
                    setScreenInspectorOpen(false);
                    void runCanvasGraph({
                      ...target,
                      title: `Run to ${titleFor(node)}`,
                    });
                  }}
                  onCommitNodeRename={renameScreen}
                  onNodePointerDown={(event, node) => {
                    if (event.button !== 0) return;
                    if (canvasTool() === "hand") {
                      event.stopPropagation();
                      canvasGestures.beginPan(event.clientX, event.clientY);
                      canvasGestures.canvasElement()?.setPointerCapture(event.pointerId);
                      return;
                    }
                    event.stopPropagation();
                    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
                    const alreadySelected = selectedNodeIds().includes(node.id);
                    if (!alreadySelected) selectNode(node);
                    else if (selectedNodeIds().length === 1) setScreenInspectorOpen(true);
                    const ids = alreadySelected ? selectedNodeIds() : [node.id];
                    canvasGestures.beginNodeDrag({
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
                    });
                  }}
                  onNudgeNode={(node, direction, coarse) => {
                    const ids = selectedNodeIds().includes(node.id) ? selectedNodeIds() : [node.id];
                    const before = structuredClone(canvasState());
                    const step = canvasGrid().spacing * (coarse ? 5 : 1);
                    const nextPositions = Object.fromEntries(
                      ids.flatMap((id) => {
                        const member = tree().nodes.find((candidate) => candidate.id === id);
                        if (!member) return [];
                        const position = positionFor(member);
                        return [
                          [
                            id,
                            snapCanvasPointToGrid(
                              {
                                x: position.x + direction.x * step,
                                y: position.y + direction.y * step,
                              },
                              canvasGrid(),
                            ),
                          ] as const,
                        ];
                      }),
                    );
                    if (!Object.keys(nextPositions).length) return;
                    setSelectedNodeIds(ids);
                    setSelectedNodeIdValue(node.id);
                    setSelectedConnectionId(null);
                    persistMetadata(
                      withCanvasGraph(
                        {
                          ...canvasState(),
                          positions: { ...canvasState().positions, ...nextPositions },
                        },
                        graph(),
                      ),
                      { before },
                    );
                  }}
                  onNotePointerDown={(event, note) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
                    canvasGestures.beginNoteDrag({
                      id: note.id,
                      x: event.clientX,
                      y: event.clientY,
                      origin: { x: note.x, y: note.y },
                    });
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
                  hereScreenId={hereScreenId()}
                  combines={combineCards()}
                  onOpenCombine={(combineId, section) => props.onOpenCombine?.(combineId, section)}
                  onOpenCombineResults={(jobId) =>
                    window.dispatchEvent(
                      new CustomEvent("relay:open-run-history", { detail: { jobId } }),
                    )
                  }
                />
              </div>
              <Show when={!captureOpen()}>
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
                          ? graph().flows.some((flow) => flow.screenId === selectedNode()!.id)
                          : false
                      }
                      connections={connections().filter(
                        (connection) => connection.fromScreenId === selectedNode()?.id,
                      )}
                      titleForScreen={titleForScreen}
                      flowSetup={selectedFlowSetup()}
                      onFlowSetup={(routineId) => void setSelectedFlowSetup(routineId)}
                      onSelectConnection={(connection) => {
                        setSelectedConnectionId(connection.id);
                        setSelectedNodeId(null);
                        setScreenInspectorOpen(false);
                      }}
                      onRename={() => {
                        const node = selectedNode();
                        if (!node) return;
                        setScreenInspectorOpen(false);
                        setRenamingNodeId(node.id);
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
              </Show>
              <AppMapToolbar
                tool={canvasTool()}
                deviceOpen={captureOpen()}
                shiftForDevice={Boolean((captureOpen() && selectedDevice()) || agentOpen())}
                wideDevice={deviceCompanionOrientation() === "landscape"}
                explorationState={agentExploration.state()}
                explorationCount={agentExploration.workers().length}
                onToolChange={setCanvasTool}
                onAddNote={addNote}
                onExplore={() => {
                  closeCapturePanel();
                  setHistoryOpen(false);
                  setAgentOpen(true);
                }}
                onToggleDevice={() => (captureOpen() ? closeCapturePanel() : openLiveDevice())}
              />
              <AppMapMinimap
                scale={view().scale}
                groups={[]}
                nodes={minimapNodes()}
                edges={minimapEdges()}
                bounds={bounds()}
                viewport={minimapViewport()}
                shiftForSidePanel={Boolean((captureOpen() && selectedDevice()) || agentOpen())}
                wideDevice={deviceCompanionOrientation() === "landscape"}
                onZoomOut={() => zoom(-0.1)}
                onZoomIn={() => zoom(0.1)}
                onFit={fit}
                onNavigate={(ratio) => {
                  const element = canvasGestures.canvasElement();
                  if (!element) return;
                  setView((current) =>
                    centerCanvasViewport(
                      current,
                      usableCanvasClientSize(),
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
          status={
            liveDeviceOutsideMapApp()
              ? {
                  label: "Outside this map",
                  kind: "attention",
                  detail: `Return to ${activeAppMap()?.name ?? "the mapped app"} before capturing.`,
                }
              : liveDeviceUnmapped() && livePanelStatus().kind === "ready"
                ? {
                    label: "Not saved to map",
                    kind: "info",
                    detail: `Choose Save screen to add it to ${activeAppMap()?.name ?? "this map"}.`,
                  }
                : livePanelStatus()
          }
          unmapped={liveDeviceUnmapped()}
          outsideMapApp={liveDeviceOutsideMapApp()}
          mappedScreenName={hereScreenTitle()}
          captureBusy={startCaptureBusy()}
          canRecord={canRecord()}
          mapName={activeAppMap()?.name}
          captureContextLabel={captureContextLabel()}
          liveRun={liveRunPresentation()}
          onOpenRun={() => {
            const job = liveRunJob();
            if (!job) return;
            window.dispatchEvent(
              new CustomEvent("relay:open-run-history", { detail: { jobId: job.id } }),
            );
          }}
          onClose={closeCapturePanel}
          onOpenTargets={props.onOpenTargets}
          onSaveScreen={() => void captureCurrentScreen()}
          onSurveyPage={() => void server.captureScrollablePage()}
          onRecord={recordFromHere}
          onOrientation={setDeviceCompanionOrientation}
        />
      </Show>
      <Show when={appMapLoadState().status !== "ready"}>
        <AppMapLoadFeedback
          status={currentLoadFailure() ? "error" : "loading"}
          failure={currentLoadFailure()}
          onRetry={retryAppMapLoad}
        />
      </Show>
    </section>
  );
}
