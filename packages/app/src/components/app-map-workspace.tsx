import { Show, createEffect, createMemo, createSignal } from "solid-js";
import type { AppMapCanvasState, ConnectionPresentation } from "@relay/protocol";
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
import { EMPTY_APP_MAP_CANVAS_STATE } from "../lib/app-map-canvas-state";
import {
  canvasEdgeGeometry,
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
import { selectionDetailsScreenId } from "../lib/app-map-selection";
import { projectAppMapRun } from "../lib/app-map-run-projection";
import { AppMapEmptyState } from "./app-map-capture-review";
import { ConnectionInspector, ScreenInspector } from "./app-map-canvas-primitives";
import { AppMapDeviceCompanionMount } from "./app-map-device-companion-mount";
import { AppMapOverviewToolbar, AppMapToolbar, type AppMapWorkspaceView } from "./app-map-toolbar";
import { AppMapMinimap } from "./app-map-minimap";
import { AppMapBrowseView } from "./app-map-browse-view";
import {
  connectionStepsFromActions,
  type AppMapScreenRestoreSnapshot,
} from "../lib/app-map-projection";
import { caseStackCount } from "../lib/case-stack-presentation";
import { AppMapCanvasScene } from "./app-map-canvas-scene";
import { AppMapTakeReviewMount } from "./app-map-take-review-mount";
import { useAppMapCapturePanel } from "../lib/use-app-map-capture-panel";
import { useAppMapCaseStack } from "../lib/use-app-map-case-stack";
import { useAppMapConnectionBehaviors } from "../lib/use-app-map-connection-behaviors";
import { useAppMapFlowSetup } from "../lib/use-app-map-flow-setup";
import {
  connectionPathTitle,
  recordedActionFromConnection,
  entryFlowsForScreen,
  listReusableBehaviors,
  selectedFlowSetupSummary,
  stepsForConnectionIds,
} from "../lib/app-map-workspace-helpers";
import { createAppMapCanvasHistory } from "../lib/app-map-canvas-history";
import { useAppMapDocumentProjection } from "../lib/use-app-map-document-projection";
import { useAppMapGraphEdits } from "../lib/use-app-map-graph-edits";
import { useAppMapTransitionReplay } from "../lib/use-app-map-transition-replay";
import { useAppMapPresence } from "../lib/use-app-map-presence";
import { canvasCombineCards, type CanvasCombineSection } from "../lib/app-map-combine-canvas";
import {
  screenshotOrientationEvidence,
  screenshotUrl,
  variantOrientationEvidence,
  variantScreenshotUrl,
  variantScrollSurface,
} from "../lib/app-map-workspace-media";
import { AppMapLoadFeedback } from "./app-map-load-feedback";
import { connectionActionSummaries } from "../lib/connection-action-presentation";
import { useAppMapCanvasGestures } from "./use-app-map-canvas-gestures";
import { AppMapCanvasViewport, AppMapCanvasWorld } from "./app-map-canvas-viewport";
import { useAppMapCanvasPersistence } from "../lib/use-app-map-canvas-persistence";
import { useAppMapLiveDevice } from "../lib/use-app-map-live-device";
import { useAppMapCanvasPresentation } from "../lib/use-app-map-canvas-presentation";
import { useAppMapContextPanels } from "./use-app-map-context-panels";
import { useAppMapCaptureActions } from "../lib/use-app-map-capture-actions";
import { useAppMapWorkspaceEvents } from "../lib/use-app-map-workspace-events";
import { useAppMapWorkspaceShell } from "../lib/use-app-map-workspace-shell";
import { useAppMapWorkspaceRun } from "../lib/use-app-map-workspace-run";

type AppMapContextSurface = "agent" | "history" | "proposals" | null;

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
  const [canvasState, setCanvasState] = createSignal<AppMapCanvasState>(EMPTY_APP_MAP_CANVAS_STATE);
  const [workspaceView, setWorkspaceView] = createSignal<AppMapWorkspaceView>("map");
  const [contextSurface, setContextSurface] = createSignal<AppMapContextSurface>(null);
  const graph = createMemo(() => ensureCanvasGraph(canvasState(), draft.steps()));
  const groups = () => canvasState().groups ?? [];
  const activeFlow = createMemo(() => graph().flows[0] ?? null);
  const activeAppMap = createMemo(() =>
    server.appMaps().find((candidate) => candidate.id === server.selectedAppMapId()),
  );
  const tree = createMemo(() => buildCanvasGraphTree(graph(), draft.steps(), groups()));
  const hasMap = () => tree().nodes.length > 0;
  const {
    selectedDevice,
    recordState,
    canRecord,
    panelStatus: livePanelStatus,
    screenSrc: liveScreenSrc,
    liveRunJob,
    liveRunPresentation,
    outsideMapApp: liveDeviceOutsideMapApp,
    unmapped: liveDeviceUnmapped,
    hereScreenId,
  } = useAppMapLiveDevice(activeAppMap);
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
  const [capturedScreenUrls, setCapturedScreenUrls] = createSignal<Record<string, string>>({});
  const [canvasScreenRotations, setCanvasScreenRotations] = createSignal<
    Record<string, CanvasScreenRotation>
  >({});

  const [renamingNodeId, setRenamingNodeId] = createSignal<string | null>(null);
  const [deviceCompanionOrientation, setDeviceCompanionOrientation] = createSignal<
    "portrait" | "landscape" | "square" | "unknown"
  >("unknown");
  const [canvasTool, setCanvasTool] = createSignal<"select" | "hand">("select");
  let deviceAutoOpenedForMap = "";
  let initiallyFittedAppMapId = "";
  const canvasHistory = createAppMapCanvasHistory<AppMapCanvasState, AppMapScreenRestoreSnapshot>();
  const { persistMetadata, persistNotes, undo, redo } = useAppMapCanvasPersistence({
    canvasState,
    setCanvasState,
    graph,
    activeAppMap,
    history: canvasHistory,
  });
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
  const contextPanels = useAppMapContextPanels({
    activeAppMap,
    surface: contextSurface,
    setSurface: setContextSurface,
    openDevicePicker,
  });
  const {
    agentOpen,
    historyOpen,
    setAgentOpen,
    setHistoryOpen,
    setProposalReviewOpen,
    exploration: agentExploration,
    pendingProposals,
    Panels: ContextPanels,
  } = contextPanels;
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
  createEffect(() => {
    if (recorder.recording() || recorder.take()) openLiveDevice();
  });

  createEffect(() => {
    if (!props.navigatorOpen || recorder.recording()) return;
    deviceAutoOpenedForMap = "";
    setCaptureOpen(false);
  });

  const titleFor = (node: MapTreeNode) =>
    canvasState().screenTitles?.[node.id]?.trim() || node.title;
  const titleForScreen = (screenId: string) => {
    const node = tree().nodes.find((candidate) => candidate.id === screenId);
    return node ? titleFor(node) : "Untitled screen";
  };
  const hasCanvasContent = () => hasMap() || (canvasState().notes?.length ?? 0) > 0;
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
  const {
    runReadiness: graphRunReadiness,
    runCanvasGraph,
    runTargetForScreen,
  } = useAppMapWorkspaceRun({
    activeAppMap,
    graph,
    selectedNodeId,
    selectedConnectionId,
    onRunStarting: openLiveDevice,
  });
  const reusableBehaviors = createMemo(() => listReusableBehaviors(activeAppMap()));
  const canvasPresentation = useAppMapCanvasPresentation({
    view,
    setView,
    nodes: () => tree().nodes,
    notes: () => canvasState().notes ?? [],
    connections,
    combines: combineCards,
    positionFor,
    geometryForNode,
    rotations: canvasScreenRotations,
    selectedNodeIds,
    selectedConnectionId,
    screenStates: () =>
      Object.fromEntries(
        Object.entries(runProjection().screens).map(([id, screen]) => [id, screen.state]),
      ),
    transitionStates: () =>
      Object.fromEntries(
        Object.entries(runProjection().transitions).map(([id, transition]) => [
          id,
          transition.state,
        ]),
      ),
    gestures: canvasGestures,
    hasContent: hasCanvasContent,
    captureOpen,
    selectedDevicePresent: () => Boolean(selectedDevice()),
    agentOpen,
    companionOrientation: deviceCompanionOrientation,
  });
  const {
    bounds,
    minimapNodes,
    minimapEdges,
    minimapViewport,
    presenceGeometry,
    fit,
    openAtReadableScale,
    zoom,
    revealScreen,
    visibleBounds: visibleCanvasBounds,
  } = canvasPresentation;
  const { remoteAwareness } = useAppMapPresence({
    recording: () => recorder.recording(),
  });

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
  const captureActions = useAppMapCaptureActions({
    loadedAppMapId,
    graph,
    connections,
    treeNodes: () => tree().nodes,
    groups,
    titleFor,
    selectedNodeId,
    selectedNode,
    selectedDevice,
    hereScreenId,
    recordState,
    canvasState,
    setCanvasState,
    capturedScreenUrls,
    setCapturedScreenUrls,
    view,
    grid: canvasGrid,
    canvasElement: canvasGestures.canvasElement,
    persistNotes,
    selectNode,
    setSelectedNodeId,
    setSelectedConnectionId,
    setCaptureOpen,
    openDevicePicker,
    openLiveDevice,
  });
  const {
    busy: startCaptureBusy,
    captureCurrentScreen,
    useCurrentScreenAsStart,
    addNote,
    recordFromHere,
    recordConnection,
    captureContextLabel,
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
  } = captureActions;
  useAppMapWorkspaceShell({
    activeFlow,
    graph,
    canvasState,
    rotations: canvasScreenRotations,
    persistMetadata,
    fit,
    historyOpen,
    setHistoryOpen,
    setCaptureOpen,
    selectedAppMapId: server.selectedAppMapId,
    setWorkspaceView,
    setSelectedNodeId,
    revealScreen,
  });
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
  useAppMapWorkspaceEvents({
    captureOpen,
    runReadiness: graphRunReadiness,
    canvasTool,
    setCanvasTool,
    renamingScreen: () => Boolean(renamingNodeId()),
    hasContent: hasCanvasContent,
    selectedConnection,
    selectedNode,
    hereScreenId,
    contextSurfaceOpen: () => Boolean(contextSurface()),
    historyCanUndo: () => canvasHistory.depth().undo > 0,
    historyCanRedo: () => canvasHistory.depth().redo > 0,
    onDeviceSelected: captureActions.onDeviceSelected,
    onToggleDevice: () => {
      setHistoryOpen(false);
      if (captureOpen()) closeCapturePanel();
      else openLiveDevice();
    },
    onOpenDevice: () => {
      setHistoryOpen(false);
      openLiveDevice();
    },
    onCloseDevice: closeCapturePanel,
    onRun: runCanvasGraph,
    onUndo: undo,
    onRedo: redo,
    onCaptureScreen: () => void captureCurrentScreen(),
    onUseCurrentScreenAsStart: () => void useCurrentScreenAsStart(),
    onAddNote: addNote,
    onRecordFromHere: recordFromHere,
    onRecordConnection: recordConnection,
    onRemoveConnection: removeConnection,
    onRemoveScreen: removeScreen,
    onCancelMarquee: canvasGestures.cancelMarquee,
    onClearContextSurface: () => setContextSurface(null),
    onClearSelection: () => {
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
        <AppMapCanvasViewport
          observe={canvasGestures.observeCanvas}
          workspaceView={workspaceView()}
          tool={canvasTool()}
          hasContent={hasCanvasContent()}
          gridVisual={canvasGridVisual()}
          onZoom={zoom}
          onPan={(delta) =>
            setView((current) => ({
              ...current,
              x: current.x + delta.x,
              y: current.y + delta.y,
            }))
          }
          onBeginPan={(event) => canvasGestures.beginPan(event.clientX, event.clientY)}
          onBeginMarquee={canvasGestures.beginMarquee}
          onPointerMove={(event) =>
            canvasGestures.schedulePointerMove(event.clientX, event.clientY)
          }
          onPointerUp={canvasGestures.finishPointer}
          onPointerCancel={canvasGestures.cancelPointer}
        >
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
          <ContextPanels />
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
              <AppMapCanvasWorld
                view={view()}
                bounds={bounds()}
                marquee={canvasGestures.marqueeRect()}
                snapGuides={canvasGestures.snapGuides()}
              >
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
                  scrollSurfaceFor={(node) => {
                    const surface = variantScrollSurface(activeAppMap(), node.id);
                    return surface
                      ? {
                          viewportCount: surface.viewports.length,
                          complete: surface.status === "completed",
                        }
                      : undefined;
                  }}
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
              </AppMapCanvasWorld>
              <Show when={!captureOpen()}>
                <Show
                  when={selectedConnection()}
                  fallback={
                    <ScreenInspector
                      node={screenInspectorOpen() ? selectedNode() : null}
                      appMap={activeAppMap()}
                      title={selectedNode() ? titleFor(selectedNode()!) : ""}
                      image={
                        selectedNode()
                          ? screenshotUrl(
                              server,
                              draft.steps()[selectedNode()!.representativeStepIndex],
                            ) ||
                            capturedScreenUrls()[selectedNode()!.id] ||
                            variantScreenshotUrl(server, activeAppMap(), selectedNode()!.id)
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
                onNavigate={canvasPresentation.navigateMinimap}
              />
            </Show>
          </Show>
        </AppMapCanvasViewport>
      </Show>
      <Show when={appMapLoadState().status === "ready" && reviewingTake() && recorder.take()}>
        {(take) => (
          <AppMapTakeReviewMount
            selectedIndex={reviewStepIndex()}
            sourceTitle={
              graph().screens.find(
                (screen) =>
                  screen.id === (take().sourceScreenId ?? captureActions.recordingSourceScreenId()),
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
