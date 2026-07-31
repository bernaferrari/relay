import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type {
  JourneyCanvasNote,
  JourneyMetadata,
  JourneyReviewState,
  JourneyTake,
  JourneyVideoClip,
  Revisioned,
} from "@relay/protocol";
import { useRecipeDraft } from "../context/recipe-draft";
import { useRecorder, type RecordingTake } from "../context/recorder";
import { useServer, type RecipeStep } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { type JourneyTreeNode } from "../lib/journey-tree";
import { createJourneyDocument, type JourneyDocument } from "../lib/journey-document";
import {
  addPlannedConnection,
  addPlannedScreenConnection,
  attachRecordedTake,
  attachTransitionSteps,
  canvasConnections,
  removeAuthoredConnection,
  reviewTransition,
  type CanvasConnection,
} from "../lib/journey-prototype";
import {
  buildJourneyGraphTree,
  commitTakeToJourneyGraph,
  ensureJourneyGraph,
  type TakeDestination,
  withJourneyGraph,
} from "../lib/journey-graph";
import { EMPTY_JOURNEY_METADATA, metadataWithTake } from "../lib/journey-metadata";
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
import { replayTransitionSteps } from "../lib/transition-replay";
import { toast } from "../context/toast";
import { DeviceStage } from "./stage";
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
  ScreenCard,
  ScreenInspector,
} from "./journey-canvas-primitives";
import { JourneyHistoryPanel } from "./journey-history-panel";

/**
 * The graph is the authoring surface for a journey. A card is a captured
 * screen; the small actions attached to it are the things a person can do
 * there. Recording remains the only way to create the real transitions, so
 * the canvas never promises a route that the runner cannot execute.
 */
