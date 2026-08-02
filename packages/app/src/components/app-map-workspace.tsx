import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type {
  CaseExpansionStrategy,
  CaseStack,
  JourneyCanvasNote,
  JourneyMetadata,
  Revisioned,
  CollaborationAwareness,
} from "@relay/protocol";
import { useRecipeDraft } from "../context/recipe-draft";
import { useRecorder } from "../context/recorder";
import { useServer, type RecipeStep } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { type JourneyTreeNode } from "../lib/journey-tree";
import { createJourneyDocument, type JourneyDocument } from "../lib/journey-document";
import {
  addPlannedConnection,
  addPlannedScreenConnection,
  attachTransitionSteps,
  canvasConnections,
  removeAuthoredConnection,
  reviewTransition,
  type CanvasConnection,
} from "../lib/journey-prototype";
import {
  addJourneyGraphScreen,
  addJourneyStartScreen,
  buildJourneyGraphTree,
  ensureJourneyGraph,
  removeJourneyGraphScreen,
  screenForObservation,
  type TakeDestination,
  withJourneyGraph,
} from "../lib/journey-graph";
import { EMPTY_JOURNEY_METADATA } from "../lib/journey-metadata";
import {
  canvasBounds,
  canvasEdgeGeometry,
  clampCanvasScale,
  fitCanvasViewport,
  type CanvasPoint,
  type CanvasViewport,
} from "../lib/journey-canvas-layout";
import { zoomViewportAtPoint } from "../lib/viewport-zoom";
import { deviceReadiness } from "../lib/device-readiness";
import { projectJourneyRun } from "../lib/journey-run-projection";
import { journeyRunReadiness } from "../lib/journey-run-readiness";
import { replayTransitionSteps } from "../lib/transition-replay";
import { toast } from "../context/toast";
import { evidenceForStep } from "./journey-step-presentation";
import { GraphEmptyState } from "./journey-capture-review";
import { ConnectionInspector, ScreenInspector } from "./journey-canvas-primitives";
import { JourneyHistoryPanel } from "./journey-history-panel";
import { collaborationActivity } from "../lib/collaboration-awareness";
import type { JourneyCollaborationRuntime } from "../lib/journey-collaboration-runtime";
import { AppMapDeviceCompanion } from "./app-map-device-companion";
import {
  AppMapOverviewToolbar,
  AppMapToolbar,
  AppMapZoomControls,
  type AppMapWorkspaceView,
} from "./app-map-toolbar";
import { AppMapBrowseView } from "./app-map-browse-view";
import { AppMapAgentPanel } from "./app-map-agent-panel";
import { canvasWheelAction, createAppMapEventOrchestration } from "./app-map-events";
import { Icon } from "./icon";
import { mergeAppMapProjection, planAppMapProjection } from "../lib/app-map-projection";
import { AppMapProposalReview } from "./app-map-proposal-review";
import { caseStackCount } from "../lib/case-stack-presentation";
import { AppMapCanvasScene } from "./app-map-canvas-scene";
import { AppMapTakeReview } from "./app-map-take-review";

type AppMapLoadState =
  | { status: "idle" }
  | { status: "loading"; appMapId: string }
  | { status: "ready"; appMapId: string }
  | { status: "error"; appMapId: string };

