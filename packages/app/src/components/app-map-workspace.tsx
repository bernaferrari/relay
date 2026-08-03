import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type {
  AppMap,
  AppMapBatchChange,
  CaseExpansionStrategy,
  CaseStack,
  CanvasNote,
  AppMapCanvasState,
  MapGroup,
  ScreenVariant,
} from "@relay/protocol";
import { useRecipeDraft } from "../context/recipe-draft";
import { useRecorder, type CapturedStartScreen } from "../context/recorder";
import { useServer, type RecipeStep } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { type MapTreeNode } from "../lib/app-map-tree";
import {
  addPlannedConnection,
  addPlannedScreenConnection,
  attachTransitionSteps,
  canvasConnections,
  removeAuthoredConnection,
  reviewTransition,
  type CanvasConnection,
} from "../lib/app-map-connection-draft";
import {
  addCanvasScreen,
  addCanvasStartScreen,
  buildCanvasGraphTree,
  ensureCanvasGraph,
  removeCanvasScreen,
  screenForObservation,
  type TakeDestination,
  withCanvasGraph,
} from "../lib/app-map-canvas-graph";
import { EMPTY_APP_MAP_CANVAS_STATE } from "../lib/app-map-canvas-state";
import {
  canvasBounds,
  canvasEdgeGeometry,
  clampCanvasScale,
  fitCanvasViewport,
  SCREEN_CARD_HEIGHT,
  SCREEN_CARD_WIDTH,
  type CanvasPoint,
  type CanvasViewport,
} from "../lib/app-map-canvas-layout";
import {
  centerCanvasViewport,
  minimapPoint,
  minimapViewportBounds,
  minimapWorldPoint,
} from "../lib/app-map-minimap";
import { zoomViewportAtPoint } from "../lib/viewport-zoom";
import { deviceReadiness } from "../lib/device-readiness";
import { projectAppMapRun } from "../lib/app-map-run-projection";
import { appMapRunReadiness } from "../lib/app-map-run-readiness";
import { replayTransitionSteps } from "../lib/transition-replay";
import { toast } from "../context/toast";
import { evidenceForStep } from "./take-step-presentation";
import { AppMapEmptyState } from "./app-map-capture-review";
import { ConnectionInspector, ScreenInspector } from "./app-map-canvas-primitives";
import { AppMapHistoryPanel } from "./app-map-history-panel";
import { appMapDeviceStatus } from "./device-status-label";
import { AppMapDeviceCompanion } from "./app-map-device-companion";
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
import { AppMapTakeReview } from "./app-map-take-review";
import { useAppMapAgentExploration } from "../lib/use-app-map-agent-exploration";
import {
  companionLogicalViewport,
  companionOrientationEdge,
} from "./app-map-device-companion-geometry";
import type { ScreenshotOrientationEvidence } from "./oriented-screenshot";
import { targetIsReady } from "../lib/target-presentation";
import { groupForScreen, groupsAfterScreenDrag, nextGroupName } from "../lib/app-map-groups";

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
  captureStartOnReady?: boolean;
  onCaptureStartHandled?: (success: boolean, appMapId: string) => void;
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
    const readiness = deviceReadiness(device, server.health() === "online", {
      ...(device?.platform === "ios" ? { appleSetup: server.appleDeviceSetup() } : {}),
      liveCaptureIssue: server.liveCaptureIssue(),
      recordingIssue: recorder.recordingIssue(),
      requireLiveScreen: true,
      liveScreenAvailable:
        Boolean(liveFrame?.base64) && (!liveFrame?.serial || liveFrame.serial === device?.serial),
    });
    if (readiness.kind === "choose-device") return "choose-device";
    if (readiness.kind === "device-unavailable") return "device-unavailable";
    if (readiness.kind === "ios-developer-mode-disabled") return "enable-developer-mode";
    if (readiness.kind === "ios-preparing") return "preparing-ios";
    if (readiness.kind === "screen-preparing") return "preparing-screen";
    if (readiness.kind === "checking-ios") return "checking-ios";
    if (readiness.kind === "setup-ios") return "setup-ios";
    if (readiness.kind === "capture-error") return "capture-error";
    return "ready";
  };
  const canRecord = () => recordState() === "ready";
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
  const [proposalBusyId, setProposalBusyId] = createSignal<string>();
  const [proposalError, setProposalError] = createSignal<string>();
  const [caseStackBusy, setCaseStackBusy] = createSignal(false);
  const [captureOpen, setCaptureOpen] = createSignal(false);
  const [captureClosing, setCaptureClosing] = createSignal(false);
  const [deviceCompanionOrientation, setDeviceCompanionOrientation] = createSignal<
    "portrait" | "landscape" | "square" | "unknown"
  >("unknown");
  const [waitingForRecordTarget, setWaitingForRecordTarget] = createSignal(false);
  const [reviewStepIndex, setReviewStepIndex] = createSignal(0);
  const [reviewDestination, setReviewDestination] = createSignal<TakeDestination>({
    kind: "new-screen",
  });
  type ReplayState = "idle" | "running" | "passed" | "failed";
  const [takeReplay, setTakeReplay] = createSignal<{
    takeId: string | null;
    state: ReplayState;
    error?: string;
  }>({ takeId: null, state: "idle" });
  const [transitionReplay, setTransitionReplay] = createSignal<{
    connectionId: string | null;
    state: ReplayState;
    error?: string;
  }>({ connectionId: null, state: "idle" });
  const [canvasTool, setCanvasTool] = createSignal<"select" | "hand">("select");
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
  let destinationResolvedForTake = "";
  let captureCloseTimer: number | undefined;
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

  const closeCapturePanel = () => {
    if (!captureOpen() || captureClosing()) return;
    setCaptureClosing(true);
    captureCloseTimer = window.setTimeout(() => {
      setCaptureOpen(false);
      setCaptureClosing(false);
      captureCloseTimer = undefined;
    }, 150);
  };

  const openCapturePanel = () => {
    if (captureCloseTimer) window.clearTimeout(captureCloseTimer);
    captureCloseTimer = undefined;
    setCaptureClosing(false);
    setContextSurface(null);
    setCaptureOpen(true);
  };

  const openDevicePicker = () => {
    if (captureCloseTimer) window.clearTimeout(captureCloseTimer);
    captureCloseTimer = undefined;
    setCaptureClosing(false);
    setContextSurface(null);
    setCaptureOpen(true);
    // DevicePicker subscribes when the companion mounts. Wait one frame so a
    // request made from the canvas can never race that subscription.
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("relay:open-device-picker")));
  };
  onCleanup(() => {
    if (captureCloseTimer) window.clearTimeout(captureCloseTimer);
    if (pointerMoveFrame !== undefined) cancelAnimationFrame(pointerMoveFrame);
  });

  const reviewingTake = () => recorder.take()?.state === "review";

  createEffect(() => {
    const take = recorder.take();
    const lastIndex = Math.max(0, (take?.state === "review" ? take.steps.length : 1) - 1);
    setReviewStepIndex((index) => Math.min(lastIndex, Math.max(0, index)));
    if ((take?.id ?? null) !== takeReplay().takeId) {
      setTakeReplay({ takeId: take?.id ?? null, state: "idle" });
    }
  });

  createEffect(() => {
    const take = recorder.take();
    if (!take || take.state !== "review" || destinationResolvedForTake === take.id) return;
    destinationResolvedForTake = take.id;
    const match = screenForObservation(graph(), take.destinationObservation);
    setReviewDestination(match ? { kind: "screen", screenId: match.id } : { kind: "new-screen" });
  });

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
    if (
      JSON.stringify(value.graph) === JSON.stringify(current.graph) &&
      JSON.stringify(value.positions) === JSON.stringify(current.positions) &&
      JSON.stringify(value.groups) === JSON.stringify(current.groups) &&
      JSON.stringify(value.screenTitles) === JSON.stringify(current.screenTitles) &&
      JSON.stringify(value.notes) === JSON.stringify(current.notes)
    ) {
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
  const canonicalConnectionFor = (connection: CanvasConnection) =>
    activeAppMap()?.connections[connection.id];
  const caseStackFor = (connection: CanvasConnection) => {
    const map = activeAppMap();
    const id = canonicalConnectionFor(connection)?.caseStackId;
    return id ? map?.caseStacks[id] : undefined;
  };
  const saveConnectionCaseStack = async (
    connection: CanvasConnection,
    value: { name: string; variableIds: string[]; strategy: CaseExpansionStrategy },
  ) => {
    const map = activeAppMap();
    const canonicalConnection = canonicalConnectionFor(connection);
    if (!map || !canonicalConnection) {
      toast("This connection is still syncing. Try again in a moment.", "info");
      return;
    }
    const existing = canonicalConnection.caseStackId
      ? map.caseStacks[canonicalConnection.caseStackId]
      : undefined;
    const at = Date.now();
    const caseStackId = existing?.id ?? `cases-${connection.id}`;
    const stack: CaseStack = {
      id: caseStackId,
      organizationId: map.organizationId,
      projectId: map.projectId,
      appMapId: map.id,
      name: value.name,
      variableIds: value.variableIds,
      strategy: value.strategy,
      maxCases: existing?.maxCases ?? 20,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    setCaseStackBusy(true);
    try {
      await server.runAction("app-map.case-stack.attach", {
        appMapId: map.id,
        connectionId: canonicalConnection.id,
        caseStackId,
        expectedRevision: map.revision,
        caseStack: stack,
      });
      await server.refreshAppMaps();
      toast(
        `Added ${value.variableIds.length === 1 ? "a case stack" : "combined coverage"}`,
        "success",
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setCaseStackBusy(false);
    }
  };
  const attachConnectionCaseStack = async (connection: CanvasConnection, caseStackId: string) => {
    const map = activeAppMap();
    const canonicalConnection = canonicalConnectionFor(connection);
    if (!map || !canonicalConnection || !map.caseStacks[caseStackId]) return;
    setCaseStackBusy(true);
    try {
      await server.runAction("app-map.case-stack.attach", {
        appMapId: map.id,
        connectionId: canonicalConnection.id,
        caseStackId,
        expectedRevision: map.revision,
      });
      await server.refreshAppMaps();
      toast(`Applied ${map.caseStacks[caseStackId]!.name}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setCaseStackBusy(false);
    }
  };
  const detachConnectionCaseStack = async (connection: CanvasConnection) => {
    const map = activeAppMap();
    const canonicalConnection = canonicalConnectionFor(connection);
    if (!map || !canonicalConnection?.caseStackId) return;
    setCaseStackBusy(true);
    try {
      await server.runAction("app-map.connection.update", {
        appMapId: map.id,
        connectionId: canonicalConnection.id,
        expectedRevision: map.revision,
        patch: { caseStackId: null },
      });
      await server.refreshAppMaps();
      toast("Removed cases from this connection", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setCaseStackBusy(false);
    }
  };
  const graphRunReadiness = createMemo(() =>
    appMapRunReadiness({
      graph: graph(),
      recipeSteps: draft.steps(),
      selection: {
        screenId: selectedNodeId(),
        transitionId: selectedConnectionId(),
      },
    }),
  );
  const runCanvasGraph = () => {
    const appMap = activeAppMap();
    const flow = appMap ? Object.values(appMap.flows)[0] : undefined;
    if (!appMap || !flow) {
      toast("Add and verify a connection before running this flow", "info");
      return;
    }
    void server.runAppMapFlowRemote(appMap.id, flow.id, flow.name);
  };
  const refreshMapScreenshots = () => {
    if (!graphRunReadiness().ready) {
      toast(graphRunReadiness().reason ?? "Finish the flow before refreshing screenshots", "info");
      return;
    }
    toast("Replaying the flow to capture fresh screenshots", "info");
    runCanvasGraph();
  };
  const reusableBehaviors = createMemo(() =>
    server
      .recipes()
      .filter(
        (recipe) =>
          recipe.source === "custom" &&
          recipe.id !== server.selectedAppMapId() &&
          (recipe.description?.startsWith("Reusable connection behavior") ||
            recipe.description?.startsWith("Reusable transition behavior")) &&
          recipe.steps.length > 0,
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 8)
      .map((recipe) => ({
        id: recipe.id,
        label: recipe.title,
        actionCount: recipe.steps.length,
      })),
  );
  const bounds = createMemo(() =>
    canvasBounds(tree().nodes, canvasState().notes ?? [], positionFor),
  );
  const minimapNodes = createMemo(() => {
    const content = bounds();
    return [
      ...tree().nodes.map((node) => {
        const position = positionFor(node);
        const point = minimapPoint(
          {
            x: position.x + SCREEN_CARD_WIDTH / 2,
            y: position.y + SCREEN_CARD_HEIGHT / 2,
          },
          content,
        );
        return {
          id: node.id,
          kind: "screen" as const,
          x: point.x,
          y: point.y,
          selected: selectedNodeId() === node.id,
          state: runProjection().screens[node.id]?.state,
        };
      }),
      ...(canvasState().notes ?? []).map((note) => {
        const point = minimapPoint({ x: note.x + 110, y: note.y + 66 }, content);
        return {
          id: note.id,
          kind: "note" as const,
          x: point.x,
          y: point.y,
          selected: false,
        };
      }),
    ];
  });
  const minimapEdges = createMemo(() => {
    const content = bounds();
    const nodes = new Map(tree().nodes.map((node) => [node.id, node]));
    return connections().flatMap((connection) => {
      const from = nodes.get(connection.fromScreenId);
      const to = nodes.get(connection.toScreenId);
      if (!from || !to) return [];
      const fromPosition = positionFor(from);
      const toPosition = positionFor(to);
      const start = minimapPoint(
        {
          x: fromPosition.x + SCREEN_CARD_WIDTH / 2,
          y: fromPosition.y + SCREEN_CARD_HEIGHT / 2,
        },
        content,
      );
      const end = minimapPoint(
        {
          x: toPosition.x + SCREEN_CARD_WIDTH / 2,
          y: toPosition.y + SCREEN_CARD_HEIGHT / 2,
        },
        content,
      );
      return [
        {
          id: connection.id,
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
          selected: selectedConnectionId() === connection.id,
          state: runProjection().transitions[connection.id]?.state,
        },
      ];
    });
  });
  const minimapViewport = createMemo(() =>
    minimapViewportBounds(view(), canvasClientSize(), bounds()),
  );
  const presenceGeometry = createMemo(() => ({
    screenPositions: Object.fromEntries(
      tree().nodes.map((node) => [node.id, { ...positionFor(node) }]),
    ),
    connectionPaths: Object.fromEntries(
      connections().map((connection) => [
        connection.id,
        canvasEdgeGeometry(
          {
            from: connection.fromScreenId,
            to: connection.toScreenId,
            kind: connection.kind,
          },
          tree().nodes,
          positionFor,
        ).path,
      ]),
    ),
  }));

  const fit = () => {
    const element = canvas;
    if (!element || !hasCanvasContent()) return;
    setView(
      fitCanvasViewport({ width: element.clientWidth, height: element.clientHeight }, bounds()),
    );
  };

  createEffect(() => {
    const appMapId = loadedAppMapId();
    if (!appMapId || appMapLoadState().status !== "ready" || initiallyFittedAppMapId === appMapId)
      return;
    // Fit an existing map once when it opens. A blank map is also marked as
    // handled so its first capture does not yank the camera away from the user.
    initiallyFittedAppMapId = appMapId;
    if (hasCanvasContent()) requestAnimationFrame(fit);
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
    setScreenInspectorOpen(false);
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
  const visibleCanvasBounds = createMemo(() => {
    const viewport = view();
    const client = canvasClientSize();
    const overscan = 480;
    return {
      left: -viewport.x / viewport.scale - overscan,
      top: -viewport.y / viewport.scale - overscan,
      right: (-viewport.x + client.width) / viewport.scale + overscan,
      bottom: (-viewport.y + client.height) / viewport.scale + overscan,
    };
  });
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
      canvasUndoStack.push({ before, after: structuredClone(value), at: Date.now() });
      if (canvasUndoStack.length > 100) canvasUndoStack = canvasUndoStack.slice(-100);
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
    const at = Date.now();
    const next = {
      ...graph(),
      flows: graph().flows.map((candidate) => {
        if (candidate.id !== flow.id) return candidate;
        const { targetSetId: _previousTargetSetId, ...withoutTargetSet } = candidate;
        return {
          ...withoutTargetSet,
          ...(targetSetId ? { targetSetId } : {}),
          updatedAt: at,
        };
      }),
    };
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
    const chooseFromShell = (event: Event) => {
      const detail = (event as CustomEvent<{ targetSetId?: string }>).detail;
      chooseTargetSet(detail?.targetSetId);
    };
    const toggleHistoryFromShell = () => {
      const opening = !historyOpen();
      if (opening) setCaptureOpen(false);
      setHistoryOpen(opening);
    };
    const revealFromPalette = (
      event: Event & { detail?: { appMapId?: string; screenId?: string } },
    ) => {
      const detail = event.detail;
      if (!detail?.screenId || !detail.appMapId || detail.appMapId !== server.selectedAppMapId()) {
        return;
      }
      setWorkspaceView("map");
      setSelectedNodeId(detail.screenId);
      queueMicrotask(() => revealScreen(detail.screenId!));
    };
    window.addEventListener("relay:choose-target-set", chooseFromShell);
    window.addEventListener("relay:toggle-map-history", toggleHistoryFromShell);
    window.addEventListener("relay:reveal-app-map-screen", revealFromPalette as EventListener);
    onCleanup(() => {
      window.removeEventListener("relay:choose-target-set", chooseFromShell);
      window.removeEventListener("relay:toggle-map-history", toggleHistoryFromShell);
      window.removeEventListener("relay:reveal-app-map-screen", revealFromPalette as EventListener);
      canvasResizeObserver?.disconnect();
    });
  });
  const decideProposal = async (
    proposalId: string,
    decision: "approve" | "reject",
    reason?: string,
  ) => {
    const appMap = activeAppMap();
    if (!appMap || proposalBusyId()) return;
    setProposalBusyId(proposalId);
    setProposalError();
    try {
      await server.runAction(`app-map.proposal.${decision}` as const, {
        appMapId: appMap.id,
        proposalId,
        expectedRevision: appMap.revision,
        ...(reason ? { reason } : {}),
      });
      await server.refreshAppMaps();
      toast(
        decision === "approve"
          ? "Proposal added to the map"
          : reason
            ? "Changes sent back with feedback"
            : "Proposal rejected",
        "success",
      );
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : String(error));
    } finally {
      setProposalBusyId();
    }
  };
  const variantForCapture = (screenId: string, captured: CapturedStartScreen): ScreenVariant => {
    const at = captured.observation.capturedAt;
    const targetId = captured.targetProfile.targetId;
    const variantId = `variant:${screenId}:${captured.targetProfile.platform}:${targetId}`;
    return {
      id: variantId,
      ...captured.mapScope,
      screenId,
      targetProfile: structuredClone(captured.targetProfile),
      observation: {
        fingerprint: captured.observation.fingerprint,
        nodes: captured.semanticNodes.slice(0, 256).map((node) => ({
          role: typeof node.role === "string" && node.role.trim() ? node.role : "unknown",
          ...(typeof node.label === "string" ? { label: node.label } : {}),
          ...(typeof node.value === "string" ? { value: node.value } : {}),
          ...(typeof node.identifier === "string" ? { identifier: node.identifier } : {}),
          ...(typeof node.enabled === "boolean" ? { enabled: node.enabled } : {}),
          ...(typeof node.selected === "boolean" ? { selected: node.selected } : {}),
          ...(typeof node.focused === "boolean" ? { focused: node.focused } : {}),
          ...(typeof node.hittable === "boolean" ? { hittable: node.hittable } : {}),
          ...(typeof node.depth === "number" && Number.isFinite(node.depth)
            ? { depth: node.depth }
            : {}),
        })),
        volatileSignals: [],
      },
      evidenceIds: [...new Set(captured.evidenceIds)],
      evidenceUris: [...new Set(captured.evidenceUris)],
      createdAt: at,
      updatedAt: at,
    };
  };
  const useCurrentScreenAsStart = async (): Promise<boolean> => {
    if (startCaptureBusy() || hasMap()) return false;
    setStartCaptureBusy(true);
    try {
      const captured = await recorder.captureStartScreen();
      if (!captured || hasMap()) return false;
      const added = addCanvasStartScreen(graph(), captured.observation);
      const variant = variantForCapture(added.screen.id, captured);
      persistMetadata(withCanvasGraph(canvasState(), added.graph), {
        variantsByScreen: { [added.screen.id]: [variant] },
      });
      if (captured.screenshotUrl) {
        setCapturedScreenUrls((urls) => ({ ...urls, [added.screen.id]: captured.screenshotUrl! }));
      }
      setSelectedNodeId(added.screen.id);
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
      const captured = await recorder.captureStartScreen();
      if (!captured) return;
      const added = addCanvasScreen(graph(), captured.observation);
      const variant = variantForCapture(added.screen.id, captured);
      persistMetadata(withCanvasGraph(canvasState(), added.graph), {
        variantsByScreen: { [added.screen.id]: [variant] },
      });
      if (captured.screenshotUrl) {
        setCapturedScreenUrls((urls) => ({ ...urls, [added.screen.id]: captured.screenshotUrl! }));
      }
      const node = buildCanvasGraphTree(added.graph, draft.steps()).nodes.find(
        (candidate) => candidate.id === added.screen.id,
      );
      if (node) selectNode(node);
      toast(added.created ? "Screen added to the map" : "Existing screen refreshed", "success");
    } finally {
      setStartCaptureBusy(false);
    }
  };
  let automaticStartCaptureHandledFor = "";
  createEffect(() => {
    const appMapId = server.selectedAppMapId();
    if (
      !appMapId ||
      automaticStartCaptureHandledFor === appMapId ||
      !props.captureStartOnReady ||
      loadedAppMapId() !== appMapId ||
      hasMap() ||
      !canRecord() ||
      startCaptureBusy()
    )
      return;
    automaticStartCaptureHandledFor = appMapId;
    void useCurrentScreenAsStart().then((success) =>
      props.onCaptureStartHandled?.(success, appMapId),
    );
  });
  const addNote = () => {
    const element = canvas;
    const current = view();
    const x = element ? (element.clientWidth * 0.52 - current.x) / current.scale : 320;
    const y = element ? (element.clientHeight * 0.42 - current.y) / current.scale : 180;
    const at = Date.now();
    const id = `note-${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? at.toString(36)}`;
    persistNotes([
      ...(canvasState().notes ?? []),
      { id, text: "Add context for this part of the map", x, y, createdAt: at, updatedAt: at },
    ]);
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
  const canReplayOnDevice = () => {
    if (canRecord()) return true;
    toast("Choose a ready device before trying this connection", "info");
    openDevicePicker();
    return false;
  };
  const replayTake = async () => {
    const take = recorder.take();
    if (!take || !canReplayOnDevice()) return;
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
  };
  const keepTake = async () => {
    const take = recorder.take();
    if (!take || takeReplay().takeId !== take.id || takeReplay().state !== "passed") return;
    const committed = await recorder.keepTake({
      destination: reviewDestination(),
    });
    if (committed) {
      const appMapId = server.selectedAppMapId();
      const next = appMapId ? await server.loadAppMap(appMapId) : null;
      const destination = committed.committedConnectionId
        ? next?.connections[committed.committedConnectionId]?.destination
        : undefined;
      pendingConnectionId = null;
      recordingSourceScreenId = null;
      recorder.setRecordingTransition(undefined);
      setReviewDestination({ kind: "new-screen" });
      // Review is a temporary decision point. Once the person keeps it, return
      // them to the graph and select the just-added screen so "Record from
      // here" is the natural next action instead of leaving a stale device
      // inspector open beside the canvas.
      setCaptureOpen(false);
      setTakeReplay({ takeId: null, state: "idle" });
      requestAnimationFrame(() => {
        const addedScreen =
          destination?.kind === "screen"
            ? tree().nodes.find((node) => node.id === destination.screenId)
            : undefined;
        if (addedScreen) selectNode(addedScreen);
      });
    }
  };
  const discardTake = async () => {
    pendingConnectionId = null;
    recordingSourceScreenId = null;
    recorder.setRecordingTransition(undefined);
    setReviewDestination({ kind: "new-screen" });
    await recorder.discardTake();
    setTakeReplay({ takeId: null, state: "idle" });
  };
  const rewriteTake = async () => {
    const take = recorder.take();
    if (!take) return;
    const sourceScreenId = take.sourceScreenId ?? recordingSourceScreenId ?? selectedNodeId();
    await recorder.discardTake();
    recordingSourceScreenId = sourceScreenId;
    recorder.setRecordingSourceScreen(sourceScreenId ?? undefined);
    recorder.setRecordingTransition(pendingConnectionId ?? undefined);
    const source = tree().nodes.find((node) => node.id === sourceScreenId);
    if (source) recorder.setRecordingGroup(titleFor(source));
    setTakeReplay({ takeId: null, state: "idle" });
    setCaptureOpen(true);
    void recorder.enterRecordMode();
  };
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
      // A selected iPad that is still preparing is not a device-picker
      // problem. Keep its current readiness explanation on the canvas rather
      // than opening a second, contradictory flow.
      if (
        state === "enable-developer-mode" ||
        state === "preparing-ios" ||
        state === "preparing-screen"
      )
        return;
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
  const captureContextLabel = () => {
    const transition = pendingConnectionId
      ? connections().find((connection) => connection.id === pendingConnectionId)
      : null;
    if (!transition) return undefined;
    const source = tree().nodes.find((node) => node.id === transition.fromScreenId);
    const target = tree().nodes.find((node) => node.id === transition.toScreenId);
    return source && target ? `${titleFor(source)} → ${titleFor(target)}` : undefined;
  };
  const recordConnection = (connection: CanvasConnection) => {
    const screen = tree().nodes.find((node) => node.id === connection.fromScreenId) ?? null;
    pendingConnectionId = connection.id;
    recorder.setRecordingTransition(connection.id);
    recordFromNode(screen);
  };
  const attachBehaviorStep = (
    connection: CanvasConnection,
    step: RecipeStep,
    mode: "interaction" | "automatic" | "reusable",
  ) => {
    const source = tree().nodes.find((node) => node.id === connection.fromScreenId);
    const inserted = draft.appendSteps([
      { ...step, ...(source ? { group: titleFor(source) } : {}) } as RecipeStep,
    ]);
    if (!inserted.length) return;
    persistMetadata(
      attachTransitionSteps(canvasState(), connection.id, inserted, mode, Date.now()),
    );
    setTransitionReplay({ connectionId: connection.id, state: "idle" });
  };
  const attachBackBehavior = (connection: CanvasConnection) =>
    attachBehaviorStep(connection, { kind: "key", key: "back" }, "interaction");
  const attachAutomaticBehavior = (connection: CanvasConnection) =>
    attachBehaviorStep(connection, { kind: "sleep", ms: 750 }, "automatic");
  const attachReusableBehavior = (connection: CanvasConnection, recipeId: string) =>
    attachBehaviorStep(connection, { kind: "module", recipeId }, "reusable");
  const stepsForConnection = (connection: CanvasConnection) => {
    const byId = new Map(draft.steps().flatMap((step) => (step.id ? [[step.id, step]] : [])));
    return connection.stepIds.flatMap((id) => {
      const step = byId.get(id);
      return step ? [step] : [];
    });
  };
  const replayStateFor = (connection: CanvasConnection): ReplayState => {
    const current = transitionReplay();
    if (current.connectionId === connection.id && current.state !== "idle") return current.state;
    if (connection.review?.status === "verified") return "passed";
    if (connection.review?.status === "failed") return "failed";
    return "idle";
  };
  const replayErrorFor = (connection: CanvasConnection) => {
    const current = transitionReplay();
    return current.connectionId === connection.id
      ? current.error
      : connection.review?.status === "failed"
        ? connection.review.error
        : undefined;
  };
  const replayConnection = async (connection: CanvasConnection) => {
    if (!canReplayOnDevice()) return;
    setTransitionReplay({ connectionId: connection.id, state: "running" });
    const result = await replayTransitionSteps(stepsForConnection(connection), server.runStep);
    if (result.ok) {
      const destination = graph().screens.find((screen) => screen.id === connection.toScreenId);
      const captured = await recorder.captureStartScreen();
      const identity = destination?.identity;
      const observedFingerprint = captured?.observation.fingerprint;
      const reachedExpectedScreen = Boolean(
        identity &&
        observedFingerprint &&
        [identity.fingerprint, ...(identity.aliases ?? [])].includes(observedFingerprint),
      );
      const device = selectedDevice();
      const target = {
        targetId: device?.serial ?? server.selectedDevice() ?? "current-device",
        ...(device?.name ? { targetName: device.name } : {}),
        ...(device?.platform ? { platform: device.platform } : {}),
        status: reachedExpectedScreen ? ("passed" as const) : ("failed" as const),
        checkedAt: Date.now(),
        ...(observedFingerprint ? { observedFingerprint } : {}),
        ...(!reachedExpectedScreen
          ? {
              error: `Reached a different screen instead of ${destination?.title ?? "the destination"}`,
            }
          : {}),
      };
      if (!reachedExpectedScreen) {
        const error = target.error!;
        persistMetadata(
          reviewTransition(
            canvasState(),
            connection.id,
            { status: "failed", error, targets: [target] },
            Date.now(),
          ),
        );
        setTransitionReplay({ connectionId: connection.id, state: "failed", error });
        toast(error, "warning");
        return;
      }
      persistMetadata(
        reviewTransition(
          canvasState(),
          connection.id,
          { status: "verified", targets: [target] },
          Date.now(),
        ),
      );
      setTransitionReplay({ connectionId: connection.id, state: "passed" });
      toast("Connection verified on the device", "success");
      return;
    }
    persistMetadata(
      reviewTransition(
        canvasState(),
        connection.id,
        { status: "failed", error: result.error },
        Date.now(),
      ),
    );
    setTransitionReplay({
      connectionId: connection.id,
      state: "failed",
      error: result.error,
    });
  };
  const saveReusableBehavior = async (connection: CanvasConnection) => {
    const steps = stepsForConnection(connection).map((step) => {
      const copy = structuredClone(step);
      delete copy.id;
      return copy;
    });
    if (!steps.length) return;
    const source = tree().nodes.find((node) => node.id === connection.fromScreenId);
    const target = tree().nodes.find((node) => node.id === connection.toScreenId);
    const title = `${source ? titleFor(source) : "Screen"} → ${target ? titleFor(target) : "Next screen"}`;
    const saved = await server.saveRecipeRemote({
      title,
      description: "Reusable connection behavior · saved from the App Map",
      steps,
    });
    if (saved) toast(`Saved “${saved.title}” as a reusable behavior`, "success");
  };
  const beginConnection = (event: PointerEvent, fromScreenId: string) => {
    const element = canvas;
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = element.getBoundingClientRect();
    const point = {
      x: (event.clientX - rect.left - view().x) / view().scale,
      y: (event.clientY - rect.top - view().y) / view().scale,
    };
    connectionDrag = { fromScreenId, pointerId: event.pointerId, origin: point, point };
    element.setPointerCapture(event.pointerId);
  };
  const chooseKeyboardConnection = (fromScreenId: string, toScreenId: string) => {
    const next = addPlannedConnection(
      canvasState(),
      { fromScreenId, toScreenId },
      Date.now(),
      draft.steps(),
    );
    const connection = next.graph?.transitions.at(-1);
    persistMetadata(next);
    setKeyboardConnectionSourceId(null);
    setSelectedConnectionId(connection?.id ?? null);
    setSelectedNodeId(null);
  };
  const createKeyboardDestination = (fromScreenId: string) => {
    const source = tree().nodes.find((node) => node.id === fromScreenId);
    if (!source) return;
    const position = positionFor(source);
    const next = addPlannedScreenConnection(
      canvasState(),
      {
        fromScreenId,
        position: { x: position.x + 300, y: position.y },
      },
      Date.now(),
      draft.steps(),
    );
    const connection = next.graph?.transitions.at(-1);
    persistMetadata(next);
    setKeyboardConnectionSourceId(null);
    setSelectedConnectionId(connection?.id ?? null);
    setSelectedNodeId(null);
  };
  const removeConnection = (connection: CanvasConnection) => {
    if (connection.source !== "authored") return;
    const next = removeAuthoredConnection(canvasState(), connection.id);
    persistMetadata(next);
    setSelectedConnectionId(null);
  };
  const removeScreen = (node: MapTreeNode) => {
    const current = canvasState();
    const nextGraph = removeCanvasScreen(graph(), node.id);
    const nextPositions = { ...current.positions };
    const nextTitles = { ...current.screenTitles };
    delete nextPositions[node.id];
    delete nextTitles[node.id];
    const next = withCanvasGraph(
      {
        ...current,
        positions: nextPositions,
        screenTitles: nextTitles,
        groups: (current.groups ?? []).flatMap((group) => {
          const screenIds = group.screenIds.filter((id) => id !== node.id);
          return screenIds.length ? [{ ...group, screenIds, updatedAt: Date.now() }] : [];
        }),
      },
      nextGraph,
    );
    persistMetadata(next);
    setSelectedNodeId(null);
    setScreenInspectorOpen(false);
  };
  const renameScreen = (node: MapTreeNode, title: string) => {
    const next = title.trim();
    if (!next || next === titleFor(node)) {
      setRenamingNodeId(null);
      return;
    }
    const nextGraph = structuredClone(graph());
    const screen = nextGraph.screens.find((entry) => entry.id === node.id);
    if (screen) {
      screen.title = next;
      screen.updatedAt = Date.now();
    }
    persistMetadata(
      withCanvasGraph(
        {
          ...canvasState(),
          screenTitles: { ...canvasState().screenTitles, [node.id]: next },
        },
        nextGraph,
      ),
    );
    setRenamingNodeId(null);
  };
  const groupSelection = () => {
    const appMap = activeAppMap();
    const screenIds = [...new Set(selectedNodeIds())].filter((id) => appMap?.screens[id]);
    if (!appMap || screenIds.length < 2) {
      toast("Select at least two screens to group", "info");
      return;
    }
    const selected = new Set(screenIds);
    const at = Date.now();
    const remaining = groups().flatMap((group) => {
      const memberIds = group.screenIds.filter((id) => !selected.has(id));
      return memberIds.length ? [{ ...group, screenIds: memberIds, updatedAt: at }] : [];
    });
    const group: MapGroup = {
      id: `group-${crypto.randomUUID()}`,
      organizationId: appMap.organizationId,
      projectId: appMap.projectId,
      appMapId: appMap.id,
      name: nextGroupName(groups()),
      screenIds,
      createdAt: at,
      updatedAt: at,
    };
    persistMetadata({ ...canvasState(), groups: [...remaining, group] });
    setSelectedNodeIdValue(null);
    setSelectedNodeIds([]);
    setSelectedConnectionId(null);
    setSelectedGroupId(group.id);
    setGroupMenu(null);
    toast("Grouped selection", "success");
  };
  const ungroup = (group: MapGroup) => {
    persistMetadata({
      ...canvasState(),
      groups: groups().filter((candidate) => candidate.id !== group.id),
    });
    setSelectedGroupId(null);
    setRenamingGroupId(null);
    setSelectedNodeIds([...group.screenIds]);
    setSelectedNodeIdValue(group.screenIds.at(-1) ?? null);
    setGroupMenu(null);
    toast("Ungrouped screens", "success");
  };
  const ungroupSelection = () => {
    const selected = new Set(selectedNodeIds());
    const owners = groups().filter((group) => group.screenIds.some((id) => selected.has(id)));
    if (!owners.length) return;
    const ownerIds = new Set(owners.map((group) => group.id));
    persistMetadata({
      ...canvasState(),
      groups: groups().filter((group) => !ownerIds.has(group.id)),
    });
    setGroupMenu(null);
    toast(
      owners.length === 1 ? "Ungrouped screens" : `Ungrouped ${owners.length} Groups`,
      "success",
    );
  };
  const renameGroup = (group: MapGroup, name: string) => {
    const next = name.trim();
    if (!next || next === group.name) {
      setRenamingGroupId(null);
      return;
    }
    persistMetadata({
      ...canvasState(),
      groups: groups().map((candidate) =>
        candidate.id === group.id ? { ...candidate, name: next, updatedAt: Date.now() } : candidate,
      ),
    });
    setRenamingGroupId(null);
  };
  const selectGroup = (group: MapGroup) => {
    setSelectedGroupId(group.id);
    setSelectedNodeIdValue(null);
    setSelectedNodeIds([]);
    setSelectedConnectionId(null);
    setScreenInspectorOpen(false);
    setRenamingNodeId(null);
  };
  const openGroupMenu = (event: MouseEvent, options: { groupId?: string; screenIds: string[] }) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    setGroupMenu({
      x: Math.min(rect.width - 196, Math.max(8, event.clientX - rect.left)),
      y: Math.min(rect.height - 136, Math.max(8, event.clientY - rect.top)),
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
    reviewingTake,
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
            if (
              !target.closest(
                "[data-app-map-screen-id], [data-app-map-group-id], aside, button, input, textarea",
              )
            ) {
              setSelectedNodeId(null);
              setSelectedGroupId(null);
              setSelectedConnectionId(null);
              setScreenInspectorOpen(false);
            }
            if (!target.closest("[data-app-map-group-menu]")) setGroupMenu(null);
            const wantsPan = canvasTool() === "hand" || event.button === 1;
            if (!hasCanvasContent() || !wantsPan || target.closest("button")) return;
            pan = { x: event.clientX, y: event.clientY, view: view() };
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            scheduleCanvasPointerMove(event.clientX, event.clientY);
          }}
          onPointerUp={(event) => {
            flushCanvasPointerMove(event.clientX, event.clientY);
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
              const nextGroups = nodeDrag.groupId
                ? groups()
                : groupsAfterScreenDrag(
                    groups(),
                    nodeDrag.ids,
                    nodeDrag.before.positions,
                    positions(),
                    Date.now(),
                  );
              persistMetadata(withCanvasGraph({ ...canvasState(), groups: nextGroups }, graph()), {
                before: nodeDrag.before,
              });
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
                    recipeId={server.selectedAppMapId() ?? appMap().id}
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
                    canRefreshScreenshots={graphRunReadiness().ready}
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
                <AppMapCanvasScene
                  nodes={tree().nodes}
                  connections={connections()}
                  notes={canvasState().notes ?? []}
                  groups={groups()}
                  width={bounds().width}
                  height={bounds().height}
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
                  awareness={[]}
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
                                  <Icon name="group" size={13} /> Group selection
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
                  when={selectedConnection()}
                  fallback={
                    <ScreenInspector
                      node={screenInspectorOpen() ? selectedNode() : null}
                      title={selectedNode() ? titleFor(selectedNode()!) : ""}
                      connections={connections().filter(
                        (connection) => connection.fromScreenId === selectedNode()?.id,
                      )}
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
                          count + (action.kind === "recorded" ? action.steps.length : 1),
                        0,
                      )}
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
          <AppMapTakeReview
            take={take()}
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
            onReorderActions={(actionIds) => recorder.reorderTakeActions(actionIds)}
            onReplaceAction={(actionId, interaction) =>
              recorder.replaceTakeAction(actionId, interaction)
            }
            onRemoveAction={(actionId) => recorder.removeTakeAction(actionId)}
            onReviewInvalidated={() => setTakeReplay({ takeId: take().id, state: "idle" })}
            replayState={takeReplay().takeId === take().id ? takeReplay().state : "idle"}
            {...(takeReplay().takeId === take().id && takeReplay().error
              ? { replayError: takeReplay().error }
              : {})}
            onRemove={(index) => {
              void recorder.removeTakeStep(index);
              setTakeReplay({ takeId: take().id, state: "idle" });
              setReviewStepIndex((selected) => (selected > index ? selected - 1 : selected));
            }}
            onClip={(clip) => {
              void recorder.setTakeVideoClip(clip);
              setTakeReplay({ takeId: take().id, state: "idle" });
            }}
          />
        )}
      </Show>
      <Show when={appMapLoadState().status === "ready" && captureOpen() && !reviewingTake()}>
        <AppMapDeviceCompanion
          closing={captureClosing()}
          deviceSelected={Boolean(selectedDevice())}
          status={livePanelStatus()}
          recording={recorder.recording()}
          take={recorder.take()}
          arming={recorder.arming()}
          captureBusy={startCaptureBusy()}
          canRecord={canRecord()}
          recordLabel={
            recorder.arming() || startCaptureBusy()
              ? "Preparing…"
              : !hasCanvasContent()
                ? "Start recording"
                : selectedConnection()
                  ? selectedConnection()!.state === "needs-recording"
                    ? "Record"
                    : "Rewrite"
                  : "Record"
          }
          captureContextLabel={captureContextLabel()}
          onClose={closeCapturePanel}
          onOpenTargets={props.onOpenTargets}
          onRecord={() => {
            if (!hasCanvasContent()) {
              // A first recording already observes both sides of the
              // transition. Let that single action create the entry screen,
              // destination, and connection; screenshot-only capture remains
              // available from the camera tool.
              recordFromHere();
              return;
            }
            const connection = selectedConnection();
            if (connection) {
              recordConnection(connection);
              return;
            }
            recordFromHere();
          }}
          onStop={() => void recorder.stopRecording()}
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

function AppMapLoadFeedback(props: {
  status: "loading" | "error";
  failure?: { title: string; guidance: string; detail?: string };
  onRetry: () => void;
}) {
  return (
    <div class="app-map-canvas relative grid h-full min-h-0 w-full min-w-0 place-items-center overflow-hidden px-6 text-center">
      <div
        class="app-map-grid pointer-events-none absolute inset-0 opacity-60"
        aria-hidden="true"
      />
      <section
        class="relative z-[1] grid max-w-[380px] justify-items-center gap-3"
        role={props.status === "error" ? "alert" : "status"}
        aria-live={props.status === "error" ? "assertive" : "polite"}
      >
        <span class="grid size-11 place-items-center rounded-[13px] bg-[var(--map-control-surface)] text-[var(--text-interactive-base)] shadow-[var(--map-elevation-control)]">
          <Icon
            name={props.status === "error" ? "alert" : "refresh"}
            size={17}
            class={props.status === "loading" ? "ui-refresh-spin motion-reduce:opacity-70" : ""}
          />
        </span>
        <div class="grid gap-1.5">
          <h2 class="m-0 text-[18px]/[1.25] font-semibold tracking-[-0.025em] text-[var(--text-strong)] text-balance">
            {props.status === "error"
              ? (props.failure?.title ?? "This map couldn’t be opened")
              : "Opening map…"}
          </h2>
          <p class="m-0 text-[12.5px]/[1.55] text-[var(--text-weak)]">
            {props.status === "error"
              ? (props.failure?.guidance ??
                "Your saved map has not been replaced. Check Relay’s connection and try again.")
              : "Loading its screens, connections, and evidence."}
          </p>
        </div>
        <Show when={props.status === "error" && props.failure?.detail}>
          <details class="w-full rounded-[10px] bg-[var(--map-control-surface)] px-3 py-2 text-left text-[11px]/[1.5] text-[var(--text-base)] shadow-[var(--map-elevation-control)]">
            <summary class="cursor-pointer font-medium text-[var(--text-strong)]">
              Technical details
            </summary>
            <p class="m-0 mt-2 break-words font-mono text-[10px] text-[var(--text-weak)]">
              {props.failure?.detail}
            </p>
          </details>
        </Show>
        <Show when={props.status === "error"}>
          <button
            type="button"
            class="canvas-tool-control inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-[var(--product-accent-soft)] px-4 text-[12px] font-semibold text-[var(--text-interactive-base)] outline-none transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--text-interactive-base)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--v2-background-bg-base)]"
            onClick={props.onRetry}
          >
            <Icon name="refresh" size={13} /> Try again
          </button>
        </Show>
      </section>
    </div>
  );
}

function appMapLoadFailure(error: unknown): {
  title: string;
  guidance: string;
  detail?: string;
} {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const message = error instanceof Error ? error.message.trim().slice(0, 280) : "";
  if (status === 401 || status === 403) {
    return {
      title: "Relay can’t access this map",
      guidance: "Check the project connection or permissions, then try again.",
      ...(message ? { detail: message } : {}),
    };
  }
  if (status === 404) {
    return {
      title: "This map is no longer available",
      guidance: "Choose another App Map or return to the project and create a new one.",
      ...(message ? { detail: message } : {}),
    };
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return {
      title: "Relay couldn’t read this map",
      guidance: "The saved map was left unchanged. Review the details or choose another map.",
      ...(message ? { detail: message } : {}),
    };
  }
  return {
    title: "Relay couldn’t reach this map",
    guidance: "Your saved map has not been replaced. Check the connection and try again.",
    ...(message ? { detail: message } : {}),
  };
}

function screenshotUrl(server: ReturnType<typeof useServer>, step: RecipeStep | undefined): string {
  const screenshot = evidenceForStep(step)?.screenshot;
  return screenshot ? server.recordingEvidenceUrl(screenshot.recipeId, screenshot.id) : "";
}

function latestScreenVariant(appMap: AppMap | null | undefined, screenId: string) {
  const screen = appMap?.screens[screenId];
  if (!appMap || !screen) return undefined;
  return screen.variantIds
    .flatMap((id) => (appMap.screenVariants[id] ? [appMap.screenVariants[id]!] : []))
    .toSorted((left, right) => right.updatedAt - left.updatedAt)[0];
}

function variantScreenshotUrl(
  server: ReturnType<typeof useServer>,
  appMap: AppMap | null | undefined,
  screenId: string,
): string {
  const variant = latestScreenVariant(appMap, screenId);
  const uri = variant?.evidenceUris?.find((item) => item.startsWith("relay-evidence://"));
  return uri ? server.authoringEvidenceUrl(uri, "image/png") : "";
}

function variantOrientationEvidence(
  appMap: AppMap | null | undefined,
  screenId: string,
): ScreenshotOrientationEvidence | undefined {
  const profile = latestScreenVariant(appMap, screenId)?.targetProfile;
  return profile
    ? {
        ...(profile.viewport ? { logicalViewport: { ...profile.viewport } } : {}),
        platform: profile.platform,
      }
    : undefined;
}

function canonicalNotesFor(notes: CanvasNote[], appMap: AppMap): AppMap["notes"] {
  return Object.fromEntries(
    notes.map((note) => [
      note.id,
      {
        id: note.id,
        organizationId: appMap.organizationId,
        projectId: appMap.projectId,
        appMapId: appMap.id,
        text: note.text.trim() || "Note",
        position: { x: note.x, y: note.y },
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      },
    ]),
  );
}

function canvasRemovalChanges(
  previous: AppMapCanvasState,
  next: AppMapCanvasState,
  appMap: AppMap,
): AppMapBatchChange[] {
  const previousGraph = previous.graph;
  if (!previousGraph) return [];
  const nextGraph = next.graph;
  const nextFlowIds = new Set(nextGraph?.flows.map((flow) => flow.id) ?? []);
  const nextConnectionIds = new Set(
    nextGraph?.transitions.map((connection) => connection.id) ?? [],
  );
  const nextScreenIds = new Set(nextGraph?.screens.map((screen) => screen.id) ?? []);
  const nextGroupIds = new Set((next.groups ?? []).map((group) => group.id));
  return [
    ...(previous.groups ?? []).flatMap((group): AppMapBatchChange[] =>
      !nextGroupIds.has(group.id) && appMap.groups[group.id]
        ? [{ kind: "group.remove", groupId: group.id }]
        : [],
    ),
    ...previousGraph.flows.flatMap((flow): AppMapBatchChange[] =>
      !nextFlowIds.has(flow.id) && appMap.flows[flow.id]
        ? [{ kind: "flow.remove", flowId: flow.id }]
        : [],
    ),
    ...previousGraph.transitions.flatMap((connection): AppMapBatchChange[] =>
      !nextConnectionIds.has(connection.id) && appMap.connections[connection.id]
        ? [{ kind: "connection.remove", connectionId: connection.id }]
        : [],
    ),
    ...previousGraph.screens.flatMap((screen): AppMapBatchChange[] =>
      !nextScreenIds.has(screen.id) && appMap.screens[screen.id]
        ? [{ kind: "screen.remove", screenId: screen.id }]
        : [],
    ),
  ];
}

function orderCanvasChanges(changes: AppMapBatchChange[]): AppMapBatchChange[] {
  const priority = (change: AppMapBatchChange): number => {
    if (change.kind === "screen.add" || change.kind === "screen.update") return 0;
    if (change.kind === "group.remove") return 1;
    if (change.kind === "group.save") return 2;
    if (change.kind === "connection.create" || change.kind === "connection.update") return 3;
    if (change.kind === "flow.save" || change.kind === "flow.remove") return 4;
    if (change.kind === "connection.remove") return 5;
    return 6;
  };
  return changes
    .map((change, index) => ({ change, index }))
    .sort((left, right) => {
      return priority(left.change) - priority(right.change) || left.index - right.index;
    })
    .map(({ change }) => change);
}

function screenshotOrientationEvidence(
  server: ReturnType<typeof useServer>,
  step: RecipeStep | undefined,
): ScreenshotOrientationEvidence | undefined {
  const evidence = evidenceForStep(step);
  if (!evidence) return undefined;
  const logicalViewport =
    companionLogicalViewport(evidence.nodes) ??
    (evidence.deviceBounds ? { ...evidence.deviceBounds } : undefined);
  const platform = evidence.serial
    ? server.devices().find((device) => device.serial === evidence.serial)?.platform
    : undefined;
  const edge = companionOrientationEdge(evidence.nodes, logicalViewport);
  return {
    ...(logicalViewport ? { logicalViewport } : {}),
    ...(platform ? { platform } : {}),
    ...(edge ? { edge } : {}),
  };
}