export function JourneyWorkspace(props: { onLive: () => void; onOpenTargets: () => void }) {
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
  const [appleSetupCheckAttempt, setAppleSetupCheckAttempt] = createSignal(0);
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
    const readiness = deviceReadiness(device, server.health() === "online");
    if (readiness.kind === "choose-device") return "choose-device";
    if (readiness.kind === "device-unavailable") return "device-unavailable";
    if (readiness.kind === "ios-developer-mode-disabled") return "enable-developer-mode";
    if (readiness.kind === "ios-preparing") return "preparing-ios";
    if (!device || device.platform !== "ios") return "ready";
    const setup = server.appleDeviceSetup();
    if (appleSetupCheckFailed()) return "setup-check-failed";
    if (!setup) return "checking-ios";
    return setup.setup.ios ? "ready" : "setup-ios";
  };
  const canRecord = () => recordState() === "ready";
  const [view, setView] = createSignal<CanvasViewport>({ x: 72, y: 68, scale: 0.78 });
  const connections = createMemo(() => canvasConnections(tree(), draft.steps(), metadata().value));
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = createSignal<string | null>(null);
  const [connectionPreview, setConnectionPreview] = createSignal<CanvasPoint | null>(null);
  const [renamingNodeId, setRenamingNodeId] = createSignal<string | null>(null);
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [captureOpen, setCaptureOpen] = createSignal(false);
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
  let canvas: HTMLElement | undefined;
  let journeyDocument: JourneyDocument | null = null;
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
  let autoOpenedCaptureForRecipe = "";
  let fittedSignature = "";
  let metadataSaveSequence = 0;

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
    const recipeId = server.selectedRecipeId();
    if (!recipeId) {
      journeyDocument?.destroy();
      journeyDocument = null;
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
          journeyDocument?.destroy();
          journeyDocument = createJourneyDocument(next.value);
          setCanvasHistory({ undo: false, redo: false });
          setMetadata(next);
          setLoadedRecipeId(recipeId);
        }
      })
      .catch(() => {
        if (server.selectedRecipeId() === recipeId) {
          journeyDocument?.destroy();
          journeyDocument = createJourneyDocument(EMPTY_JOURNEY_METADATA);
          setCanvasHistory({ undo: false, redo: false });
          setMetadata({ revision: 0, value: EMPTY_JOURNEY_METADATA, updatedAt: 0 });
          setLoadedRecipeId(recipeId);
        }
      });
  });
  // Recording starts from the navigator as well as from this workspace. The
  // drawer must follow that state so a fresh journey never appears to be an
  // empty graph while it is already capturing real work.
  createEffect(() => {
    if (recorder.recording() || recorder.take()) setCaptureOpen(true);
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
  onCleanup(() => journeyDocument?.destroy());

  onMount(() => {
    const onDeviceSelected = () => {
      if (!recordRequestedAfterDeviceSelection) return;
      recordRequestedAfterDeviceSelection = false;
      setWaitingForRecordTarget(true);
    };
    window.addEventListener("relay:device-selected", onDeviceSelected);
    onCleanup(() => window.removeEventListener("relay:device-selected", onDeviceSelected));
  });

  const positions = () => metadata().value.positions;
  const titleFor = (node: JourneyTreeNode) =>
    metadata().value.screenTitles?.[node.id]?.trim() || node.title;
  const hasCanvasContent = () => hasMap() || (metadata().value.notes?.length ?? 0) > 0;
  createEffect(() => {
    const recipeId = server.selectedRecipeId();
    if (
      !recipeId ||
      loadedRecipeId() !== recipeId ||
      hasCanvasContent() ||
      draft.steps().length > 0 ||
      recorder.recording() ||
      recorder.take() ||
      recordState() !== "ready" ||
      autoOpenedCaptureForRecipe === recipeId
    )
      return;
    autoOpenedCaptureForRecipe = recipeId;
    setCaptureOpen(true);
  });
  const positionFor = (node: JourneyTreeNode): CanvasPoint => positions()[node.id] ?? node;
  const selectedNode = createMemo(
    () => tree().nodes.find((node) => node.id === selectedNodeId()) ?? tree().nodes[0] ?? null,
  );
  const selectedConnection = createMemo(
    () => connections().find((connection) => connection.id === selectedConnectionId()) ?? null,
  );
  const reusableCaptures = createMemo(() => {
    const availableStepIds = new Set(draft.steps().flatMap((step) => (step.id ? [step.id] : [])));
    return (metadata().value.takes ?? [])
      .filter(
        (take) =>
          take.state === "kept" &&
          take.steps.length > 0 &&
          take.steps.every((step) => Boolean(step.id && availableStepIds.has(step.id))),
      )
      .sort((left, right) => right.startedAt - left.startedAt)
      .slice(0, 6)
      .map((take) => ({
        id: take.id,
        label: take.group || "Recorded transition",
        actionCount: take.steps.length,
        hasVideo: Boolean(take.videoTakeId),
      }));
  });
  const reusableBehaviors = createMemo(() =>
    server
      .recipes()
      .filter(
        (recipe) =>
          recipe.source === "custom" &&
          recipe.id !== server.selectedRecipeId() &&
          recipe.description?.startsWith("Reusable transition behavior") &&
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
    window.addEventListener("relay:undo-request", onUndoRequest);
    onCleanup(() => window.removeEventListener("relay:undo-request", onUndoRequest));
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
      current && tree().nodes.some((node) => node.id === current)
        ? current
        : (tree().nodes[0]?.id ?? null),
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
  const persistTake = (
    take: RecordingTake,
    state: JourneyTake["state"],
    reviewState?: JourneyReviewState,
  ) => {
    const next = metadataWithTake(metadata().value, take, state, reviewState);
    if (next !== metadata().value) persistMetadata(withJourneyGraph(next, graph()));
  };
  const persistNotes = (notes: JourneyCanvasNote[]) => {
    if (!server.selectedRecipeId()) return;
    persistMetadata(withJourneyGraph({ ...metadata().value, notes }, graph()));
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
    toast("Choose a ready device before replaying this transition", "info");
    window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
    return false;
  };
  const replayTake = async () => {
    const take = recorder.take();
    if (!take || !canReplayOnDevice()) return;
    setTakeReplay({ takeId: take.id, state: "running" });
    const result = await replayTransitionSteps(take.steps, server.runStep);
    setTakeReplay(
      result.ok
        ? { takeId: take.id, state: "passed" }
        : { takeId: take.id, state: "failed", error: result.error },
    );
  };
  createEffect(() => {
    const recipeId = server.selectedRecipeId();
    const current = recorder.take();
    if (!recipeId || !current || current.recipeId !== recipeId || current.state !== "review")
      return;
    persistTake(current, "review");
  });
  createEffect(() => {
    const recipeId = server.selectedRecipeId();
    if (!recipeId || recorder.take()) return;
    const review = [...(metadata().value.takes ?? [])]
      .reverse()
      .find((take) => take.recipeId === recipeId && take.state === "review");
    if (review?.state === "review") recorder.restoreTake({ ...review, state: "review" });
  });
  const keepTake = () => {
    const take = recorder.take();
    if (!take || takeReplay().takeId !== take.id || takeReplay().state !== "passed") return;
    const inserted = recorder.keepTake();
    if (inserted) {
      const keptTake = { ...take, steps: inserted };
      let value = withJourneyGraph(
        metadataWithTake(metadata().value, keptTake, "kept", "needs-review"),
        graph(),
      );
      let destinationScreenId: string | undefined;
      if (pendingConnectionId) {
        value = attachRecordedTake(value, pendingConnectionId, {
          id: take.id,
          steps: inserted,
          ...(take.videoTakeId ? { videoTakeId: take.videoTakeId } : {}),
          ...(take.videoClip ? { videoClip: take.videoClip } : {}),
        });
        value = reviewTransition(value, pendingConnectionId, { status: "verified" });
        const pending = graph().transitions.find(
          (transition) => transition.id === pendingConnectionId,
        );
        if (pending?.destination.kind === "screen")
          destinationScreenId = pending.destination.screenId;
      } else {
        const committed = commitTakeToJourneyGraph(graph(), {
          sourceScreenId: take.sourceScreenId ?? recordingSourceScreenId ?? selectedNodeId(),
          destination: reviewDestination(),
          steps: inserted,
          takeId: take.id,
          ...(take.videoTakeId ? { videoTakeId: take.videoTakeId } : {}),
          ...(take.videoClip ? { videoClip: take.videoClip } : {}),
          mode: "interaction",
          review: { status: "verified", updatedAt: Date.now(), verifiedAt: Date.now() },
        });
        value = withJourneyGraph(value, committed.graph);
        destinationScreenId = committed.destinationScreenId;
      }
      persistMetadata(value);
      pendingConnectionId = null;
      recordingSourceScreenId = null;
      setReviewDestination({ kind: "new-screen" });
      // Review is a temporary decision point. Once the person keeps it, return
      // them to the graph and select the just-added screen so "Record from
      // here" is the natural next action instead of leaving a stale device
      // inspector open beside the canvas.
      setCaptureOpen(false);
      setTakeReplay({ takeId: null, state: "idle" });
      requestAnimationFrame(() => {
        const nextTree = buildJourneyGraphTree(
          ensureJourneyGraph(value, draft.steps()),
          draft.steps(),
        );
        const addedScreen = nextTree.nodes.find((node) => node.id === destinationScreenId);
        if (addedScreen) selectNode(addedScreen);
        fit();
      });
    }
  };
  const discardTake = () => {
    const take = recorder.take();
    if (take) persistTake(take, "discarded");
    pendingConnectionId = null;
    recordingSourceScreenId = null;
    setReviewDestination({ kind: "new-screen" });
    recorder.discardTake();
    setTakeReplay({ takeId: null, state: "idle" });
  };
  const rewriteTake = () => {
    const take = recorder.take();
    if (!take) return;
    const sourceScreenId = take.sourceScreenId ?? recordingSourceScreenId ?? selectedNodeId();
    persistTake(take, "discarded");
    recorder.discardTake();
    recordingSourceScreenId = sourceScreenId;
    recorder.setRecordingSourceScreen(sourceScreenId ?? undefined);
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
      if (state === "enable-developer-mode" || state === "preparing-ios") return;
      recordRequestedAfterDeviceSelection = true;
      window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
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
    recordFromNode(screen);
  };
  const attachCapture = (connection: CanvasConnection, takeId: string) => {
    const take = (metadata().value.takes ?? []).find(
      (candidate) => candidate.id === takeId && candidate.state === "kept",
    );
    if (!take) return;
    persistMetadata(attachRecordedTake(metadata().value, connection.id, take));
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
      toast("Transition verified on the device", "success");
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
      description: "Reusable transition behavior · saved from the journey canvas",
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
      class="grid min-h-0 flex-1 bg-[var(--v2-background-bg-deep)]"
      style={{
        "grid-template-columns": reviewingTake()
          ? "minmax(280px, 320px) minmax(0, 1fr)"
          : captureOpen()
            ? "minmax(0, 1fr) minmax(340px, 440px)"
            : "minmax(0, 1fr)",
      }}
    >
      <Show when={!reviewingTake()}>
        <section
          ref={(element) => {
            canvas = element;
          }}
          class="relative isolate flex min-h-0 min-w-0 select-none overflow-hidden border-r border-[var(--v2-border-border-muted)]"
          aria-label="Journey graph"
          onWheel={(event) => {
            if (!hasCanvasContent() || (!event.ctrlKey && !event.metaKey && !event.altKey)) return;
            event.preventDefault();
            zoom(event.deltaY > 0 ? -0.08 : 0.08, { x: event.clientX, y: event.clientY });
          }}
          onPointerDown={(event) => {
            if (
              !hasCanvasContent() ||
              event.button !== 0 ||
              (event.target as HTMLElement).closest("button")
            )
              return;
            pan = { x: event.clientX, y: event.clientY, view: view() };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (connectionDrag) {
              const rect = event.currentTarget.getBoundingClientRect();
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
            <header class="absolute top-0 right-0 left-0 z-20 flex h-12 items-center justify-between border-b border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-deep)_88%,transparent)] px-4 backdrop-blur-[12px]">
              <div class="min-w-0">
                <strong class="block text-[12px] font-semibold text-[var(--text-strong)]">
                  Journey map
                </strong>
                <span class="text-[10.5px] text-[var(--text-weak)]">
                  {tree().nodes.length} {tree().nodes.length === 1 ? "screen" : "screens"} ·{" "}
                  {connections().length} {connections().length === 1 ? "route" : "routes"}
                </span>
              </div>
              <div class="flex items-center gap-1">
                <Show when={hasCanvasContent()}>
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
                    title="Journey history"
                    onClick={() => setHistoryOpen((open) => !open)}
                  >
                    <Icon name="clock" size={13} />
                  </button>
                  <button type="button" class={mapControlButton} title="Add note" onClick={addNote}>
                    <Icon name="plus" size={13} />
                  </button>
                  <Show when={!recorder.recording() && !recorder.take()}>
                    <button type="button" class={recordButton} onClick={recordFromHere}>
                      <i class="size-1.5 rounded-full bg-[var(--icon-critical-base)]" /> Record from
                      here
                    </button>
                  </Show>
                </Show>
                <Show when={!captureOpen()}>
                  <button
                    type="button"
                    class={mapControlButton}
                    aria-label="Open device capture"
                    title="Open device capture"
                    onClick={() => setCaptureOpen(true)}
                  >
                    <Icon name="smartphone" size={13} />
                  </button>
                </Show>
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
                onRecord={recordFromHere}
                onSetUpDevice={() =>
                  window.dispatchEvent(
                    new CustomEvent("relay:open-settings", { detail: { section: "devices" } }),
                  )
                }
                onRetrySetup={() => setAppleSetupCheckAttempt((attempt) => attempt + 1)}
                onOpenDevice={() => setCaptureOpen(true)}
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
                aria-hidden="true"
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
                </defs>
                <For each={connections()}>
                  {(connection) => {
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
                            connection.state === "needs-recording"
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
                            connection.review?.status === "verified"
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
                          class="cursor-pointer fill-none stroke-transparent"
                          stroke-width="16"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
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
              <For each={tree().nodes}>
                {(node) => {
                  const isFlowStart = () => graph().flows.some((flow) => flow.screenId === node.id);
                  return (
                    <ScreenCard
                      node={node}
                      step={draft.steps()[node.representativeStepIndex]}
                      isFlowStart={isFlowStart()}
                      title={titleFor(node)}
                      selected={selectedNode()?.id === node.id}
                      editing={renamingNodeId() === node.id}
                      position={positionFor(node)}
                      src={() => screenshotUrl(server, draft.steps()[node.representativeStepIndex])}
                      onSelect={() => selectNode(node)}
                      onRename={() => setRenamingNodeId(node.id)}
                      onCommitRename={(title) => renameScreen(node, title)}
                      onRecord={() => {
                        selectNode(node);
                        recordFromNode(node);
                      }}
                      onConnectStart={(event) => beginConnection(event, node.id)}
                      onPointerDown={(event) => {
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
                  onRecord={recordFromHere}
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
                    captures: reusableCaptures().filter(
                      (capture) => capture.id !== connection().takeId,
                    ),
                    behaviors: reusableBehaviors(),
                    onRecord: () => recordConnection(connection()),
                    onBack: () => attachBackBehavior(connection()),
                    onAutomatic: () => attachAutomaticBehavior(connection()),
                    onAttachCapture: (takeId) => attachCapture(connection(), takeId),
                    onAttachBehavior: (recipeId) => attachReusableBehavior(connection(), recipeId),
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
                    },
                  }}
                  onRemove={() => removeConnection(connection())}
                />
              )}
            </Show>
            <div class="absolute right-4 bottom-4 z-20 flex items-center gap-1 rounded-[10px] border border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_92%,transparent)] p-1 shadow-[var(--v2-elevation-floating)] backdrop-blur-[12px]">
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
              <button type="button" class={mapControlButton} onClick={fit}>
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
              onKeep={keepTake}
              onDiscard={discardTake}
              onReplay={() => void replayTake()}
              onRewrite={rewriteTake}
              replayState={takeReplay().takeId === take().id ? takeReplay().state : "idle"}
              {...(takeReplay().takeId === take().id && takeReplay().error
                ? { replayError: takeReplay().error }
                : {})}
              onRemove={(index) => {
                recorder.removeTakeStep(index);
                setTakeReplay({ takeId: take().id, state: "idle" });
                setReviewStepIndex((selected) => (selected > index ? selected - 1 : selected));
              }}
            />
            <section
              class="relative min-h-0 min-w-0 overflow-hidden border-l border-[var(--v2-border-border-muted)]"
              aria-label="Recorded action playback"
            >
              <RecordedTakePlayer
                take={take()}
                selectedIndex={reviewStepIndex()}
                onSelect={setReviewStepIndex}
                screenshotFor={(step) => screenshotUrl(server, step)}
                videoSrc={take().videoTakeId ? server.iosVideoUrl(take().videoTakeId!) : undefined}
                clip={take().videoClip}
                onClip={(clip: JourneyVideoClip) => {
                  recorder.setTakeVideoClip(clip);
                  setTakeReplay({ takeId: take().id, state: "idle" });
                }}
              />
            </section>
          </>
        )}
      </Show>
      <Show when={captureOpen() && !reviewingTake()}>
        <aside
          class="relative flex min-h-0 min-w-0 flex-col bg-[var(--v2-background-bg-base)]"
          aria-label="Device capture"
        >
          <Show
            when={recorder.recording() && recorder.take()}
            fallback={
              <div class="flex h-10 shrink-0 items-center justify-between border-b border-[var(--v2-border-border-muted)] px-4">
                <div class="flex min-w-0 items-center gap-2">
                  <i class="size-1.5 shrink-0 rounded-full bg-[var(--icon-success-base)]" />
                  <strong class="truncate text-[11px] font-semibold text-[var(--text-strong)]">
                    Live device
                  </strong>
                  <span class="text-[10px] text-[var(--text-weak)]">Recording off</span>
                </div>
                <div class="flex items-center gap-1">
                  <button type="button" class={recordButton} onClick={recordFromHere}>
                    <i class="size-1.5 rounded-full bg-[var(--icon-critical-base)]" />
                    Record
                  </button>
                  <button
                    type="button"
                    class={mapControlButton}
                    aria-label="Open device workspace"
                    title="Open device workspace"
                    onClick={props.onLive}
                  >
                    <Icon name="arrow-right" size={13} />
                  </button>
                  <button
                    type="button"
                    class={mapControlButton}
                    aria-label="Close device capture"
                    onClick={() => setCaptureOpen(false)}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              </div>
            }
          >
            {(take) => (
              <TakeCaptureBar
                take={take()}
                contextLabel={captureContextLabel()}
                onStop={() => void recorder.stopRecording()}
                onOpenDevice={props.onLive}
              />
            )}
          </Show>
          <div class="min-h-0 flex-1">
            <DeviceStage onOpenTargets={props.onOpenTargets} recordingControls="embedded" />
          </div>
        </aside>
      </Show>
    </section>
  );
}

const recordButton =
  "inline-flex h-7 items-center gap-1.5 rounded-[7px] bg-[var(--product-accent-soft)] px-2.5 text-[10.5px] font-semibold text-[var(--text-interactive-base)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] active:scale-[0.97]";
const mapControlButton =
  "grid h-7 min-w-7 place-items-center rounded-[7px] px-1.5 text-[10px] text-[var(--text-base)] transition-colors duration-100 hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-border-strong-focus";

function screenshotUrl(server: ReturnType<typeof useServer>, step: RecipeStep | undefined): string {
  const screenshot = evidenceForStep(step)?.screenshot;
  return screenshot ? server.recordingEvidenceUrl(screenshot.recipeId, screenshot.id) : "";
}
