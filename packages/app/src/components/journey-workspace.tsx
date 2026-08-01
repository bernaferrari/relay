import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type {
  JourneyCanvasNote,
  JourneyMetadata,
  JourneyVideoClip,
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
  addJourneyStartScreen,
  buildJourneyGraphTree,
  ensureJourneyGraph,
  screenForObservation,
  type TakeDestination,
  withJourneyGraph,
} from "../lib/journey-graph";
import { EMPTY_JOURNEY_METADATA } from "../lib/journey-metadata";
import {
  canvasBounds,
  canvasEdgeGeometry,
  clampCanvasScale,
  draftCanvasConnectionPath,
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
import { DeviceStage } from "./stage";
import { DevicePicker } from "./device-picker";
import { Icon } from "./icon";
import { evidenceForStep } from "./journey-step-presentation";
import {
  GraphEmptyState,
  RecordedTakePlayer,
  TakeCaptureBar,
  TakeReviewSidebar,
} from "./journey-capture-review";
import {
  CanvasNote,
  ConnectionInspector,
  KeyboardConnectionChooser,
  ScreenCard,
  ScreenInspector,
} from "./journey-canvas-primitives";
import { JourneyHistoryPanel } from "./journey-history-panel";
import { CollaborationPresence } from "./collaboration-presence";
import { collaborationActivity } from "../lib/collaboration-awareness";
import type { JourneyCollaborationRuntime } from "../lib/journey-collaboration-runtime";

/**
 * The graph is the authoring surface for a journey. A card is a captured
 * screen; the small actions attached to it are the things a person can do
 * there. Recording remains the only way to create the real transitions, so
 * the canvas never promises a route that the runner cannot execute.
 */
export function JourneyWorkspace(props: {
  onOpenTargets: () => void;
  onOpenActions: () => void;
  navigatorOpen?: boolean;
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
  const [loadedRecipeId, setLoadedRecipeId] = createSignal<string | null>(null);
  const graph = createMemo(() => ensureJourneyGraph(metadata().value, draft.steps()));
  const tree = createMemo(() => buildJourneyGraphTree(graph(), draft.steps()));
  const hasMap = () => tree().nodes.length > 0;
  const selectedDevice = createMemo(
    () => server.devices().find((device) => device.serial === server.selectedDevice()) ?? null,
  );
  const graphRunJob = createMemo(() => {
    const recipeId = server.selectedRecipeId();
    if (!recipeId) return null;
    return (
      server
        .jobs()
        .find(
          (job) =>
            job.action === recipeId &&
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
  let deviceAutoOpenedForRecipe = "";
  let fittedSignature = "";
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
    const recipeId = server.selectedRecipeId();
    deviceAutoOpenedForRecipe = "";
    setSelectedNodeId(null);
    setSelectedConnectionId(null);
    setKeyboardConnectionSourceId(null);
    setCapturedScreenUrls({});
    setRenamingNodeId(null);
    setHistoryOpen(false);
    setCaptureOpen(false);
    if (!recipeId) {
      closeJourneyDocument();
      setLoadedRecipeId(null);
      setCanvasHistory({ undo: false, redo: false });
      setMetadata({ revision: 0, value: EMPTY_JOURNEY_METADATA, updatedAt: 0 });
      return;
    }
    setLoadedRecipeId(null);
    void server
      .loadJourney(recipeId)
      .then((next) => {
        if (server.selectedRecipeId() === recipeId) {
          setMetadata(next);
          openJourneyDocument(recipeId, next.value);
          setCanvasHistory({ undo: false, redo: false });
          setLoadedRecipeId(recipeId);
        }
      })
      .catch(() => {
        if (server.selectedRecipeId() === recipeId) {
          setMetadata({ revision: 0, value: EMPTY_JOURNEY_METADATA, updatedAt: 0 });
          openJourneyDocument(recipeId, EMPTY_JOURNEY_METADATA);
          setCanvasHistory({ undo: false, redo: false });
          setLoadedRecipeId(recipeId);
        }
      });
  });
  // A blank journey starts with its device companion visible: the first screen
  // is established there, not through a modal or a second empty-state CTA.
  // Populated maps keep the canvas unobstructed until Device is requested.
  createEffect(() => {
    const recipeId = server.selectedRecipeId();
    if (
      !recipeId ||
      loadedRecipeId() !== recipeId ||
      props.navigatorOpen ||
      hasMap() ||
      deviceAutoOpenedForRecipe === recipeId
    )
      return;
    deviceAutoOpenedForRecipe = recipeId;
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
    deviceAutoOpenedForRecipe = "";
    setCaptureOpen(false);
  });

  createEffect(() => {
    window.dispatchEvent(
      new CustomEvent("relay:device-panel-state", {
        detail: { open: captureOpen() && !reviewingTake() },
      }),
    );
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

  onMount(() => {
    const onDeviceSelected = () => {
      if (!recordRequestedAfterDeviceSelection) return;
      recordRequestedAfterDeviceSelection = false;
      setWaitingForRecordTarget(true);
    };
    window.addEventListener("relay:device-selected", onDeviceSelected);
    const onToggleDevicePanel = () => {
      setHistoryOpen(false);
      if (captureOpen()) closeCapturePanel();
      else setCaptureOpen(true);
    };
    const onCloseDevicePanel = closeCapturePanel;
    const onRunJourneyGraph = () => runJourneyGraph();
    window.addEventListener("relay:toggle-device-panel", onToggleDevicePanel);
    window.addEventListener("relay:close-device-panel", onCloseDevicePanel);
    window.addEventListener("relay:run-journey-graph", onRunJourneyGraph);
    onCleanup(() => {
      window.removeEventListener("relay:device-selected", onDeviceSelected);
      window.removeEventListener("relay:toggle-device-panel", onToggleDevicePanel);
      window.removeEventListener("relay:close-device-panel", onCloseDevicePanel);
      window.removeEventListener("relay:run-journey-graph", onRunJourneyGraph);
    });
  });

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
  createEffect(() => {
    window.dispatchEvent(
      new CustomEvent("relay:graph-run-readiness", { detail: graphRunReadiness() }),
    );
  });
  const runJourneyGraph = () => {
    const recipeId = server.selectedRecipeId();
    const flow = graph().flows[0];
    if (!recipeId || !flow) {
      toast("Add and verify a connection before running this journey", "info");
      return;
    }
    const readiness = graphRunReadiness();
    const transitionPath = readiness.transitionPath;
    if (!readiness.ready || !transitionPath) {
      toast(readiness.reason, "info");
      return;
    }
    void server.runJourneyPathRemote(recipeId, flow.name, transitionPath);
  };
  const reusableBehaviors = createMemo(() =>
    server
      .recipes()
      .filter(
        (recipe) =>
          recipe.source === "custom" &&
          recipe.id !== server.selectedRecipeId() &&
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
    const journeyId = loadedRecipeId();
    const runtime = collaborationRuntime;
    const element = canvas;
    const currentView = view();
    if (!journeyId || !runtime?.enabled || !element) return;
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

  onMount(() => {
    requestAnimationFrame(fit);
    const onUndoRequest = (event: Event) => {
      const request = event as CustomEvent<{ redo: boolean }>;
      if (request.detail.redo) {
        if (!journeyDocument?.canRedo()) return;
        event.preventDefault();
        redo();
        return;
      }
      if (!journeyDocument?.canUndo()) return;
      event.preventDefault();
      undo();
    };
    const onCanvasKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "v" || event.key === "V") {
        setCanvasTool("select");
        return;
      }
      if (event.key === "h" || event.key === "H") {
        setCanvasTool("hand");
        return;
      }
      if (event.key !== "Escape" || renamingNodeId()) return;
      setSelectedNodeId(null);
      setSelectedConnectionId(null);
      setKeyboardConnectionSourceId(null);
      setHistoryOpen(false);
    };
    window.addEventListener("relay:undo-request", onUndoRequest);
    window.addEventListener("keydown", onCanvasKey);
    onCleanup(() => {
      window.removeEventListener("relay:undo-request", onUndoRequest);
      window.removeEventListener("keydown", onCanvasKey);
    });
  });
  createEffect(() => {
    const signature = [
      ...tree().nodes.map((node) => node.id),
      ...connections().map((connection) => connection.id),
      ...(metadata().value.notes ?? []).map((note) => note.id),
    ].join("|");
    if (!signature || signature === fittedSignature) return;
    fittedSignature = signature;
    setSelectedNodeId((current) =>
      current && tree().nodes.some((node) => node.id === current) ? current : null,
    );
    requestAnimationFrame(fit);
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
  const applyRemoteMetadata = (next: Revisioned<JourneyMetadata>) => {
    journeyDocument?.replace(next.value, "remote");
    setCanvasHistory({
      undo: journeyDocument?.canUndo() ?? false,
      redo: journeyDocument?.canRedo() ?? false,
    });
    setMetadata(next);
  };
  const persistMetadata = (value: JourneyMetadata) => {
    const recipeId = server.selectedRecipeId();
    if (!recipeId) return;
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
    // When opted in, the provider is the only draft writer. The revisioned
    // Journey endpoint remains the sole writer when collaboration is disabled.
    if (collaborationRuntime?.enabled) return;
    const sequence = ++metadataSaveSequence;
    void server
      .saveJourney(recipeId, current, nextValue)
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
    if (!server.selectedRecipeId()) return;
    persistMetadata(withJourneyGraph({ ...metadata().value, notes }, graph()));
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
  const addNote = () => {
    const element = canvas;
    const current = view();
    const x = element ? (element.clientWidth * 0.52 - current.x) / current.scale : 320;
    const y = element ? (element.clientHeight * 0.42 - current.y) / current.scale : 180;
    const at = Date.now();
    const id = `note-${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? at.toString(36)}`;
    persistNotes([
      ...(metadata().value.notes ?? []),
      { id, text: "Add context for this part of the journey", x, y, createdAt: at, updatedAt: at },
    ]);
  };
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
      mode: take.steps.length ? "interaction" : "automatic",
    });
    if (committed) {
      const recipeId = server.selectedRecipeId();
      const next = recipeId ? await server.loadJourney(recipeId) : null;
      if (next) applyRemoteMetadata(next);
      const destinationScreenId = next?.value.graph?.transitions.find(
        (transition) => transition.id === committed.committedTransitionId,
      )?.destination;
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
        const nextTree = buildJourneyGraphTree(
          ensureJourneyGraph(next?.value ?? metadata().value, draft.steps()),
          draft.steps(),
        );
        const addedScreen = nextTree.nodes.find(
          (node) =>
            destinationScreenId?.kind === "screen" && node.id === destinationScreenId.screenId,
        );
        if (addedScreen) selectNode(addedScreen);
        fit();
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
      persistMetadata(
        reviewTransition(metadata().value, connection.id, { status: "verified" }, Date.now()),
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
      description: "Reusable connection behavior · saved from the journey canvas",
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
      const recipeId = server.selectedRecipeId();
      if (collaborationRuntime?.enabled) return;
      const sequence = ++metadataSaveSequence;
      if (recipeId)
        void server
          .saveJourney(recipeId, current, value)
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
      const recipeId = server.selectedRecipeId();
      if (collaborationRuntime?.enabled) return;
      const sequence = ++metadataSaveSequence;
      if (recipeId)
        void server
          .saveJourney(recipeId, current, value)
          .then((next) => sequence === metadataSaveSequence && applyRemoteMetadata(next));
      return;
    }
    draft.redo();
  };

  return (
    <section
      class={cn(
        "relative grid min-h-0 flex-1 overflow-hidden bg-[var(--v2-background-bg-deep)]",
        reviewingTake()
          ? "grid-cols-[minmax(280px,320px)_minmax(0,1fr)] max-[760px]:grid-cols-1 max-[760px]:grid-rows-[minmax(260px,42%)_minmax(0,1fr)]"
          : "grid-cols-1",
      )}
    >
      <Show when={!reviewingTake()}>
        <section
          ref={(element) => {
            canvas = element;
          }}
          class={cn(
            "relative isolate flex min-h-0 min-w-0 touch-none select-none overflow-hidden",
            canvasTool() === "hand" ? "cursor-grab active:cursor-grabbing" : "cursor-default",
          )}
          aria-label="Journey graph"
          onWheel={(event) => {
            if (!hasCanvasContent() || (!event.ctrlKey && !event.metaKey && !event.altKey)) return;
            event.preventDefault();
            zoom(event.deltaY > 0 ? -0.08 : 0.08, { x: event.clientX, y: event.clientY });
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
            event.currentTarget.setPointerCapture(event.pointerId);
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
              setMetadata((current) => ({ ...current, value: { ...current.value, notes: next } }));
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
                hit?.closest('[aria-label="Journey graph"]') === event.currentTarget &&
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
          <div
            class="pointer-events-none absolute inset-0 opacity-35"
            style={{
              "background-image":
                "radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--text-strong) 9%,transparent) 1px,transparent 0)",
              "background-size": "22px 22px",
            }}
          />
          <Show when={hasCanvasContent()}>
            <header class="absolute top-4 left-4 z-20 flex min-h-10 items-center rounded-full bg-[color-mix(in_srgb,var(--v2-background-bg-base)_88%,transparent)] px-2.5 shadow-[0_0_0_1px_color-mix(in_srgb,var(--v2-border-border-muted)_80%,transparent),0_8px_24px_rgb(0_0_0/14%)] backdrop-blur-[14px]">
              <div class="flex min-w-0 items-center gap-2">
                <span class="grid size-6 shrink-0 place-items-center rounded-[7px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
                  <Icon name="move" size={12} />
                </span>
                <span class="whitespace-nowrap text-[10.5px] font-medium text-[var(--text-base)]">
                  {tree().nodes.length} {tree().nodes.length === 1 ? "screen" : "screens"}
                  <span class="mx-1.5 text-[var(--text-weak)]">·</span>
                  {connections().length} {connections().length === 1 ? "connection" : "connections"}
                </span>
              </div>
            </header>
          </Show>
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
                selectedDeviceName={selectedDevice()?.name ?? server.selectedDevice() ?? undefined}
                deviceOpen={captureOpen()}
                deviceSelected={Boolean(selectedDevice())}
                liveScreenSrc={liveScreenSrc()}
                captureBusy={startCaptureBusy()}
                onUseCurrentScreen={() => void useCurrentScreenAsStart()}
                onOpenDevice={() => {
                  setCaptureOpen(true);
                  requestAnimationFrame(() =>
                    window.dispatchEvent(new CustomEvent("relay:open-device-picker")),
                  );
                }}
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
              <svg
                class="absolute inset-0 overflow-visible"
                width={bounds().width}
                height={bounds().height}
                aria-label="Journey connections"
              >
                <defs>
                  <marker
                    id="journey-graph-arrow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" class="fill-[var(--text-interactive-base)]" />
                  </marker>
                  <marker
                    id="journey-graph-return"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" class="fill-[var(--text-weak)]" />
                  </marker>
                  <marker
                    id="journey-graph-verified"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" class="fill-[var(--icon-success-base)]" />
                  </marker>
                  <marker
                    id="journey-graph-failed"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" class="fill-[var(--icon-critical-base)]" />
                  </marker>
                  <marker
                    id="journey-graph-healed"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" class="fill-[var(--icon-warning-base)]" />
                  </marker>
                </defs>
                <For each={connections()}>
                  {(connection) => {
                    const runState = () => runProjection().transitions[connection.id]?.state;
                    const geometry = () =>
                      canvasEdgeGeometry(
                        {
                          from: connection.fromScreenId,
                          to: connection.toScreenId,
                          kind: connection.kind,
                        },
                        tree().nodes,
                        positionFor,
                      );
                    return (
                      <g>
                        <path
                          d={geometry().path}
                          class={cn(
                            "pointer-events-none fill-none",
                            runState() === "failed"
                              ? "stroke-[var(--icon-critical-base)]"
                              : runState() === "running"
                                ? "stroke-[var(--text-interactive-base)] [stroke-dasharray:7_4] motion-safe:animate-pulse"
                                : runState() === "healed"
                                  ? "stroke-[var(--icon-warning-base)]"
                                  : runState() === "passed"
                                    ? "stroke-[var(--icon-success-base)]"
                                    : connection.state === "needs-recording"
                                      ? "stroke-[var(--icon-warning-base)] [stroke-dasharray:5_5]"
                                      : connection.review?.status === "verified"
                                        ? "stroke-[var(--icon-success-base)]"
                                        : connection.review?.status === "failed"
                                          ? "stroke-[var(--icon-critical-base)]"
                                          : connection.kind === "return"
                                            ? "stroke-[var(--text-weak)] [stroke-dasharray:6_6]"
                                            : "stroke-[var(--text-interactive-base)]",
                          )}
                          stroke-width={
                            connection.state === "needs-recording"
                              ? 2
                              : connection.kind === "return"
                                ? 1.5
                                : 2
                          }
                          stroke-linecap="round"
                          marker-end={`url(#journey-graph-${
                            runState() === "failed"
                              ? "failed"
                              : runState() === "healed"
                                ? "healed"
                                : runState() === "passed"
                                  ? "verified"
                                  : connection.review?.status === "failed"
                                    ? "failed"
                                    : connection.kind === "return"
                                      ? "return"
                                      : "arrow"
                          })`}
                        />
                        <path
                          d={geometry().path}
                          class="cursor-pointer fill-none stroke-transparent outline-none focus-visible:stroke-[var(--text-interactive-base)] focus-visible:[stroke-dasharray:4_3]"
                          stroke-width="16"
                          tabindex={0}
                          role="button"
                          aria-label={`Select connection from ${titleFor(
                            tree().nodes.find((node) => node.id === connection.fromScreenId)!,
                          )} to ${titleFor(
                            tree().nodes.find((node) => node.id === connection.toScreenId)!,
                          )}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedConnectionId(connection.id);
                            setSelectedNodeId(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            setSelectedConnectionId(connection.id);
                            setSelectedNodeId(null);
                          }}
                        />
                      </g>
                    );
                  }}
                </For>
                <Show when={connectionPreview() && connectionDrag}>
                  <path
                    d={draftCanvasConnectionPath(
                      connectionDrag!.fromScreenId,
                      connectionPreview()!,
                      tree().nodes,
                      positionFor,
                    )}
                    class="pointer-events-none fill-none stroke-[var(--text-interactive-base)] [stroke-dasharray:5_5]"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                </Show>
              </svg>
              <CollaborationPresence
                awareness={remoteAwareness()}
                geometry={presenceGeometry()}
                width={bounds().width}
                height={bounds().height}
              />
              <For each={tree().nodes}>
                {(node) => {
                  const isFlowStart = () => graph().flows.some((flow) => flow.screenId === node.id);
                  return (
                    <ScreenCard
                      node={node}
                      step={draft.steps()[node.representativeStepIndex]}
                      isFlowStart={isFlowStart()}
                      outgoingCount={
                        connections().filter((connection) => connection.fromScreenId === node.id)
                          .length
                      }
                      title={titleFor(node)}
                      selected={selectedNode()?.id === node.id}
                      editing={renamingNodeId() === node.id}
                      runState={runProjection().screens[node.id]?.state}
                      position={positionFor(node)}
                      src={() =>
                        screenshotUrl(server, draft.steps()[node.representativeStepIndex]) ||
                        capturedScreenUrls()[node.id] ||
                        ""
                      }
                      onSelect={() => selectNode(node)}
                      onRename={() => setRenamingNodeId(node.id)}
                      onCommitRename={(title) => renameScreen(node, title)}
                      onConnectStart={(event) => beginConnection(event, node.id)}
                      onConnectKeyboard={() => {
                        selectNode(node);
                        setKeyboardConnectionSourceId(node.id);
                      }}
                      onPointerDown={(event) => {
                        if (canvasTool() === "hand") {
                          event.stopPropagation();
                          pan = { x: event.clientX, y: event.clientY, view: view() };
                          canvas?.setPointerCapture(event.pointerId);
                          return;
                        }
                        event.stopPropagation();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        nodeDrag = {
                          id: node.id,
                          x: event.clientX,
                          y: event.clientY,
                          origin: positionFor(node),
                          moved: false,
                        };
                      }}
                    />
                  );
                }}
              </For>
              <Show when={keyboardConnectionSourceId()}>
                {(sourceId) => {
                  const source = () => tree().nodes.find((node) => node.id === sourceId());
                  return (
                    <KeyboardConnectionChooser
                      sourceTitle={source() ? titleFor(source()!) : "Selected screen"}
                      destinations={tree()
                        .nodes.filter((node) => node.id !== sourceId())
                        .map((node) => ({ id: node.id, title: titleFor(node) }))}
                      onChoose={(targetId) => chooseKeyboardConnection(sourceId(), targetId)}
                      onCreate={() => createKeyboardDestination(sourceId())}
                      onCancel={() => setKeyboardConnectionSourceId(null)}
                    />
                  );
                }}
              </Show>
              <For each={metadata().value.notes ?? []}>
                {(note) => (
                  <CanvasNote
                    note={note}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      noteDrag = {
                        id: note.id,
                        x: event.clientX,
                        y: event.clientY,
                        origin: { x: note.x, y: note.y },
                        moved: false,
                      };
                    }}
                    onText={(text) =>
                      setMetadata((current) => ({
                        ...current,
                        value: {
                          ...current.value,
                          notes: (current.value.notes ?? []).map((entry) =>
                            entry.id === note.id
                              ? { ...entry, text, updatedAt: Date.now() }
                              : entry,
                          ),
                        },
                      }))
                    }
                    onCommit={() => persistNotes(metadata().value.notes ?? [])}
                    onDelete={() =>
                      persistNotes(
                        (metadata().value.notes ?? []).filter((entry) => entry.id !== note.id),
                      )
                    }
                  />
                )}
              </For>
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
                    onRemove={() => removeConnection(connection())}
                    onClose={() => setSelectedConnectionId(null)}
                  />
                )}
              </Show>
            </Show>
            <div class="absolute bottom-[calc(16px+env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-[13px] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_94%,transparent)] p-1.5 shadow-[0_0_0_1px_color-mix(in_srgb,var(--v2-border-border-strong)_76%,transparent),0_16px_46px_rgb(0_0_0/28%)] backdrop-blur-[16px]">
              <button
                type="button"
                class={cn(
                  mapControlButton,
                  canvasTool() === "select" &&
                    "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
                )}
                aria-label="Select tool"
                aria-pressed={canvasTool() === "select"}
                title="Select and move (V)"
                onClick={() => setCanvasTool("select")}
              >
                <Icon name="pointer" size={13} />
              </button>
              <button
                type="button"
                class={cn(
                  mapControlButton,
                  canvasTool() === "hand" &&
                    "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
                )}
                aria-label="Hand tool"
                aria-pressed={canvasTool() === "hand"}
                title="Pan canvas (H)"
                onClick={() => setCanvasTool("hand")}
              >
                <Icon name="move" size={13} />
              </button>
              <span class="mx-0.5 h-6 w-px bg-[var(--v2-border-border-muted)]" aria-hidden="true" />
              <button
                type="button"
                class={mapControlButton}
                aria-label="Undo"
                title="Undo"
                disabled={!canvasHistory().undo && !draft.canUndo()}
                onClick={undo}
              >
                <Icon name="undo" size={13} />
              </button>
              <button
                type="button"
                class={mapControlButton}
                aria-label="Redo"
                title="Redo"
                disabled={!canvasHistory().redo && !draft.canRedo()}
                onClick={redo}
              >
                <Icon name="redo" size={13} />
              </button>
              <button
                type="button"
                class={mapControlButton}
                aria-expanded={historyOpen()}
                aria-label="Journey history"
                title="Journey history"
                onClick={() => {
                  const opening = !historyOpen();
                  if (opening) setCaptureOpen(false);
                  setHistoryOpen(opening);
                }}
              >
                <Icon name="clock" size={13} />
              </button>
              <span class="mx-0.5 h-6 w-px bg-[var(--v2-border-border-muted)]" aria-hidden="true" />
              <button type="button" class={mapControlButton} title="Add note" onClick={addNote}>
                <Icon name="edit" size={13} />
                <span class="sr-only">Add note</span>
              </button>
              <Show
                when={selectedNode() && !captureOpen() && !recorder.recording() && !recorder.take()}
              >
                <button type="button" class={recordButton} onClick={recordFromHere}>
                  <i class="size-1.5 rounded-full bg-[var(--icon-critical-base)]" />
                  Record next
                </button>
              </Show>
            </div>
            <div class="absolute right-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-20 flex items-center gap-0.5 rounded-full bg-[color-mix(in_srgb,var(--v2-background-bg-base)_90%,transparent)] p-1 shadow-[0_0_0_1px_color-mix(in_srgb,var(--v2-border-border-muted)_78%,transparent),0_8px_24px_rgb(0_0_0/16%)] backdrop-blur-[12px] max-[680px]:right-2 max-[680px]:bottom-[calc(68px+env(safe-area-inset-bottom))]">
              <button
                type="button"
                class={mapControlButton}
                aria-label="Zoom out"
                onClick={() => zoom(-0.1)}
              >
                −
              </button>
              <span class="min-w-9 text-center font-mono text-[10px] tabular-nums text-[var(--text-weak)]">
                {Math.round(view().scale * 100)}%
              </span>
              <button
                type="button"
                class={mapControlButton}
                aria-label="Zoom in"
                onClick={() => zoom(0.1)}
              >
                +
              </button>
              <button type="button" class={mapControlButton} aria-label="Fit journey" onClick={fit}>
                Fit
              </button>
            </div>
          </Show>
        </section>
      </Show>
      <Show when={reviewingTake() && recorder.take()}>
        {(take) => (
          <>
            <TakeReviewSidebar
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
              replayState={takeReplay().takeId === take().id ? takeReplay().state : "idle"}
              {...(takeReplay().takeId === take().id && takeReplay().error
                ? { replayError: takeReplay().error }
                : {})}
              onRemove={(index) => {
                void recorder.removeTakeStep(index);
                setTakeReplay({ takeId: take().id, state: "idle" });
                setReviewStepIndex((selected) => (selected > index ? selected - 1 : selected));
              }}
            />
            <section
              class="relative min-h-0 min-w-0 overflow-hidden border-l border-[var(--v2-border-border-muted)] max-[760px]:border-t max-[760px]:border-l-0"
              aria-label="Recorded action playback"
            >
              <RecordedTakePlayer
                take={take()}
                selectedIndex={reviewStepIndex()}
                onSelect={setReviewStepIndex}
                screenshotFor={(_, index) => take().stepEvidenceUrls[index] ?? ""}
                videoSrc={take().videoEvidenceUrl}
                clip={take().videoClip}
                onClip={(clip: JourneyVideoClip) => {
                  void recorder.setTakeVideoClip(clip);
                  setTakeReplay({ takeId: take().id, state: "idle" });
                }}
              />
            </section>
          </>
        )}
      </Show>
      <Show when={captureOpen() && !reviewingTake()}>
        <aside
          class={cn(
            "ui-device-companion absolute top-4 right-4 z-40 flex min-h-0 min-w-0 flex-col overflow-visible border border-[var(--v2-border-border-strong)] bg-[var(--v2-background-bg-base)] shadow-[0_20px_56px_-20px_rgb(0_0_0/55%)]",
            captureClosing() && "ui-device-companion--closing",
            selectedDevice()
              ? "bottom-4 w-[min(388px,calc(100%-32px))] rounded-[18px] max-[720px]:top-auto max-[720px]:right-2 max-[720px]:bottom-2 max-[720px]:left-2 max-[720px]:h-[min(72vh,680px)] max-[720px]:w-auto"
              : "h-[276px] w-[min(344px,calc(100%-32px))] rounded-[18px] max-[720px]:right-2 max-[720px]:left-2 max-[720px]:w-auto",
          )}
          aria-label="Device"
        >
          <header class="relative z-[100] flex min-h-12 shrink-0 items-center justify-between rounded-t-[18px] border-b border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)] px-3.5">
            <div class="flex min-w-0 items-center gap-2">
              <Show when={selectedDevice()}>
                <i
                  class={cn(
                    "size-1.5 shrink-0 rounded-full",
                    recorder.recording()
                      ? "bg-[var(--icon-critical-base)]"
                      : canRecord()
                        ? "bg-[var(--icon-success-base)]"
                        : "bg-[var(--icon-warning-base)]",
                  )}
                />
              </Show>
              <DevicePicker onManageTargets={props.onOpenTargets} />
            </div>
            <Show when={!recorder.recording()}>
              <button
                type="button"
                class={mapControlButton}
                aria-label="Close device"
                title="Close device"
                onClick={closeCapturePanel}
              >
                <Icon name="x" size={13} />
              </button>
            </Show>
          </header>
          <div class="relative z-0 min-h-0 flex-1 overflow-hidden rounded-b-[18px]">
            <DeviceStage onOpenTargets={props.onOpenTargets} recordingControls="embedded" />
          </div>
          <Show
            when={recorder.recording() && recorder.take()}
            fallback={
              <Show
                when={
                  canRecord() &&
                  (!hasCanvasContent() || Boolean(selectedNode()) || Boolean(selectedConnection()))
                }
              >
                <footer class="flex min-h-16 shrink-0 items-center border-t border-[var(--v2-border-border-muted)] px-3 pt-2 pb-3">
                  <button
                    type="button"
                    class="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#705ff0] px-4 text-[11.5px] font-semibold text-white shadow-[inset_0_1px_rgb(255_255_255/18%),0_10px_28px_rgb(89_69_214/24%)] transition-[background-color,transform] duration-150 hover:enabled:bg-[#7d6df5] active:enabled:scale-[0.98] disabled:cursor-wait disabled:opacity-75"
                    disabled={recorder.arming() || startCaptureBusy()}
                    aria-busy={recorder.arming() || startCaptureBusy()}
                    onClick={() => {
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
                  >
                    <Show
                      when={recorder.arming() || startCaptureBusy()}
                      fallback={<i class="size-2 rounded-full bg-white/90" />}
                    >
                      <Icon
                        name="refresh"
                        size={13}
                        class="animate-[spin_900ms_linear_infinite] motion-reduce:animate-none"
                      />
                    </Show>
                    {recorder.arming() || startCaptureBusy()
                      ? "Preparing device…"
                      : !hasCanvasContent()
                        ? "Use current screen"
                        : selectedConnection()
                          ? selectedConnection()!.state === "needs-recording"
                            ? "Record connection"
                            : "Rewrite connection"
                          : "Record next connection"}
                  </button>
                </footer>
              </Show>
            }
          >
            {(take) => (
              <TakeCaptureBar
                take={take()}
                contextLabel={captureContextLabel()}
                onStop={() => void recorder.stopRecording()}
              />
            )}
          </Show>
        </aside>
      </Show>
    </section>
  );
}

const recordButton =
  "canvas-tool-control inline-flex h-10 items-center gap-1.5 rounded-[9px] bg-[var(--product-accent-soft)] px-3 text-[11px] font-semibold text-[var(--text-interactive-base)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] active:scale-[0.96]";
const mapControlButton =
  "canvas-tool-control grid h-10 min-w-10 place-items-center rounded-[9px] px-2 text-[10.5px] text-[var(--text-base)] transition-[background-color,color,transform] duration-150 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35";

function screenshotUrl(server: ReturnType<typeof useServer>, step: RecipeStep | undefined): string {
  const screenshot = evidenceForStep(step)?.screenshot;
  return screenshot ? server.recordingEvidenceUrl(screenshot.recipeId, screenshot.id) : "";
}