/**
 * The graph is the authoring surface for a journey. A card is a captured
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
  onCaptureStartHandled?: () => void;
  addNoteOnReady?: boolean;
  onAddNoteHandled?: () => void;
}) {
  const server = useServer();
  const draft = useRecipeDraft();
  const recorder = useRecorder();
  const workbench = useWorkbench();
  // State must exist before a Solid memo reads it: createMemo evaluates its
  // computation immediately, including when the component is recreated by HMR.
  const [metadata, setMetadata] = createSignal<Revisioned<JourneyMetadata>>({
    revision: 0,
    value: EMPTY_JOURNEY_METADATA,
    updatedAt: 0,
  });
  const [loadedAppMapId, setLoadedAppMapId] = createSignal<string | null>(null);
  const [appMapLoadState, setAppMapLoadState] = createSignal<AppMapLoadState>({
    status: "idle",
  });
  const [appMapLoadAttempt, setAppMapLoadAttempt] = createSignal(0);
  const [targetSetOpen, setTargetSetOpen] = createSignal(false);
  const [workspaceView, setWorkspaceView] = createSignal<AppMapWorkspaceView>("map");
  const [agentOpen, setAgentOpen] = createSignal(false);
  const graph = createMemo(() => ensureJourneyGraph(metadata().value, draft.steps()));
  const activeFlow = createMemo(() => graph().flows[0] ?? null);
  const activeTargetSet = createMemo(() => {
    const id = activeFlow()?.targetSetId;
    return id ? (server.matrices().find((matrix) => matrix.id === id) ?? null) : null;
  });
  const activeAppMap = createMemo(() =>
    server.appMaps().find((candidate) => candidate.id === server.selectedAppMapId()),
  );
  const pendingProposals = createMemo(() =>
    Object.values(activeAppMap()?.proposals ?? {})
      .filter((proposal) => proposal.status === "pending")
      .sort((left, right) => left.createdAt - right.createdAt),
  );
  const tree = createMemo(() => buildJourneyGraphTree(graph(), draft.steps()));
  const hasMap = () => tree().nodes.length > 0;
  const selectedDevice = createMemo(
    () => server.devices().find((device) => device.serial === server.selectedDevice()) ?? null,
  );
  const graphRunJob = createMemo(() => {
    const appMapId = server.selectedAppMapId();
    if (!appMapId) return null;
    return (
      server
        .jobs()
        .find(
          (job) =>
            job.action === appMapId &&
            job.artifacts?.some((artifact) => artifact.kind === "journey-graph-plan"),
        ) ?? null
    );
  });
  const runProjection = createMemo(() => {
    const job = graphRunJob();
    return projectJourneyRun({
      graph: graph(),
      recipeSteps: job?.recipeSnapshot?.steps ?? draft.steps(),
      job,
    });
  });
  const [appleSetupCheckAttempt] = createSignal(0);
  const [appleSetupCheckFailed, setAppleSetupCheckFailed] = createSignal(false);
  let requestedAppleSetupFor = "";
  let canonicalProjectionQueue = Promise.resolve();
  let appliedCanonicalRevision = "";
  createEffect(() => {
    const device = selectedDevice();
    const setup = server.appleDeviceSetup();
    const attempt = appleSetupCheckAttempt();
    if (device?.platform !== "ios" || setup) {
      requestedAppleSetupFor = "";
      setAppleSetupCheckFailed(false);
      return;
    }
    const requestKey = `${device.serial}:${attempt}`;
    if (requestedAppleSetupFor === requestKey) return;
    requestedAppleSetupFor = requestKey;
    setAppleSetupCheckFailed(false);
    void server.refreshAppleDeviceSetup().catch(() => {
      // A cold local server or a just-connected iPad can briefly be
      // unavailable. Surface a retry instead of keeping the person in an
      // unexplained loading state.
      const current = selectedDevice();
      if (current?.platform === "ios" && current.serial === device.serial) {
        setAppleSetupCheckFailed(true);
      }
    });
  });
  const recordState = (): Parameters<typeof GraphEmptyState>[0]["recordState"] => {
    const device = selectedDevice();
    if (device?.platform === "ios" && appleSetupCheckFailed()) return "setup-check-failed";
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
    if (recorder.recording()) return { label: "Recording", kind: "recording" } as const;
    if (!selectedDevice()) return { label: "Device", kind: "idle" } as const;
    if (server.health() !== "online") return { label: "Relay offline", kind: "attention" } as const;
    switch (recordState()) {
      case "ready":
        return { label: "Live", kind: "ready" } as const;
      case "checking-ios":
        return { label: "Checking device", kind: "progress" } as const;
      case "preparing-ios":
        return { label: "Preparing device", kind: "progress" } as const;
      case "preparing-screen":
        return { label: "Starting live view", kind: "progress" } as const;
      case "device-unavailable":
        return { label: "Device unavailable", kind: "attention" } as const;
      case "capture-error":
        return { label: "Screen unavailable", kind: "attention" } as const;
      case "enable-developer-mode":
      case "setup-check-failed":
      case "setup-ios":
        return { label: "Device setup needed", kind: "attention" } as const;
      default:
        return { label: "Starting live view", kind: "progress" } as const;
    }
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
  const connections = createMemo(() => canvasConnections(tree(), draft.steps(), metadata().value));
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = createSignal<string | null>(null);
  const [keyboardConnectionSourceId, setKeyboardConnectionSourceId] = createSignal<string | null>(
    null,
  );
  const [startCaptureBusy, setStartCaptureBusy] = createSignal(false);
  const [capturedScreenUrls, setCapturedScreenUrls] = createSignal<Record<string, string>>({});
  const [connectionPreview, setConnectionPreview] = createSignal<CanvasPoint | null>(null);
  const [renamingNodeId, setRenamingNodeId] = createSignal<string | null>(null);
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [proposalReviewOpen, setProposalReviewOpen] = createSignal(false);
  const [proposalBusyId, setProposalBusyId] = createSignal<string>();
  const [proposalError, setProposalError] = createSignal<string>();
  const [caseStackBusy, setCaseStackBusy] = createSignal(false);
  const [captureOpen, setCaptureOpen] = createSignal(false);
  const [captureClosing, setCaptureClosing] = createSignal(false);
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
  const [canvasHistory, setCanvasHistory] = createSignal({ undo: false, redo: false });
  const [canvasTool, setCanvasTool] = createSignal<"select" | "hand">("select");
  const [remoteAwareness, setRemoteAwareness] = createSignal<readonly CollaborationAwareness[]>([]);
  const [localCursor, setLocalCursor] = createSignal<CanvasPoint | undefined>();
  let canvas: HTMLElement | undefined;
  let journeyDocument: JourneyDocument | null = null;
  let collaborationRuntime: JourneyCollaborationRuntime | null = null;
  let unsubscribeJourneyDocument: (() => void) | undefined;
  let unsubscribeAwareness: (() => void) | undefined;
  let pan: { x: number; y: number; view: CanvasViewport } | undefined;
  let nodeDrag:
    | { id: string; x: number; y: number; origin: CanvasPoint; moved: boolean }
    | undefined;
  let noteDrag:
    | { id: string; x: number; y: number; origin: CanvasPoint; moved: boolean }
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
  let recordingSourceScreenId: string | null = null;
  let recordRequestedAfterDeviceSelection = false;
  let deviceAutoOpenedForMap = "";
  let initiallyFittedAppMapId = "";
  let metadataSaveSequence = 0;
  let destinationResolvedForTake = "";
  let captureCloseTimer: number | undefined;

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
    setHistoryOpen(false);
    setAgentOpen(false);
    setCaptureOpen(true);
  };

  const openDevicePicker = () => {
    if (captureCloseTimer) window.clearTimeout(captureCloseTimer);
    captureCloseTimer = undefined;
    setCaptureClosing(false);
    setHistoryOpen(false);
    setCaptureOpen(true);
    // DevicePicker subscribes when the companion mounts. Wait one frame so a
    // request made from the canvas can never race that subscription.
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("relay:open-device-picker")));
  };
  onCleanup(() => {
    if (captureCloseTimer) window.clearTimeout(captureCloseTimer);
  });

  const closeJourneyDocument = () => {
    unsubscribeAwareness?.();
    unsubscribeAwareness = undefined;
    unsubscribeJourneyDocument?.();
    unsubscribeJourneyDocument = undefined;
    collaborationRuntime?.destroy();
    collaborationRuntime = null;
    journeyDocument?.destroy();
    journeyDocument = null;
    setRemoteAwareness([]);
    setLocalCursor(undefined);
  };

  const openJourneyDocument = (journeyId: string, value: JourneyMetadata) => {
    closeJourneyDocument();
    const document = createJourneyDocument(value);
    journeyDocument = document;
    unsubscribeJourneyDocument = document.subscribe((next, origin) => {
      const remoteCollaborationOrigin =
        typeof origin === "object" &&
        origin !== null &&
        (origin as { type?: string }).type === "relay-collaboration-remote";
      if (!remoteCollaborationOrigin) return;
      setMetadata((current) => ({
        ...current,
        revision: current.revision + 1,
        value: next,
        updatedAt: Date.now(),
      }));
      setCanvasHistory({ undo: document.canUndo(), redo: document.canRedo() });
    });
    collaborationRuntime = server.createJourneyCollaboration(journeyId, document.doc);
    unsubscribeAwareness = collaborationRuntime.subscribeAwareness(setRemoteAwareness);
    void collaborationRuntime.start().catch((error: unknown) => {
      toast(error instanceof Error ? error.message : "Collaboration could not connect", "warning");
    });
  };

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
    setSelectedConnectionId(null);
    setKeyboardConnectionSourceId(null);
    setCapturedScreenUrls({});
    setRenamingNodeId(null);
    setHistoryOpen(false);
    setCaptureOpen(false);
    appliedCanonicalRevision = "";
    if (!appMapId) {
      closeJourneyDocument();
      setLoadedAppMapId(null);
      setAppMapLoadState({ status: "idle" });
      setCanvasHistory({ undo: false, redo: false });
      setMetadata({ revision: 0, value: EMPTY_JOURNEY_METADATA, updatedAt: 0 });
      return;
    }
    closeJourneyDocument();
    setLoadedAppMapId(null);
    setAppMapLoadState({ status: "loading", appMapId });
    void server
      .loadJourney(appMapId)
      .then((next) => {
        if (server.selectedAppMapId() === appMapId) {
          setMetadata(next);
          openJourneyDocument(appMapId, next.value);
          setCanvasHistory({ undo: false, redo: false });
          setLoadedAppMapId(appMapId);
          setAppMapLoadState({ status: "ready", appMapId });
        }
      })
      .catch(() => {
        if (server.selectedAppMapId() === appMapId) {
          setCanvasHistory({ undo: false, redo: false });
          setAppMapLoadState({ status: "error", appMapId });
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
    const current = metadata();
    const value = mergeAppMapProjection(current.value, appMap);
    if (
      JSON.stringify(value.graph) === JSON.stringify(current.value.graph) &&
      JSON.stringify(value.positions) === JSON.stringify(current.value.positions) &&
      JSON.stringify(value.screenTitles) === JSON.stringify(current.value.screenTitles)
    ) {
      return;
    }
    journeyDocument?.replace(value, "remote");
    setMetadata({ ...current, value, updatedAt: Math.max(current.updatedAt, appMap.updatedAt) });
  });

  // A blank journey starts with its device companion visible: the first screen
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
  // drawer must follow that state so a fresh journey never appears to be an
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
  onCleanup(closeJourneyDocument);

  const positions = () => metadata().value.positions;
  const titleFor = (node: JourneyTreeNode) =>
    metadata().value.screenTitles?.[node.id]?.trim() || node.title;
  const hasCanvasContent = () => hasMap() || (metadata().value.notes?.length ?? 0) > 0;
  const positionFor = (node: JourneyTreeNode): CanvasPoint => positions()[node.id] ?? node;
  const selectedNode = createMemo(
    () => tree().nodes.find((node) => node.id === selectedNodeId()) ?? null,
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
    journeyRunReadiness({
      graph: graph(),
      recipeSteps: draft.steps(),
      selection: {
        screenId: selectedNodeId(),
        transitionId: selectedConnectionId(),
      },
    }),
  );
  const runJourneyGraph = () => {
    const appMap = activeAppMap();
    const flow = appMap ? Object.values(appMap.flows)[0] : undefined;
    if (!appMap || !flow) {
      toast("Add and verify a connection before running this flow", "info");
      return;
    }
    void server.runAppMapFlowRemote(appMap.id, flow.id, flow.name);
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
    canvasBounds(tree().nodes, metadata().value.notes ?? [], positionFor),
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

  createEffect(() => {
    const appMapId = loadedAppMapId();
    const runtime = collaborationRuntime;
    const element = canvas;
    const currentView = view();
    if (!appMapId || !runtime?.enabled || !element) return;
    runtime.updateAwareness({
      activity: collaborationActivity({
        recording: recorder.recording(),
        running: server.running(),
        editing: Boolean(selectedNodeId() || selectedConnectionId() || localCursor()),
      }),
      ...(localCursor() ? { cursor: localCursor() } : {}),
      ...(selectedNodeId()
        ? { selection: { screenId: selectedNodeId()! } }
        : selectedConnectionId()
          ? { selection: { connectionId: selectedConnectionId()! } }
          : {}),
      viewport: {
        x: currentView.x,
        y: currentView.y,
        zoom: currentView.scale,
        width: element.clientWidth,
        height: element.clientHeight,
      },
    });
  });

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
  const selectNode = (node: JourneyTreeNode) => {
    setSelectedNodeId(node.id);
    setSelectedConnectionId(null);
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
  function syncCanonicalProjection(value: JourneyMetadata): void {
    const appMapId = server.selectedAppMapId();
    if (!appMapId) return;
    canonicalProjectionQueue = canonicalProjectionQueue
      .then(async () => {
        let appMap;
        try {
          appMap = await server.loadAppMap(appMapId);
        } catch {
          return;
        }
        const projectedGraph = ensureJourneyGraph(value, draft.steps());
        const changes = planAppMapProjection({
          appMap,
          graph: projectedGraph,
          positions: value.positions,
          recipeSteps: draft.steps(),
        });
        for (const change of changes) {
          if (change.kind === "screen.add") {
            appMap = (
              await server.runAction("app-map.screen.add", {
                appMapId,
                expectedRevision: appMap.revision,
                input: { screen: change.screen },
              })
            ).appMap;
          } else if (change.kind === "screen.update") {
            appMap = (
              await server.runAction("app-map.screen.update", {
                appMapId,
                screenId: change.screenId,
                expectedRevision: appMap.revision,
                input: { patch: change.patch },
              })
            ).appMap;
          } else if (change.kind === "connection.create") {
            appMap = (
              await server.runAction("app-map.connection.create", {
                appMapId,
                expectedRevision: appMap.revision,
                connection: change.connection,
              })
            ).appMap;
          } else if (change.kind === "connection.update") {
            appMap = (
              await server.runAction("app-map.connection.update", {
                appMapId,
                connectionId: change.connectionId,
                expectedRevision: appMap.revision,
                patch: change.patch,
              })
            ).appMap;
          } else {
            appMap = (
              await server.runAction("app-map.flow.save", {
                appMapId,
                flowId: change.flow.id,
                expectedRevision: appMap.revision,
                flow: change.flow,
              })
            ).appMap;
          }
        }
        if (changes.length) await server.refreshAppMaps();
      })
      .catch((error) => {
        toast(
          `Canvas saved, but its shared App Map projection needs attention: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      });
  }
  const applyRemoteMetadata = (next: Revisioned<JourneyMetadata>) => {
    journeyDocument?.replace(next.value, "remote");
    setCanvasHistory({
      undo: journeyDocument?.canUndo() ?? false,
      redo: journeyDocument?.canRedo() ?? false,
    });
    setMetadata(next);
    syncCanonicalProjection(next.value);
  };
  const persistMetadata = (value: JourneyMetadata) => {
    const appMapId = server.selectedAppMapId();
    if (!appMapId) return;
    const current = metadata();
    const nextValue = journeyDocument?.replace(value) ?? value;
    setCanvasHistory({
      undo: journeyDocument?.canUndo() ?? false,
      redo: journeyDocument?.canRedo() ?? false,
    });
    setMetadata({
      ...current,
      revision: current.revision + 1,
      value: nextValue,
      updatedAt: Date.now(),
    });
    syncCanonicalProjection(nextValue);
    // When opted in, the provider is the only canvas writer. The revisioned
    // compatibility document remains the sole writer while collaboration is disabled.
    if (collaborationRuntime?.enabled) return;
    const sequence = ++metadataSaveSequence;
    void server
      .saveJourney(appMapId, current, nextValue)
      .then((next) => {
        if (sequence === metadataSaveSequence) applyRemoteMetadata(next);
      })
      .catch(() => {
        if (sequence === metadataSaveSequence) applyRemoteMetadata(current);
      });
  };
  const persistPositions = (next: Record<string, CanvasPoint>) =>
    persistMetadata(withJourneyGraph({ ...metadata().value, positions: next }, graph()));
  const persistNotes = (notes: JourneyCanvasNote[]) => {
    if (!server.selectedAppMapId()) return;
    persistMetadata(withJourneyGraph({ ...metadata().value, notes }, graph()));
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
    persistMetadata(withJourneyGraph(metadata().value, next));
    setTargetSetOpen(false);
  };
  const decideProposal = async (proposalId: string, decision: "approve" | "reject") => {
    const appMap = activeAppMap();
    if (!appMap || proposalBusyId()) return;
    setProposalBusyId(proposalId);
    setProposalError();
    try {
      await server.runAction(`app-map.proposal.${decision}` as const, {
        appMapId: appMap.id,
        proposalId,
        expectedRevision: appMap.revision,
      });
      await server.refreshAppMaps();
      toast(decision === "approve" ? "Proposal added to the map" : "Proposal rejected", "success");
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : String(error));
    } finally {
      setProposalBusyId();
    }
  };
  const useCurrentScreenAsStart = async () => {
    if (startCaptureBusy() || hasMap()) return;
    setStartCaptureBusy(true);
    try {
      const captured = await recorder.captureStartScreen();
      if (!captured || hasMap()) return;
      const added = addJourneyStartScreen(graph(), captured.observation);
      persistMetadata(withJourneyGraph(metadata().value, added.graph));
      if (captured.screenshotUrl) {
        setCapturedScreenUrls((urls) => ({ ...urls, [added.screen.id]: captured.screenshotUrl! }));
      }
      setSelectedNodeId(added.screen.id);
      setSelectedConnectionId(null);
      setCaptureOpen(false);
      toast("Start screen added", "success");
    } finally {
      setStartCaptureBusy(false);
    }
  };
  const captureCurrentScreen = async () => {
    if (!canReplayOnDevice() || startCaptureBusy()) return;
    setStartCaptureBusy(true);
    try {
      const captured = await recorder.captureStartScreen();
      if (!captured) return;
      const added = addJourneyGraphScreen(graph(), captured.observation);
      persistMetadata(withJourneyGraph(metadata().value, added.graph));
      if (captured.screenshotUrl) {
        setCapturedScreenUrls((urls) => ({ ...urls, [added.screen.id]: captured.screenshotUrl! }));
      }
      const node = buildJourneyGraphTree(added.graph, draft.steps()).nodes.find(
        (candidate) => candidate.id === added.screen.id,
      );
      if (node) selectNode(node);
      toast(added.created ? "Screen added to the map" : "Existing screen refreshed", "success");
    } finally {
      setStartCaptureBusy(false);
    }
  };
  let automaticStartCaptureHandled = false;
  createEffect(() => {
    if (
      automaticStartCaptureHandled ||
      !props.captureStartOnReady ||
      loadedAppMapId() !== server.selectedAppMapId() ||
      hasMap() ||
      !canRecord() ||
      startCaptureBusy()
    )
      return;
    automaticStartCaptureHandled = true;
    props.onCaptureStartHandled?.();
    void useCurrentScreenAsStart();
  });
  const addNote = () => {
    const element = canvas;
    const current = view();
    const x = element ? (element.clientWidth * 0.52 - current.x) / current.scale : 320;
    const y = element ? (element.clientHeight * 0.42 - current.y) / current.scale : 180;
    const at = Date.now();
    const id = `note-${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? at.toString(36)}`;
    persistNotes([
      ...(metadata().value.notes ?? []),
      { id, text: "Add context for this part of the map", x, y, createdAt: at, updatedAt: at },
    ]);
  };
  let automaticFirstNoteHandled = false;
  createEffect(() => {
    if (
      automaticFirstNoteHandled ||
      !props.addNoteOnReady ||
      loadedAppMapId() !== server.selectedAppMapId()
    )
      return;
    automaticFirstNoteHandled = true;
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
  const recordFromNode = (screen: JourneyTreeNode | null) => {
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
      attachTransitionSteps(metadata().value, connection.id, inserted, mode, Date.now()),
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
            metadata().value,
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
          metadata().value,
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
        metadata().value,
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
      metadata().value,
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
      metadata().value,
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
    persistMetadata(removeAuthoredConnection(metadata().value, connection.id));
    setSelectedConnectionId(null);
    queueCanonicalRemoval({ connectionIds: [connection.id] });
  };
  const queueCanonicalRemoval = (input: { connectionIds?: string[]; screenId?: string }) => {
    const appMapId = server.selectedAppMapId();
    if (!appMapId) return;
    canonicalProjectionQueue = canonicalProjectionQueue
      .then(async () => {
        let appMap = await server.loadAppMap(appMapId);
        const connectionIds = new Set(input.connectionIds ?? []);
        if (input.screenId) {
          for (const connection of Object.values(appMap.connections)) {
            if (
              connection.fromScreenId === input.screenId ||
              (connection.destination.kind === "screen" &&
                connection.destination.screenId === input.screenId)
            ) {
              connectionIds.add(connection.id);
            }
          }
        }
        for (const flow of Object.values(appMap.flows)) {
          if (input.screenId && flow.startScreenId === input.screenId) {
            appMap = (
              await server.runAction("app-map.flow.remove", {
                appMapId,
                flowId: flow.id,
                expectedRevision: appMap.revision,
              })
            ).appMap;
            continue;
          }
          const nextConnectionIds = flow.connectionIds.filter((id) => !connectionIds.has(id));
          if (nextConnectionIds.length !== flow.connectionIds.length) {
            appMap = (
              await server.runAction("app-map.flow.save", {
                appMapId,
                flowId: flow.id,
                expectedRevision: appMap.revision,
                flow: { ...flow, connectionIds: nextConnectionIds, updatedAt: Date.now() },
              })
            ).appMap;
          }
        }
        for (const connectionId of connectionIds) {
          if (!appMap.connections[connectionId]) continue;
          appMap = (
            await server.runAction("app-map.connection.remove", {
              appMapId,
              connectionId,
              expectedRevision: appMap.revision,
            })
          ).appMap;
        }
        if (input.screenId && appMap.screens[input.screenId]) {
          appMap = (
            await server.runAction("app-map.screen.remove", {
              appMapId,
              screenId: input.screenId,
              expectedRevision: appMap.revision,
            })
          ).appMap;
        }
        await server.refreshAppMaps();
      })
      .catch(async (error) => {
        toast(
          error instanceof Error ? error.message : "This map item could not be removed safely",
          "warning",
        );
        await server.refreshAppMaps();
      });
  };
  const removeScreen = (node: JourneyTreeNode) => {
    const current = metadata().value;
    const nextGraph = removeJourneyGraphScreen(graph(), node.id);
    const nextPositions = { ...current.positions };
    const nextTitles = { ...current.screenTitles };
    delete nextPositions[node.id];
    delete nextTitles[node.id];
    persistMetadata(
      withJourneyGraph(
        { ...current, positions: nextPositions, screenTitles: nextTitles },
        nextGraph,
      ),
    );
    setSelectedNodeId(null);
    queueCanonicalRemoval({ screenId: node.id });
  };
  const renameScreen = (node: JourneyTreeNode, title: string) => {
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
      withJourneyGraph(
        {
          ...metadata().value,
          screenTitles: { ...metadata().value.screenTitles, [node.id]: next },
        },
        nextGraph,
      ),
    );
    setRenamingNodeId(null);
  };
  const undo = () => {
    if (journeyDocument?.canUndo()) {
      const current = metadata();
      const value = journeyDocument.undoOnce();
      setCanvasHistory({ undo: journeyDocument.canUndo(), redo: journeyDocument.canRedo() });
      setMetadata({ ...current, revision: current.revision + 1, value, updatedAt: Date.now() });
      const appMapId = server.selectedAppMapId();
      if (collaborationRuntime?.enabled) return;
      const sequence = ++metadataSaveSequence;
      if (appMapId)
        void server
          .saveJourney(appMapId, current, value)
          .then((next) => sequence === metadataSaveSequence && applyRemoteMetadata(next));
      return;
    }
    draft.undo();
  };
  const redo = () => {
    if (journeyDocument?.canRedo()) {
      const current = metadata();
      const value = journeyDocument.redoOnce();
      setCanvasHistory({ undo: journeyDocument.canUndo(), redo: journeyDocument.canRedo() });
      setMetadata({ ...current, revision: current.revision + 1, value, updatedAt: Date.now() });
      const appMapId = server.selectedAppMapId();
      if (collaborationRuntime?.enabled) return;
      const sequence = ++metadataSaveSequence;
      if (appMapId)
        void server
          .saveJourney(appMapId, current, value)
          .then((next) => sequence === metadataSaveSequence && applyRemoteMetadata(next));
      return;
    }
    draft.redo();
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
    onRunMap: runJourneyGraph,
    onCloseTargetSet: () => setTargetSetOpen(false),
    onUndoRequest: (event, shouldRedo) => {
      if (shouldRedo) {
        if (!journeyDocument?.canRedo()) return;
        event.preventDefault();
        redo();
        return;
      }
      if (!journeyDocument?.canUndo()) return;
      event.preventDefault();
      undo();
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
      if (agentOpen()) {
        setAgentOpen(false);
        return;
      }
      setSelectedNodeId(null);
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
          ref={(element) => {
            canvas = element;
          }}
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
            if (!target.closest("[data-journey-screen-id], aside, button, input, textarea")) {
              setSelectedNodeId(null);
              setSelectedConnectionId(null);
            }
            const wantsPan = canvasTool() === "hand" || event.button === 1;
            if (!hasCanvasContent() || !wantsPan || target.closest("button")) return;
            pan = { x: event.clientX, y: event.clientY, view: view() };
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setLocalCursor({
              x: (event.clientX - rect.left - view().x) / view().scale,
              y: (event.clientY - rect.top - view().y) / view().scale,
            });
            if (connectionDrag) {
              connectionDrag.point = {
                x: (event.clientX - rect.left - view().x) / view().scale,
                y: (event.clientY - rect.top - view().y) / view().scale,
              };
              // This is intentionally a tiny reactive state change, rather than
              // persisting on every pointer event. The route becomes real only on drop.
              setConnectionPreview({ ...connectionDrag.point });
              return;
            }
            if (nodeDrag) {
              const moved = Math.hypot(event.clientX - nodeDrag.x, event.clientY - nodeDrag.y) > 4;
              if (!moved && !nodeDrag.moved) return;
              nodeDrag.moved = true;
              const next = {
                ...positions(),
                [nodeDrag.id]: {
                  x: nodeDrag.origin.x + (event.clientX - nodeDrag.x) / view().scale,
                  y: nodeDrag.origin.y + (event.clientY - nodeDrag.y) / view().scale,
                },
              };
              setMetadata((current) => ({
                ...current,
                value: { ...current.value, positions: next },
              }));
              return;
            }
            if (noteDrag) {
              const moved = Math.hypot(event.clientX - noteDrag.x, event.clientY - noteDrag.y) > 4;
              if (!moved && !noteDrag.moved) return;
              noteDrag.moved = true;
              const next = (metadata().value.notes ?? []).map((note) =>
                note.id === noteDrag!.id
                  ? {
                      ...note,
                      x: noteDrag!.origin.x + (event.clientX - noteDrag!.x) / view().scale,
                      y: noteDrag!.origin.y + (event.clientY - noteDrag!.y) / view().scale,
                      updatedAt: Date.now(),
                    }
                  : note,
              );
              setMetadata((current) => ({
                ...current,
                value: { ...current.value, notes: next },
              }));
              return;
            }
            if (!pan) return;
            setView({
              ...pan.view,
              x: pan.view.x + event.clientX - pan.x,
              y: pan.view.y + event.clientY - pan.y,
            });
          }}
          onPointerUp={(event) => {
            if (connectionDrag) {
              const source = connectionDrag.fromScreenId;
              const hit = document.elementFromPoint(event.clientX, event.clientY);
              const target = hit?.closest<HTMLElement>("[data-journey-screen-id]")?.dataset
                .journeyScreenId;
              let next: JourneyMetadata | null = null;
              if (target && target !== source) {
                next = addPlannedConnection(
                  metadata().value,
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
                  metadata().value,
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
            if (nodeDrag?.moved) persistPositions(positions());
            if (noteDrag?.moved) persistNotes(metadata().value.notes ?? []);
            nodeDrag = undefined;
            noteDrag = undefined;
            pan = undefined;
          }}
          onPointerCancel={() => {
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
            targetSetOpen={targetSetOpen()}
            activeTargetSetId={activeFlow()?.targetSetId}
            runTargetLabel={activeTargetSet()?.name ?? selectedDevice()?.name ?? "Current device"}
            targetSets={server.matrices()}
            onViewChange={(next) => {
              setWorkspaceView(next);
              setHistoryOpen(false);
              setKeyboardConnectionSourceId(null);
            }}
            onTargetSetOpenChange={setTargetSetOpen}
            onChooseTargetSet={chooseTargetSet}
            onManageTargetSets={() => {
              setTargetSetOpen(false);
              props.onOpenTargets();
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
              onClose={() => setProposalReviewOpen(false)}
            />
          </Show>
          <Show when={agentOpen() && activeAppMap()}>
            {(appMap) => (
              <AppMapAgentPanel
                appMap={appMap()}
                onClose={() => setAgentOpen(false)}
                onProposalReady={() => {
                  setAgentOpen(false);
                  setProposalReviewOpen(true);
                }}
              />
            )}
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
                        ""
                      );
                    }}
                    stateForScreen={(screenId) => runProjection().screens[screenId]?.state}
                    onOpenScreen={(screenId) => {
                      setWorkspaceView("map");
                      setSelectedNodeId(screenId);
                      setSelectedConnectionId(null);
                      queueMicrotask(fit);
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
                  />
                )}
              </Show>
            }
          >
            <Show when={historyOpen()}>
              <JourneyHistoryPanel
                loading={draft.historyLoading()}
                entries={draft.savedHistory()}
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
                <GraphEmptyState
                  take={recorder.take()}
                  recordState={recordState()}
                  selectedDeviceName={
                    selectedDevice()?.name ?? server.selectedDevice() ?? undefined
                  }
                  deviceOpen={captureOpen()}
                  deviceSelected={Boolean(selectedDevice())}
                  liveScreenSrc={liveScreenSrc()}
                  captureBusy={startCaptureBusy()}
                  onUseCurrentScreen={() => void useCurrentScreenAsStart()}
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
                  notes={metadata().value.notes ?? []}
                  width={bounds().width}
                  height={bounds().height}
                  selectedNodeId={selectedNodeId()}
                  selectedConnectionId={selectedConnectionId()}
                  renamingNodeId={renamingNodeId()}
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
                  stepFor={(node) => draft.steps()[node.representativeStepIndex]}
                  imageFor={(node) =>
                    screenshotUrl(server, draft.steps()[node.representativeStepIndex]) ||
                    capturedScreenUrls()[node.id] ||
                    ""
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
                  onSelectConnection={(connection) => {
                    setSelectedConnectionId(connection.id);
                    setSelectedNodeId(null);
                  }}
                  onRenameNode={(node) => setRenamingNodeId(node.id)}
                  onCommitNodeRename={renameScreen}
                  onConnectStart={(event, node) => beginConnection(event, node.id)}
                  onConnectKeyboard={(node) => {
                    selectNode(node);
                    setKeyboardConnectionSourceId(node.id);
                  }}
                  onNodePointerDown={(event, node) => {
                    if (canvasTool() === "hand") {
                      event.stopPropagation();
                      pan = { x: event.clientX, y: event.clientY, view: view() };
                      canvas?.setPointerCapture(event.pointerId);
                      return;
                    }
                    event.stopPropagation();
                    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
                    nodeDrag = {
                      id: node.id,
                      x: event.clientX,
                      y: event.clientY,
                      origin: positionFor(node),
                      moved: false,
                    };
                  }}
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
                    };
                  }}
                  onNoteText={(note, text) =>
                    setMetadata((current) => ({
                      ...current,
                      value: {
                        ...current.value,
                        notes: (current.value.notes ?? []).map((entry) =>
                          entry.id === note.id ? { ...entry, text, updatedAt: Date.now() } : entry,
                        ),
                      },
                    }))
                  }
                  onCommitNote={() => persistNotes(metadata().value.notes ?? [])}
                  onDeleteNote={(note) =>
                    persistNotes(
                      (metadata().value.notes ?? []).filter((entry) => entry.id !== note.id),
                    )
                  }
                />
              </div>
              <Show when={!captureOpen()}>
                <Show
                  when={selectedConnection()}
                  fallback={
                    <ScreenInspector
                      node={selectedNode()}
                      title={selectedNode() ? titleFor(selectedNode()!) : ""}
                      connections={connections().filter(
                        (connection) => connection.fromScreenId === selectedNode()?.id,
                      )}
                      onSelectConnection={(connection) => {
                        setSelectedConnectionId(connection.id);
                        setSelectedNodeId(null);
                      }}
                      onRemove={() => {
                        const node = selectedNode();
                        if (node) removeScreen(node);
                      }}
                      onClose={() => setSelectedNodeId(null)}
                    />
                  }
                >
                  {(connection) => (
                    <ConnectionInspector
                      connection={connection()}
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
                          if (index >= 0) selectStep(index);
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
                canUndo={canvasHistory().undo || draft.canUndo()}
                canRedo={canvasHistory().redo || draft.canRedo()}
                historyOpen={historyOpen()}
                onToolChange={setCanvasTool}
                onCaptureScreen={() => void captureCurrentScreen()}
                onCreateConnection={() => {
                  const node = selectedNode();
                  if (node) setKeyboardConnectionSourceId(node.id);
                  else toast("Select the screen where this connection begins", "info");
                }}
                onUndo={undo}
                onRedo={redo}
                onToggleHistory={() => {
                  const opening = !historyOpen();
                  if (opening) setCaptureOpen(false);
                  setHistoryOpen(opening);
                }}
                onAddNote={addNote}
                onCreateRoutine={() => {
                  const connection = selectedConnection();
                  if (connection) void saveReusableBehavior(connection);
                  else toast("Select a connection to turn it into a Routine", "info");
                }}
                onExplore={() => {
                  closeCapturePanel();
                  setHistoryOpen(false);
                  setAgentOpen(true);
                }}
                onToggleDevice={() => (captureOpen() ? closeCapturePanel() : openCapturePanel())}
              />
              <AppMapZoomControls
                percentage={Math.round(view().scale * 100)}
                onZoomOut={() => zoom(-0.1)}
                onZoomIn={() => zoom(0.1)}
                onFit={fit}
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
                ? "Capture screen"
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
              void useCurrentScreenAsStart();
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
        />
      </Show>
      <Show when={appMapLoadState().status !== "ready"}>
        <AppMapLoadFeedback
          status={appMapLoadState().status === "error" ? "error" : "loading"}
          onRetry={() => setAppMapLoadAttempt((attempt) => attempt + 1)}
        />
      </Show>
    </section>
  );
}

function AppMapLoadFeedback(props: { status: "loading" | "error"; onRetry: () => void }) {
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
            {props.status === "error" ? "This map couldn’t be opened" : "Opening map…"}
          </h2>
          <p class="m-0 text-[12.5px]/[1.55] text-[var(--text-weak)]">
            {props.status === "error"
              ? "Your saved map has not been replaced. Check Relay’s connection and try again."
              : "Loading its screens, connections, and evidence."}
          </p>
        </div>
        <Show when={props.status === "error"}>
          <button
            type="button"
            class="canvas-tool-control inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-[var(--product-accent-soft)] px-4 text-[12px] font-semibold text-[var(--text-interactive-base)] outline-none transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-white/70"
            onClick={props.onRetry}
          >
            <Icon name="refresh" size={13} /> Try again
          </button>
        </Show>
      </section>
    </div>
  );
}

function screenshotUrl(server: ReturnType<typeof useServer>, step: RecipeStep | undefined): string {
  const screenshot = evidenceForStep(step)?.screenshot;
  return screenshot ? server.recordingEvidenceUrl(screenshot.recipeId, screenshot.id) : "";
}
