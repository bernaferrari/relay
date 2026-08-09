import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
// createMemo used for focused step label
import { useServer, type RecipeStep, type SnapshotNode } from "../context/server";
import {
  ancestryOf,
  candidateAtPoint,
  nodeAtPoint,
  overlayCandidates,
  strategiesFor,
  type PickStrategy,
} from "../lib/snapshot";
import { useRecorder } from "../context/recorder";
import { useWorkbench } from "../context/workbench";
import { useRecipeDraft } from "../context/recipe-draft";
import { ChooseDeviceEmptyState } from "./choose-device-empty-state";
import { useCommand } from "../context/command";
import { usePlatform } from "../context/platform";
import { sentenceForStep } from "../lib/step-sentence";
import { defaultStrategy } from "../lib/step-target";
import {
  targetHierarchy,
  targetHighlight,
  targetNodeIndex,
  targetPointGuide,
  pointForAnchor,
  recordedTargetNodes,
  recordedNodeHierarchy,
  recordedNodeMatches,
  type HorizontalConstraint,
  type VerticalConstraint,
} from "../lib/target-inspector";
import { cn } from "../lib/cn";
import { humanError } from "../lib/human-error";
import { evidenceForStep } from "./take-step-presentation";
import { targetIsPhysicalIos, targetIsReady } from "../lib/target-presentation";
import { deviceReadiness } from "../lib/device-readiness";
import { RECORDED_OTHER_ELEMENT_PICKING } from "../lib/product-capabilities";
import {
  LIVE_FALLBACK_FRAME_INTERVAL_MS,
  LIVE_IOS_FALLBACK_FRAME_INTERVAL_MS,
  LIVE_SNAPSHOT_INTERVAL_MS,
  POST_INTERACTION_SNAPSHOT_DELAY_MS,
  liveInspectionPolicy,
} from "../lib/live-inspection-policy";
import {
  accessibilityCollectionEnabled,
  accessibilityHoverEnabled,
} from "../lib/accessibility-overlay-mode";
import {
  emptyStageTitle as resolveEmptyStageTitle,
  frameDataUrl,
  hasIosSetupIssueText,
  interactBodyForStrategy,
  iosSetupGuidanceText,
  liveImageStyleFromLayout,
  liveInspectionHint,
  pickerNodeLabel,
  pickerNodeMetaLine,
  PHONE_SHELL,
  resolveDevicePanelState,
} from "../lib/stage-presentation";
import { DeviceVideoStream } from "./device-video-stream";
import {
  companionAccessibilityHighlight,
  companionAccessibilityOutlineStyles,
  companionDisplayedPointToLogical,
  companionFramePresentation,
  companionImageLayout,
  companionLogicalRectToDisplayed,
  companionLogicalViewport,
  companionOrientationEdge,
} from "./app-map-device-companion-geometry";
import { SwipePathPreview, type SwipeEndpoint } from "./swipe-path-preview";
import { StepPlaybackPreview } from "./step-playback-preview";
import { phoneScreen } from "../lib/ui";
import {
  CoordinateTapPreview,
  DEFAULT_TOUCH_BOUNDS,
  DevicePanelStatus,
} from "./device-stage-previews";
import { StageViewToggle, StageRecordingControls, StageInspectionHint } from "./stage-chrome";
import { StageScreenFallback } from "./stage-screen-fallback";
import { StageTargetPicker } from "./stage-target-picker";

/** Device-as-hero stage: phone bezel, frame filmstrip, snapshot rect overlays. */
export function DeviceStage(_props: {
  onExpandBoard?: () => void;
  onOpenTargets?: () => void;
  /**
   * Capture owns the recording lifecycle in the graph workspace. Keeping a
   * second switch and task field beneath the same device makes it unclear
   * which control is authoritative, so embedded stages only keep the useful
   * device utilities here.
   */
  recordingControls?: "full" | "embedded";
  /** The App Map owns the authoritative stream lifecycle while its device
   * companion is open. Keep transient frame misses in a loading state. */
  preparing?: boolean;
  onOrientation?: (orientation: "portrait" | "landscape" | "square" | "unknown") => void;
}) {
  const server = useServer();
  const rec = useRecorder();
  const cmd = useCommand();
  const platform = usePlatform();
  const wb = useWorkbench();
  const draft = useRecipeDraft();
  const embeddedRecordingControls = () => _props.recordingControls === "embedded";

  /** What the artboard is “about” when a step is selected (Uber-style selection). */
  const focusedStep = createMemo(() => {
    const i = wb.focusedIndex();
    if (i == null || i < 0) return null;
    const step = draft.steps()[i];
    if (step) return { index: i, title: sentenceForStep(step, server.recipes()) };
    return { index: i, title: `Step ${i + 1}` };
  });
  /** The raw draft step behind the focus, for accent/icon on the planned view. */
  const focusedPlanStep = () => {
    const i = wb.focusedIndex() ?? 0;
    return i < 0 ? undefined : draft.steps()[i];
  };
  /** Bezel fallback focus — mirrors the outline, which highlights step 1 even
   * before any explicit selection, so the two panes never disagree. */
  const plannedFocus = createMemo(() => {
    const explicit = focusedStep();
    if (explicit) return explicit;
    const first = draft.steps()[0];
    return first ? { index: 0, title: sentenceForStep(first, server.recipes()) } : null;
  });
  const [liveFrameSrc, setLiveFrameSrc] = createSignal("");
  let liveFrameObjectUrl = "";
  createEffect(() => {
    const live = server.liveFrame();
    const previous = liveFrameObjectUrl;
    if (!live?.base64) {
      liveFrameObjectUrl = "";
      setLiveFrameSrc("");
      if (previous) URL.revokeObjectURL(previous);
      return;
    }
    const binary = atob(live.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    liveFrameObjectUrl = URL.createObjectURL(new Blob([bytes], { type: live.mime || "image/png" }));
    setLiveFrameSrc(liveFrameObjectUrl);
    if (previous) URL.revokeObjectURL(previous);
  });
  onCleanup(() => {
    if (liveFrameObjectUrl) URL.revokeObjectURL(liveFrameObjectUrl);
  });
  const [stageView, setStageView] = createSignal<"recorded" | "live">("live");
  const [stepPlayback, setStepPlayback] = createSignal<{
    index: number;
    token: number;
    step: RecipeStep;
  } | null>(null);
  const liveViewActive = () => rec.interacting() && stageView() === "live";
  const liveControlActive = () => liveViewActive() && Boolean(server.selectedLeaseId());
  // A live surface must never borrow an old recording frame. That made the
  // device look awake while it was actually locked or had switched targets.
  const frame = () => (liveViewActive() ? (server.liveFrame() ?? undefined) : undefined);
  // Live mode only paints pixels observed in this preview session. Recorded
  // evidence belongs in Recorded mode; using it as a video bootstrap made an
  // old screenshot flash while the current stream was still connecting.
  const liveSurfaceSrc = () => liveFrameSrc();
  const liveInteractionSurfaceAvailable = () => liveViewActive() && Boolean(liveSurfaceSrc());
  const recordedEvidenceSrc = createMemo(() => {
    // A playback request owns both the marker and its screenshot. Using the
    // focused step alone can pair a preview marker with a frame from a run or
    // a newly focused step, making a perfectly valid X/Y look misplaced.
    const playback = stepPlayback();
    const step = playback?.step ?? draft.steps()[wb.focusedIndex() ?? 0];
    const shot = step ? evidenceForStep(step)?.screenshot : undefined;
    return shot ? server.recordingEvidenceUrl(shot.recipeId, shot.id) : "";
  });
  const displayImageSrc = createMemo(() => {
    // Preview is a replay of the step's captured state, never a run trace.
    // Its coordinates and image must therefore come from the same evidence.
    if (stepPlayback()) return recordedEvidenceSrc();

    const traceFrame = wb.focusedTraceStep()?.frames.at(-1);
    if (traceFrame) {
      if (traceFrame.base64) {
        return `data:${traceFrame.mime || "image/png"};base64,${traceFrame.base64}`;
      }
      const captured = server
        .frames()
        .find(
          (candidate) =>
            candidate.capturedAt === traceFrame.capturedAt ||
            (candidate.path && candidate.path === traceFrame.path),
        );
      if (captured) return frameDataUrl(captured);
      const reviewed = wb.reviewedRun();
      if (reviewed?.kind === "disk") return server.frameUrlForPersisted(reviewed.run, traceFrame);
    }

    if (stageView() === "live") {
      return liveSurfaceSrc();
    }
    const recorded = recordedEvidenceSrc();
    if (recorded) return recorded;
    if (wb.focusedIndex() != null) return "";
    const current = server.currentFrame();
    return current ? frameDataUrl(current) : "";
  });
  const displayCaption = createMemo(() => {
    const traceCaption = wb.focusedTraceStep()?.frames.at(-1)?.caption;
    if (traceCaption) return traceCaption;
    if (stageView() === "live") return frame()?.caption ?? "Live device";
    if (recordedEvidenceSrc()) return focusedStep()?.title ?? "Recorded device evidence";
    return wb.focusedIndex() == null ? (server.currentFrame()?.caption ?? "") : "";
  });
  let previewKey = "";
  createEffect(() => {
    const index = wb.focusedIndex();
    const recorded = recordedEvidenceSrc();
    const nextKey = `${index ?? "none"}:${recorded}`;
    if (nextKey !== previewKey) {
      previewKey = nextKey;
      setStageView(index != null && recorded ? "recorded" : "live");
    }
  });
  createEffect(() => {
    if (rec.recording()) setStageView("live");
  });
  const focusedEvidenceHighlight = createMemo(() => {
    if (!recordedEvidenceSrc() || displayImageSrc() !== recordedEvidenceSrc()) return undefined;
    const index = wb.focusedIndex() ?? 0;
    const step = draft.steps()[index];
    if (step?.kind !== "tap" || !step.evidence) return undefined;
    if (defaultStrategy(step.target) === "point") return undefined;
    const node = targetHierarchy(step.evidence)[targetNodeIndex(step.evidence, step.target)];
    return targetHighlight(node, step.evidence.deviceBounds);
  });
  const focusedCoordinateGuide = createMemo(() => {
    const step = focusedPlanStep();
    if (step?.kind !== "tap" || defaultStrategy(step.target) !== "point") return undefined;
    return targetPointGuide(
      step.target.point,
      step.evidence?.deviceBounds ??
        step.target.point?.referenceBounds ??
        server.snapshot()?.bounds,
    );
  });
  const focusedSwipePreview = createMemo(() => {
    const step = focusedPlanStep();
    if (step?.kind !== "swipe") return undefined;
    const bounds = step.evidence?.deviceBounds ?? server.snapshot()?.bounds;
    if (!bounds?.width || !bounds.height) return undefined;
    return { from: step.from, to: step.to, bounds };
  });
  const playbackBounds = createMemo(() => {
    const playback = stepPlayback();
    if (!playback) return undefined;
    const step = playback.step;
    if (step.evidence?.deviceBounds) return step.evidence.deviceBounds;
    if (step.kind === "tap") {
      return (
        step.target.point?.referenceBounds ?? server.snapshot()?.bounds ?? DEFAULT_TOUCH_BOUNDS
      );
    }
    if (step.kind === "swipe") {
      return (
        step.from.referenceBounds ??
        step.to.referenceBounds ??
        server.snapshot()?.bounds ??
        DEFAULT_TOUCH_BOUNDS
      );
    }
    return server.snapshot()?.bounds ?? DEFAULT_TOUCH_BOUNDS;
  });
  const swipePlayback = createMemo<
    { index: number; token: number; step: Extract<RecipeStep, { kind: "swipe" }> } | undefined
  >(() => {
    const playback = stepPlayback();
    if (!playback || playback.index !== wb.focusedIndex() || playback.step.kind !== "swipe") {
      return undefined;
    }
    return { index: playback.index, token: playback.token, step: playback.step };
  });
  let playbackTimer: number | undefined;
  createEffect(() => {
    const request = wb.previewRequest();
    if (!request) return;
    const step = draft.steps()[request.index];
    if (!step) return;
    if (wb.focusedIndex() !== request.index) wb.focusStep(request.index);
    if (step.evidence?.screenshot) setStageView("recorded");
    setStepPlayback({ ...request, step });
    wb.clearPreviewRequest(request.token);
    if (playbackTimer) clearTimeout(playbackTimer);
    const duration =
      step.kind === "swipe" ? Math.max(180, Math.min(step.durationMs ?? 300, 900)) : 720;
    playbackTimer = window.setTimeout(() => setStepPlayback(null), duration);
  });
  onCleanup(() => {
    if (playbackTimer) clearTimeout(playbackTimer);
  });
  function updateFocusedSwipePoint(endpoint: SwipeEndpoint, point: { x: number; y: number }): void {
    const index = wb.focusedIndex() ?? (draft.steps().length ? 0 : undefined);
    const step = index == null ? undefined : draft.steps()[index];
    if (index == null || step?.kind !== "swipe") return;
    draft.updateStep(index, { ...step, [endpoint]: { ...step[endpoint], ...point } });
  }
  const recordedCoordinateEditable = createMemo(() => {
    const step = focusedPlanStep();
    return (
      stageView() === "recorded" &&
      Boolean(recordedEvidenceSrc()) &&
      step?.kind === "tap" &&
      defaultStrategy(step.target) === "point"
    );
  });
  const [recordedScreenHovered, setRecordedScreenHovered] = createSignal(false);
  const [recordedHoverNode, setRecordedHoverNode] = createSignal<
    ReturnType<typeof recordedTargetNodes>[number] | null
  >(null);
  const recordedNodes = createMemo(() => {
    const step = focusedPlanStep();
    return step?.kind === "tap" ? recordedTargetNodes(step.evidence) : [];
  });
  /** Hovering recorded evidence is always safe. The explicit picker only gates
   * changing a target; it must not hide the captured UI tree. */
  const recordedInspectionActive = () =>
    stageView() === "recorded" && !recordedCoordinateEditable() && recordedNodes().length > 0;
  const recordedNodeOutlines = createMemo(() => {
    if (!recordedInspectionActive()) return [];
    const step = focusedPlanStep();
    const bounds = step?.kind === "tap" ? step.evidence?.deviceBounds : undefined;
    return recordedNodes()
      .map((node) => targetHighlight(node, bounds))
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
  });
  const recordedHoverHighlight = createMemo(() => {
    if (!recordedInspectionActive()) return undefined;
    const step = focusedPlanStep();
    return step?.kind === "tap"
      ? targetHighlight(recordedHoverNode() ?? undefined, step.evidence?.deviceBounds)
      : undefined;
  });
  function updateRecordedNodeHover(
    element: HTMLImageElement,
    clientX: number,
    clientY: number,
  ): void {
    if (stageView() !== "recorded" || recordedCoordinateEditable() || !recordedNodes().length)
      return;
    const step = focusedPlanStep();
    const bounds = step?.kind === "tap" ? step.evidence?.deviceBounds : undefined;
    if (!bounds) return;
    const rect = element.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * bounds.width;
    const y = ((clientY - rect.top) / rect.height) * bounds.height;
    setRecordedHoverNode(
      recordedNodes().find((node) => {
        const nodeRect = node.rect;
        return (
          nodeRect &&
          x >= nodeRect.x &&
          x <= nodeRect.x + nodeRect.width &&
          y >= nodeRect.y &&
          y <= nodeRect.y + nodeRect.height
        );
      }) ?? null,
    );
  }
  function chooseRecordedNode(): void {
    const index = wb.focusedIndex();
    const step = index == null ? undefined : draft.steps()[index];
    const node = recordedHoverNode();
    if (index == null || step?.kind !== "tap" || !node) return;
    if (!RECORDED_OTHER_ELEMENT_PICKING || !recordedInspectionActive()) return;
    // A coordinate target makes the recorded screen a point picker. Pointer
    // events above already move that point; the trailing click must not switch
    // the step back to an element-based target.
    if (defaultStrategy(step.target) === "point") return;
    const point = step.target.point;
    const nodePoint = pointForAnchor(node, "center");
    const strategy = defaultStrategy(step.target);
    const target =
      strategy === "ref" && node.ref
        ? { ref: node.ref, ...(point ? { point } : {}) }
        : strategy === "label" && (node.label || node.value)
          ? { label: node.label ?? node.value!, ...(point ? { point } : {}) }
          : strategy === "text" && (node.value || node.label)
            ? { text: node.value ?? node.label!, ...(point ? { point } : {}) }
            : node.ref
              ? { ref: node.ref, ...(point ? { point } : {}) }
              : node.label || node.value
                ? { label: node.label ?? node.value!, ...(point ? { point } : {}) }
                : nodePoint
                  ? { point: nodePoint }
                  : undefined;
    if (!target || !step.evidence) return;

    const currentHierarchy = targetHierarchy(step.evidence);
    const alreadyInScope = currentHierarchy.some((candidate) =>
      recordedNodeMatches(candidate, node),
    );
    if (alreadyInScope) {
      draft.updateStep(index, { ...step, target });
      setRecordedHoverNode(null);
      return;
    }

    const [selected, ...ancestors] = recordedNodeHierarchy(step.evidence, node);
    draft.updateStep(index, {
      ...step,
      target,
      evidence: {
        ...step.evidence,
        node: selected ?? node,
        ancestors: ancestors.slice(0, 8),
      },
    });
    setRecordedHoverNode(null);
  }
  let recordedCoordinateDrag: { pointerId: number } | null = null;
  function moveRecordedCoordinate(element: HTMLImageElement, clientX: number, clientY: number) {
    const index = wb.focusedIndex();
    const step = index == null ? undefined : draft.steps()[index];
    if (
      index == null ||
      !recordedCoordinateEditable() ||
      step?.kind !== "tap" ||
      !step.target.point
    )
      return;
    const bounds = step.evidence?.deviceBounds;
    if (!bounds?.width || !bounds.height) return;
    const rect = element.getBoundingClientRect();
    const x = Math.round(
      Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * bounds.width,
    );
    const y = Math.round(
      Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) * bounds.height,
    );
    draft.updateStep(index, {
      ...step,
      target: {
        ...step.target,
        point: {
          ...step.target.point,
          x,
          y,
          referenceBounds: { ...bounds },
        },
      },
    });
  }
  const [frameAspect, setFrameAspect] = createSignal("9 / 19.5");
  const [frameRatio, setFrameRatio] = createSignal(9 / 19.5);
  const [liveImageRotation, setLiveImageRotation] = createSignal<"none" | "left" | "right">("none");
  const [liveImageDimensions, setLiveImageDimensions] = createSignal<
    { width: number; height: number } | undefined
  >();
  function updateFrameAspect(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    setFrameAspect(`${width} / ${height}`);
    setFrameRatio(width / height);
  }
  const [videoReady, setVideoReady] = createSignal(false);
  const [videoFailed, setVideoFailed] = createSignal(false);
  const [videoAttempt, setVideoAttempt] = createSignal(0);
  // iOS has to sign and install its local runner once before Relay can ask it
  // for pixels. Keep that preflight separate from frame polling so the stage
  // never briefly promises a loading screen and then jumps to setup.
  const [iosSetupState, setIosSetupState] = createSignal<
    | "idle"
    | "checking"
    | "preparing"
    | "ready"
    | "needs-setup"
    | "developer-mode-disabled"
    | "failed"
  >("idle");
  const [iosSetupCheck, setIosSetupCheck] = createSignal(0);
  let completedIosSetupCheck = "";
  let resumedIosPreview = "";
  // transient tap feedback (positioned in % of the glass)
  const [tapFeedback, setTapFeedback] = createSignal<{ x: number; y: number } | null>(null);
  let feedbackTimer: number | undefined;

  let stageEl: HTMLElement | undefined;
  let deviceScreenEl: HTMLImageElement | undefined;
  let pickerEl: HTMLDivElement | undefined;

  /** Element picker: devtools-style — choose how to address the hit element,
   *  walk up to its parent, and optionally record a step WITHOUT tapping. */
  const [picker, setPicker] = createSignal<{
    fx: number;
    fy: number;
    vx: number;
    vy: number;
    placement: "above" | "below";
    /** ancestry[0] = hit node, up to root (geometric fallback when no parentIndex). */
    ancestry: SnapshotNode[];
    /** current target index into `ancestry` (ArrowUp/Down + breadcrumb walk it). */
    index: number;
  } | null>(null);
  const [strategyId, setStrategyId] = createSignal<PickStrategy["id"]>("point");
  const [horizontalConstraint, setHorizontalConstraint] =
    createSignal<HorizontalConstraint>("left");
  const [verticalConstraint, setVerticalConstraint] = createSignal<VerticalConstraint>("top");
  const [manualPoint, setManualPoint] = createSignal<{ x: number; y: number } | null>(null);

  const ancestry = () => picker()?.ancestry ?? [];
  const pickerNode = () => {
    const p = picker();
    return p ? (p.ancestry[p.index] ?? null) : null;
  };
  const strategies = createMemo(() => {
    const p = picker();
    if (!p) return [] as PickStrategy[];
    return strategiesFor(pickerNode(), server.snapshot(), p.fx, p.fy);
  });
  const constrainedPoint = createMemo(
    () =>
      manualPoint() ??
      strategies().find(
        (strategy): strategy is Extract<PickStrategy, { kind: "point" }> =>
          strategy.kind === "point",
      ),
  );
  const constrainedStrategy = createMemo<PickStrategy | undefined>(() => {
    const point = constrainedPoint();
    return point
      ? {
          id: "point",
          kind: "point",
          x: point.x,
          y: point.y,
          describe: `${point.x}, ${point.y}`,
        }
      : undefined;
  });
  const selectedStrategy = createMemo(() => {
    if (strategyId() === "point") {
      return constrainedStrategy() ?? strategies().find((strategy) => strategy.id === "point");
    }
    return strategies().find((strategy) => strategy.id === strategyId()) ?? strategies()[0];
  });
  /** Bounds-relative rect of the currently-targeted node, for the stage highlight. */
  const pickedHighlight = createMemo(() => {
    const n = pickerNode();
    const b = server.snapshot()?.bounds;
    if (!n?.rect || !b) return null;
    const rect = companionLogicalRectToDisplayed(
      {
        x: n.rect.x / b.width,
        y: n.rect.y / b.height,
        width: n.rect.width / b.width,
        height: n.rect.height / b.height,
      },
      liveImageRotation(),
    );
    return {
      left: `${rect.x * 100}%`,
      top: `${rect.y * 100}%`,
      width: `${rect.width * 100}%`,
      height: `${rect.height * 100}%`,
    };
  });
  function resetCoordinateAnchor(): void {
    setManualPoint(null);
    setHorizontalConstraint("left");
    setVerticalConstraint("top");
  }

  /** Re-target the picker to an ancestry index (breadcrumb click or arrows). */
  function retarget(i: number) {
    setManualPoint(null);
    setPicker((p) => (p ? { ...p, index: Math.max(0, Math.min(i, p.ancestry.length - 1)) } : p));
    const next = picker();
    if (next) {
      resetCoordinateAnchor();
      setStrategyId(
        strategiesFor(pickerNode(), server.snapshot(), next.fx, next.fy)[0]?.id ?? "point",
      );
    }
  }

  /** Execute (Tap mode) or just record (Select-only mode) the chosen strategy. */
  async function pick(strategy: PickStrategy, mode: "tap" | "select"): Promise<void> {
    const p = picker();
    if (!p) return;
    // Preserve the recorded order when a picker tap follows buffered typing.
    await rec.flushType();
    setPicker(null);
    // feedback for deliberate picker taps too
    const displayed = companionLogicalRectToDisplayed(
      { x: p.fx, y: p.fy, width: 0, height: 0 },
      liveImageRotation(),
    );
    setTapFeedback({ x: displayed.x * 100, y: displayed.y * 100 });
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => setTapFeedback(null), 280);

    if (mode === "select") {
      // Select-only: record the chosen-strategy step WITHOUT tapping.
      void rec.recordPick(strategy, p.fx, p.fy, {
        horizontal: horizontalConstraint(),
        vertical: verticalConstraint(),
      });
      return;
    }
    const bounds = server.snapshot()?.bounds;
    const tapPoint = bounds
      ? { x: Math.round(p.fx * bounds.width), y: Math.round(p.fy * bounds.height) }
      : undefined;
    const body = interactBodyForStrategy(strategy, tapPoint);
    let ok = await server.interactStep(body, `tap ${strategy.describe}`);
    // chosen strategy failed (likely no session) — fall back to a coordinate tap
    if (!ok && strategy.kind !== "point" && tapPoint) {
      ok = await server.interactStep(
        { kind: "point", x: tapPoint.x, y: tapPoint.y },
        `tap ${tapPoint.x},${tapPoint.y}`,
      );
    }
    if (ok && rec.recording())
      void rec.recordPick(strategy, p.fx, p.fy, {
        horizontal: horizontalConstraint(),
        vertical: verticalConstraint(),
      });
    // Refresh the fallback image only when needed; let the device UI settle
    // briefly before refreshing accessibility targets.
    if (ok && rec.interacting()) {
      if (videoFailed()) void tickLiveFrame();
      scheduleLiveSnapshot();
    }
  }

  const onStageKey = (e: KeyboardEvent) => {
    if (!picker()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setPicker(null);
      return;
    }
    // Walk the ancestry chain; stop propagation so the command palette's
    // window keydown can't also react while the picker is open.
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      retarget((picker()?.index ?? 0) + 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      retarget((picker()?.index ?? 0) - 1);
    }
  };
  window.addEventListener("keydown", onStageKey);
  onCleanup(() => window.removeEventListener("keydown", onStageKey));

  const onPickerPointerDown = (event: PointerEvent) => {
    if (!picker() || pickerEl?.contains(event.target as Node)) return;
    // The first outside click dismisses the inspector without also tapping the
    // mirrored phone or activating an unrelated control underneath it.
    event.preventDefault();
    event.stopPropagation();
    setPicker(null);
  };
  window.addEventListener("pointerdown", onPickerPointerDown, true);
  onCleanup(() => window.removeEventListener("pointerdown", onPickerPointerDown, true));

  // ── Typing capture (plan 010 step 3.3): route printable keys + Backspace +
  //    Enter to the phone while Record is active. The modal/focus/modifier
  //    gate here keeps palette/dialog/input keys (⌘K included) from leaking to
  //    the device; the recorder owns the buffer + flush.
  const onDriveKey = (e: KeyboardEvent) => {
    if (!liveControlActive()) return;
    if (cmd.modalOpen()) return;
    // Modifier chords belong to the app / command palette, never the phone.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Don't steal keystrokes meant for an app input, textarea, or editor.
    const ae = typeof document !== "undefined" ? document.activeElement : null;
    // Control mode only owns the keyboard after the user focuses the mirrored
    // screen. Record mode remains armed until the user switches it off.
    if (!rec.recording() && ae !== deviceScreenEl) return;
    if (
      ae &&
      (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || (ae as HTMLElement).isContentEditable)
    )
      return;
    if (rec.feedTypeKey(e)) e.preventDefault();
  };
  window.addEventListener("keydown", onDriveKey);
  onCleanup(() => window.removeEventListener("keydown", onDriveKey));

  // ── Live control: auto-refresh the stage image + snapshot while controlling.
  //    Skips a tick while a request is in flight, the tab is hidden, the server
  //    went offline, or the picker popover is open (a mid-hover image swap is
  //    disorienting). The createEffect owns the timers so they follow the Live
  //    toggle and tear down on unmount.
  const [tabVisible, setTabVisible] = createSignal(
    typeof document !== "undefined" ? !document.hidden : true,
  );
  const onVisibility = () => setTabVisible(!document.hidden);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
    onCleanup(() => document.removeEventListener("visibilitychange", onVisibility));
  }

  let frameRequestsInFlight = 0;
  let snapInFlight = false;
  let snapQueued = false;
  let frameTimer: NodeJS.Timeout | undefined;
  let snapTimer: NodeJS.Timeout | undefined;
  let snapRefreshTimer: number | undefined;

  const livePaused = () =>
    !liveViewActive() ||
    !tabVisible() ||
    server.health() !== "online" ||
    picker() !== null ||
    physicalIosRecording() ||
    (currentDevice()?.platform === "ios" && !["preparing", "ready"].includes(iosSetupState()));

  async function tickLiveFrame(): Promise<void> {
    if (livePaused() || frameRequestsInFlight >= 1) return;
    // A physical Apple target serves pixels and accessibility through the same
    // XCTest runner. Overlapping those requests repeatedly interrupts
    // xcodebuild and makes a healthy device look disconnected.
    if (targetIsPhysicalIos(currentDevice()) && snapInFlight) return;
    frameRequestsInFlight += 1;
    try {
      await server.pollLiveFrame();
    } finally {
      frameRequestsInFlight -= 1;
      if (targetIsPhysicalIos(currentDevice()) && snapQueued) {
        snapQueued = false;
        scheduleLiveSnapshot();
      }
    }
  }
  async function tickLiveSnapshot(): Promise<void> {
    if (livePaused()) return;
    if (targetIsPhysicalIos(currentDevice()) && frameRequestsInFlight > 0) {
      snapQueued = true;
      return;
    }
    if (snapInFlight) {
      snapQueued = true;
      return;
    }
    snapInFlight = true;
    try {
      await server.pollLiveSnapshot();
    } finally {
      snapInFlight = false;
      if (snapQueued) {
        snapQueued = false;
        scheduleLiveSnapshot();
      }
    }
  }

  function scheduleLiveSnapshot(delayMs = POST_INTERACTION_SNAPSHOT_DELAY_MS): void {
    if (snapRefreshTimer) clearTimeout(snapRefreshTimer);
    snapRefreshTimer = window.setTimeout(() => {
      snapRefreshTimer = undefined;
      const snapshot = tickLiveSnapshot();
      // Keep a slow fallback responsive to deliberate device input without
      // restoring the old permanent eight-images-per-second hot loop.
      if (usesScreenshotPreview()) {
        if (targetIsPhysicalIos(currentDevice())) void snapshot.then(() => tickLiveFrame());
        else void tickLiveFrame();
      }
    }, delayMs);
  }

  function stopLiveTimers(): void {
    if (frameTimer) {
      clearInterval(frameTimer);
      frameTimer = undefined;
    }
    if (snapTimer) {
      clearInterval(snapTimer);
      snapTimer = undefined;
    }
    if (snapRefreshTimer) {
      clearTimeout(snapRefreshTimer);
      snapRefreshTimer = undefined;
    }
    snapQueued = false;
  }

  createEffect(() => {
    const selected = server.selectedDevice();
    const device = selected
      ? (server.devices().find((candidate) => candidate.serial === selected) ?? null)
      : null;
    const isReady = targetIsReady(device, server.health() === "online");
    if (!isReady || device?.platform !== "ios") {
      completedIosSetupCheck = "";
      resumedIosPreview = "";
      setIosSetupState("idle");
      return;
    }

    const readiness = deviceReadiness(device, server.health() === "online");
    if (readiness.kind === "ios-developer-mode-disabled") {
      setIosSetupState("developer-mode-disabled");
      return;
    }
    if (readiness.kind === "ios-preparing") {
      // Reading the first screen is what asks CoreDevice to activate its DDI.
      // Treat this as real preparation, not a passive state that can spin
      // forever waiting for another application to do the work.
      setIosSetupState("preparing");
      return;
    }

    const checkKey = `${device.serial}:${iosSetupCheck()}`;
    if (completedIosSetupCheck === checkKey) return;
    completedIosSetupCheck = checkKey;
    setIosSetupState("checking");

    void server
      .preflightAppleDeviceSetup()
      .then((configured) => {
        const current = currentDevice();
        // The preflight is asynchronous. Do not let a reply for an iPad that
        // was just disconnected or replaced overwrite the next device's UI.
        if (
          completedIosSetupCheck !== checkKey ||
          current?.platform !== "ios" ||
          current.serial !== device.serial
        ) {
          return;
        }
        // Saved Apple details only mean Relay can attempt preparation; the
        // runner is ready only after it returns a real screen. This avoids a
        // false "ready" state while Xcode is still signing or failing.
        setIosSetupState(configured ? "preparing" : "needs-setup");
      })
      .catch(() => {
        const current = currentDevice();
        if (
          completedIosSetupCheck === checkKey &&
          current?.platform === "ios" &&
          current.serial === device.serial
        ) {
          setIosSetupState("failed");
        }
      });
  });

  // Saving Apple details only gives the runner permission to prepare. Clear a
  // stale frame error once and immediately prove readiness with a new frame.
  createEffect(() => {
    const device = currentDevice();
    if (device?.platform !== "ios" || iosSetupState() !== "preparing") {
      resumedIosPreview = "";
      return;
    }
    const resumeKey = `${device.serial}:${iosSetupCheck()}`;
    if (resumedIosPreview === resumeKey) return;
    resumedIosPreview = resumeKey;
    server.clearLiveCaptureIssue();
    if (liveViewActive()) {
      // The Apple runner is exclusive. Establish pixels first, then semantic
      // inspection; parallel setup requests can restart the runner we just
      // prepared.
      void tickLiveFrame().then(() => tickLiveSnapshot());
    }
  });

  // The first usable frame is the single source of truth for Apple readiness.
  // Do not call an iPad "ready" merely because setup values were saved.
  createEffect(() => {
    if (
      currentDevice()?.platform === "ios" &&
      iosSetupState() === "preparing" &&
      Boolean(displayImageSrc())
    ) {
      setIosSetupState("ready");
    }
  });

  createEffect(() => {
    const issue = server.liveCaptureIssue();
    if (
      currentDevice()?.platform === "ios" &&
      iosSetupState() === "preparing" &&
      issue &&
      /(runner|signing|xcode|provision|team id|bundle id|set.?up)/i.test(issue)
    ) {
      setIosSetupState("failed");
    }
  });

  createEffect(() => {
    const policy = liveInspectionPolicy(
      liveViewActive(),
      usesScreenshotPreview(),
      physicalIosRecording(),
      accessibilityCollectionEnabled(server.accessibilityMode()),
    );
    if (!policy.pollSnapshot && !policy.pollFallbackFrame) return;

    // H.264 owns pixels whenever it is healthy. Accessibility inspection is
    // independent: it stays fresh for hover targets, recording semantics, and
    // physical interactions performed directly on the device.
    if (policy.pollSnapshot) {
      void tickLiveSnapshot();
      snapTimer = setInterval(() => void tickLiveSnapshot(), LIVE_SNAPSHOT_INTERVAL_MS);
    }
    // The video canvas currently shares the evidence branch. A fresh process
    // has no frame yet, so capture one bootstrap image to mount the H.264
    // consumer; healthy video remains the only steady-state pixel transport.
    if (!displayImageSrc()) void tickLiveFrame();
    if (policy.pollFallbackFrame) {
      void tickLiveFrame();
      // Android promotes to H.264 and only polls while recovering.
      // Physical iOS defaults to the go-ios stream; PNG polling is the explicit fallback.
      const frameMs =
        targetIsPhysicalIos(currentDevice()) &&
        (server.appleDeviceSetup()?.setup.iosLivePreview?.backend ?? "go-ios-auto") ===
          "agent-device-png"
          ? LIVE_IOS_FALLBACK_FRAME_INTERVAL_MS
          : LIVE_FALLBACK_FRAME_INTERVAL_MS;
      frameTimer = setInterval(() => void tickLiveFrame(), frameMs);
    }
    onCleanup(stopLiveTimers);
  });

  // ── Accessibility inspection. Hover mode keeps the glass quiet until the
  //    pointer asks for detail; Always deliberately exposes the same filtered
  //    bounds Android developers know from “Show layout bounds”. Full-screen
  //    containers and pure wrappers are removed upstream by overlayCandidates.
  const candidates = createMemo(() => {
    const snap = server.snapshot();
    if (!snap?.nodes?.length || !snap.bounds || snap.inspectable === false) {
      return [] as SnapshotNode[];
    }
    return overlayCandidates(snap.nodes, snap.bounds);
  });

  const accessibilityOutlines = createMemo(() => {
    if (server.accessibilityMode() !== "always") return [];
    const snap = server.snapshot();
    if (!snap?.bounds) return [];
    return companionAccessibilityOutlineStyles(snap.nodes, snap.bounds, liveImageRotation());
  });

  const [hoverPoint, setHoverPoint] = createSignal<{ fx: number; fy: number } | null>(null);
  const hoverNode = createMemo(() => {
    const point = hoverPoint();
    const snap = server.snapshot();
    if (!point || !snap?.bounds) return null;
    return candidateAtPoint(candidates(), snap.bounds, point.fx, point.fy);
  });
  let hoverRaf = 0;

  /** Bounds-relative geometry + chip text for the node under the cursor. */
  const hoverHighlight = createMemo(() =>
    companionAccessibilityHighlight(hoverNode(), server.snapshot()?.bounds, liveImageRotation()),
  );

  /** rAF-throttled hit-test against the candidate list. Captures the image rect
   *  at event time so the deferred frame reads stable geometry. */
  function scheduleHover(img: HTMLElement, cx: number, cy: number): void {
    if (
      !accessibilityHoverEnabled(server.accessibilityMode()) ||
      server.snapshot()?.inspectable === false ||
      hoverRaf
    )
      return;
    const rect = img.getBoundingClientRect();
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const displayed = {
        x: (cx - rect.left) / rect.width,
        y: (cy - rect.top) / rect.height,
      };
      if (displayed.x < 0 || displayed.x > 1 || displayed.y < 0 || displayed.y > 1) {
        setHoverPoint(null);
        return;
      }
      const logical = companionDisplayedPointToLogical(displayed, liveImageRotation());
      setHoverPoint({ fx: logical.x, fy: logical.y });
    });
  }
  function clearHover(): void {
    if (hoverRaf) {
      cancelAnimationFrame(hoverRaf);
      hoverRaf = 0;
    }
    setHoverPoint(null);
  }
  createEffect(() => {
    const mode = server.accessibilityMode();
    if (!accessibilityHoverEnabled(mode)) clearHover();
    if (accessibilityCollectionEnabled(mode) && liveViewActive()) scheduleLiveSnapshot(0);
  });
  onCleanup(() => {
    if (hoverRaf) cancelAnimationFrame(hoverRaf);
    if (moveRaf) cancelAnimationFrame(moveRaf);
    if (wheelRaf) cancelAnimationFrame(wheelRaf);
    if (wheelEndTimer) clearTimeout(wheelEndTimer);
    if (feedbackTimer) clearTimeout(feedbackTimer);
    if (gestureTrailTimer) clearTimeout(gestureTrailTimer);
  });
  /** The mirrored device is always interactive. Recording is an explicit
   *  start/stop action that decides whether interactions are also saved. */
  function toggleRecording(): void {
    setPicker(null);
    if (rec.recording()) void rec.stopRecording();
    else {
      setStageView("live");
      rec.enterRecordMode();
    }
  }

  // ── Mirror gestures: stream the full touch lifecycle over scrcpy control.
  //    The completed gesture is still classified as tap/swipe for recording,
  //    with the old one-shot interaction retained as an automatic fallback.
  //    Right-click opens the picker for deliberate strategy selection.
  let down: {
    fx: number;
    fy: number;
    displayFx: number;
    displayFy: number;
    t: number;
    pointerId: number;
  } | null = null;
  let lastLivePointerActionAt = -Infinity;
  let touchChain = Promise.resolve(false);
  let pendingMove: {
    fx: number;
    fy: number;
    displayFx: number;
    displayFy: number;
    pointerId: number;
  } | null = null;
  let moveRaf = 0;
  let gestureTrail: HTMLDivElement | undefined;
  let gestureTrailLine: SVGLineElement | undefined;
  let gestureTrailHead: HTMLElement | undefined;
  let gestureTrailTimer: number | undefined;
  let pendingWheel: { fx: number; fy: number; dx: number; dy: number } | null = null;
  let wheelBurst: { startedAt: number; dx: number; dy: number } | null = null;
  let wheelChain = Promise.resolve(false);
  let wheelSent = false;
  let wheelRaf = 0;
  let wheelEndTimer: number | undefined;

  function paintGestureTrail(fromX: number, fromY: number, toX: number, toY: number): void {
    if (!gestureTrail || !gestureTrailLine || !gestureTrailHead) return;
    gestureTrail.style.opacity = "1";
    gestureTrailLine.setAttribute("x1", String(fromX * 100));
    gestureTrailLine.setAttribute("y1", String(fromY * 100));
    gestureTrailLine.setAttribute("x2", String(toX * 100));
    gestureTrailLine.setAttribute("y2", String(toY * 100));
    gestureTrailHead.style.left = `${toX * 100}%`;
    gestureTrailHead.style.top = `${toY * 100}%`;
  }

  function settleGestureTrail(): void {
    if (!gestureTrail) return;
    if (gestureTrailTimer) clearTimeout(gestureTrailTimer);
    gestureTrailTimer = window.setTimeout(() => {
      if (gestureTrail) gestureTrail.style.opacity = "0";
    }, 120);
  }

  function companionPointerPoint(
    element: HTMLElement,
    clientX: number,
    clientY: number,
  ): { fx: number; fy: number; displayFx: number; displayFy: number } {
    const rect = element.getBoundingClientRect();
    const displayFx = (clientX - rect.left) / rect.width;
    const displayFy = (clientY - rect.top) / rect.height;
    const logical = companionDisplayedPointToLogical(
      { x: displayFx, y: displayFy },
      liveImageRotation(),
    );
    return { fx: logical.x, fy: logical.y, displayFx, displayFy };
  }

  function queueTouch(
    action: "down" | "move" | "up" | "cancel",
    fx: number,
    fy: number,
  ): Promise<boolean> {
    // The low-latency touch stream is backed by scrcpy and only exists for
    // Android. Sending it for Apple targets creates a noisy 409 before the
    // semantic XCTest interaction succeeds, making one tap look like an
    // error. Return false so the normal recorder interaction is used directly.
    if (currentDevice()?.platform !== "android") return Promise.resolve(false);
    const send = () => server.touchDevice(action, fx, fy);
    touchChain = action === "down" ? send() : touchChain.then((ready) => (ready ? send() : false));
    return touchChain;
  }

  function flushPendingMove(pointerId: number): void {
    if (moveRaf) {
      cancelAnimationFrame(moveRaf);
      moveRaf = 0;
    }
    const move = pendingMove;
    pendingMove = null;
    if (move?.pointerId === pointerId) void queueTouch("move", move.fx, move.fy);
  }

  function cancelGesture(pointerId: number): void {
    const start = down;
    if (!start || start.pointerId !== pointerId) return;
    flushPendingMove(pointerId);
    down = null;
    void queueTouch("cancel", start.fx, start.fy);
  }

  function flushWheel(): void {
    if (wheelRaf) {
      cancelAnimationFrame(wheelRaf);
      wheelRaf = 0;
    }
    const wheel = pendingWheel;
    pendingWheel = null;
    if (!wheel) return;
    // scrcpy accepts signed units in [-1, 1]. DOM wheel signs are opposite
    // Android's scroll axis, so a wheel-down becomes content moving upward.
    const scrollX = Math.max(-1, Math.min(1, -wheel.dx / 80));
    const scrollY = Math.max(-1, Math.min(1, -wheel.dy / 80));
    const send = () => server.scrollDevice(wheel.fx, wheel.fy, scrollX, scrollY);
    wheelChain = wheelSent ? wheelChain.then((ready) => (ready ? send() : false)) : send();
    wheelSent = true;
  }

  function finishWheelBurst(): void {
    flushWheel();
    const burst = wheelBurst;
    wheelBurst = null;
    wheelEndTimer = undefined;
    if (!burst) return;
    const displayedFrom = { x: 0.5, y: 0.5 };
    const displayedTo = {
      x: 0.5 - Math.max(-0.28, Math.min(0.28, burst.dx / 600)),
      y: 0.5 - Math.max(-0.28, Math.min(0.28, burst.dy / 600)),
    };
    const rotation = liveImageRotation();
    const from = companionDisplayedPointToLogical(displayedFrom, rotation);
    const to = companionDisplayedPointToLogical(displayedTo, rotation);
    const durationMs = Math.round(Math.max(80, Math.min(performance.now() - burst.startedAt, 600)));
    void wheelChain.then((live) =>
      rec.driveSwipe(from, to, durationMs, live).then(() => {
        if (rec.interacting()) scheduleLiveSnapshot();
      }),
    );
  }

  /** Open the element picker at a client point (right-click inspection path). */
  function openPickerAt(img: HTMLImageElement, clientX: number, clientY: number): void {
    const r = img.getBoundingClientRect();
    const logical = companionDisplayedPointToLogical(
      { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height },
      liveImageRotation(),
    );
    const fx = logical.x;
    const fy = logical.y;
    const node = nodeAtPoint(server.snapshot(), fx, fy);
    const s = stageEl?.getBoundingClientRect();
    const snap = server.snapshot();
    const anc = node && snap ? ancestryOf(snap, node) : node ? [node] : [];
    const rawX = s ? clientX - s.left : clientX - r.left;
    const rawY = s ? clientY - s.top : clientY - r.top;
    const vx = s ? Math.max(12, Math.min(rawX, Math.max(12, s.width - 264))) : rawX;
    const availableStrategies = strategiesFor(node, snap, fx, fy);
    resetCoordinateAnchor();
    setStrategyId(availableStrategies[0]?.id ?? "point");
    setPicker({
      fx,
      fy,
      vx,
      vy: rawY,
      placement: rawY < 300 ? "below" : "above",
      ancestry: anc,
      index: 0,
    });
  }

  /**
   * Device selection is intentional. Falling back to the first discovered
   * target made this stage say "ready" while the rest of Relay correctly
   * asked the person to choose a device.
   */
  const currentDevice = () => {
    const selected = server.selectedDevice();
    return selected
      ? (server.devices().find((device) => device.serial === selected) ?? null)
      : null;
  };
  const liveImagePresentation = createMemo(() => {
    const frame = liveImageDimensions();
    if (!frame || stageView() !== "live" || !liveSurfaceSrc()) return undefined;
    const nodes = server.snapshot()?.nodes;
    const recordedViewport = rec.recording() ? rec.take()?.sourceViewport : undefined;
    const logicalViewport = companionLogicalViewport(nodes) ?? recordedViewport;
    const pointScale = logicalViewport
      ? Math.max(frame.width, frame.height) /
        Math.max(logicalViewport.width, logicalViewport.height)
      : 1;
    return companionFramePresentation({
      frame,
      logicalViewport:
        logicalViewport && Number.isFinite(pointScale)
          ? {
              width: logicalViewport.width * pointScale,
              height: logicalViewport.height * pointScale,
            }
          : undefined,
      platform: currentDevice()?.platform,
      edge: companionOrientationEdge(nodes, logicalViewport),
    });
  });
  const liveImageLayout = createMemo(() => {
    const presentation = liveImagePresentation();
    return presentation ? companionImageLayout(presentation) : undefined;
  });
  createEffect(() => {
    const presentation = liveImagePresentation();
    if (!presentation) {
      setLiveImageRotation("none");
      _props.onOrientation?.("unknown");
      return;
    }
    setLiveImageRotation(presentation.rotation);
    updateFrameAspect(presentation.dimensions.width, presentation.dimensions.height);
    _props.onOrientation?.(presentation.orientation);
  });
  const targetReady = () => targetIsReady(currentDevice(), server.health() === "online");
  const supportsH264Stream = () => {
    const device = currentDevice();
    if (!device) return false;
    if (device.platform === "android") return true;
    if (device.platform === "ios") {
      const backend = server.appleDeviceSetup()?.setup.iosLivePreview?.backend ?? "go-ios-auto";
      return backend !== "agent-device-png";
    }
    return false;
  };
  const usesScreenshotPreview = () =>
    !supportsH264Stream() || videoFailed() || !server.selectedLeaseId();
  const physicalIosRecording = () => rec.recording() && targetIsPhysicalIos(currentDevice());
  let physicalIosRecordingWasActive = false;
  createEffect(() => {
    const active = physicalIosRecording();
    if (active) {
      // Any capture failure immediately preceding the take belongs to the old
      // preview attempt, not to the recording that now owns the runner.
      server.clearLiveCaptureIssue();
    } else if (physicalIosRecordingWasActive && liveViewActive()) {
      // Stop completes server-side before the projected session leaves the
      // recording state, so it is safe to refresh both pixels and semantics.
      void Promise.all([server.pollLiveFrame(), server.pollLiveSnapshot()]);
    }
    physicalIosRecordingWasActive = active;
  });
  const liveCaptureIssue = () => server.liveCaptureIssue();
  const needsIosSetup = () =>
    currentDevice()?.platform === "ios" && iosSetupState() === "needs-setup";
  const iosReadiness = () => deviceReadiness(currentDevice(), server.health() === "online");
  const developerModeDisabled = () =>
    iosReadiness().kind === "ios-developer-mode-disabled" ||
    /developer mode.*(?:disabled|turn on)|turn on developer mode/i.test(liveCaptureIssue() ?? "");
  const iosDeviceSupportPending = () => iosReadiness().kind === "ios-preparing";
  const hasIosSetupIssue = () =>
    hasIosSetupIssueText({
      developerModeDisabled: developerModeDisabled(),
      needsIosSetup: needsIosSetup(),
      platform: currentDevice()?.platform,
      liveCaptureIssue: liveCaptureIssue(),
    });
  const iosSetupGuidance = () =>
    iosSetupGuidanceText({
      readiness: iosReadiness(),
      liveCaptureIssue: liveCaptureIssue(),
      deviceName: currentDevice()?.name,
    });
  const preparingIosScreen = () =>
    targetReady() &&
    currentDevice()?.platform === "ios" &&
    iosSetupState() === "preparing" &&
    !displayImageSrc() &&
    !liveCaptureIssue();
  const checkingIosSetup = () =>
    targetReady() &&
    currentDevice()?.platform === "ios" &&
    ["idle", "checking"].includes(iosSetupState());
  const emptyStageTitle = () =>
    resolveEmptyStageTitle({
      preparing: _props.preparing,
      targetReady: targetReady(),
      developerModeDisabled: developerModeDisabled(),
      iosDeviceSupportPending: iosDeviceSupportPending(),
      checkingIosSetup: checkingIosSetup(),
      preparingIosScreen: preparingIosScreen(),
    });
  const [inspectionRecovering, setInspectionRecovering] = createSignal(false);
  const [panelRetrying, setPanelRetrying] = createSignal(false);
  const inspectionHint = createMemo(() => {
    const snap = server.snapshot();
    if (stageView() !== "live" || !displayImageSrc() || !snap) return null;
    return liveInspectionHint({
      inspectable: snap.inspectable,
      inspectionState: snap.inspectionState,
      nodeCount: snap.nodes?.length,
    });
  });
  const controlHint = createMemo(() => {
    const issue = server.controlIssue();
    if (stageView() !== "live" || !displayImageSrc() || !issue) return null;
    return {
      title: "View only",
      detail: humanError(issue),
      actionLabel: "Try again",
    };
  });
  const retryInspection = async () => {
    if (inspectionRecovering()) return;
    setInspectionRecovering(true);
    try {
      const recovered = await server.recoverSelectedTarget("observe");
      await Promise.all([server.pollLiveFrame(), server.pollLiveSnapshot()]);
      if (!recovered) {
        /* hint stays until the next snapshot is inspectable */
      }
    } finally {
      setInspectionRecovering(false);
    }
  };
  const devicePanelState = createMemo(() =>
    resolveDevicePanelState({
      serverOnline: server.health() === "online",
      arming: rec.arming(),
      physicalIosRecording: physicalIosRecording(),
      hasDisplayImage: Boolean(displayImageSrc()),
      recordingIssue: rec.recordingIssue(),
      liveCaptureIssue: liveCaptureIssue(),
      developerModeDisabled: developerModeDisabled(),
      iosSetupGuidance: iosSetupGuidance(),
      iosDeviceSupportPending: iosDeviceSupportPending(),
      checkingIosSetup: checkingIosSetup(),
      preparingIosScreen: preparingIosScreen(),
      hasIosSetupIssue: hasIosSetupIssue(),
      deviceName: currentDevice()?.name,
      platform: currentDevice()?.platform,
      openXcodeAvailable: Boolean(platform.openXcode),
      emptyStageTitle: emptyStageTitle(),
    }),
  );
  const videoIdentity = createMemo(() => {
    const serial = currentDevice()?.serial;
    const base = server.serverUrl().replace(/\/+$/, "");
    return targetReady() && serial && base ? `${base}|${serial}` : "";
  });
  const liveVideoSrc = createMemo(() => {
    const identity = videoIdentity();
    if (!identity || !liveControlActive() || !tabVisible() || !supportsH264Stream()) return "";
    const separator = identity.lastIndexOf("|");
    const base = identity.slice(0, separator);
    const serial = identity.slice(separator + 1);
    const lease = server.selectedLeaseId();
    if (!lease) return null;
    return `${base}/device/stream?serial=${encodeURIComponent(serial)}&lease=${encodeURIComponent(lease)}&attempt=${videoAttempt()}`;
  });
  let videoRetryTimer: number | undefined;
  createEffect(() => {
    videoIdentity();
    setVideoReady(false);
    setVideoFailed(false);
  });
  async function retryScreenPreview(): Promise<void> {
    if (currentDevice()?.platform === "ios" && iosSetupState() !== "ready") {
      setIosSetupCheck((check) => check + 1);
      return;
    }
    server.clearLiveCaptureIssue();
    const serial = currentDevice()?.serial;
    // A window that lost a lease while the device was busy cannot recover by
    // polling alone. Re-selecting the same target reacquires control without
    // making the person choose the device a second time.
    if (serial) await server.setSelectedDevice(serial);
    if (serial && currentDevice()?.platform === "ios") {
      const recovered = await server.recoverSelectedTarget("observe");
      if (!recovered) return;
    }
    if (rec.recordingIssue()) {
      void rec.enterRecordMode();
      return;
    }
    void Promise.all([server.pollLiveFrame(), server.pollLiveSnapshot()]);
  }
  async function retryDevicePanel(): Promise<void> {
    if (panelRetrying()) return;
    setPanelRetrying(true);
    try {
      if (server.health() !== "online") {
        await server.retryConnection();
        return;
      }
      await retryScreenPreview();
    } finally {
      setPanelRetrying(false);
    }
  }
  function retryVideo(): void {
    setVideoReady(false);
    setVideoFailed(true);
    if (videoRetryTimer) clearTimeout(videoRetryTimer);
    videoRetryTimer = window.setTimeout(() => {
      setVideoAttempt((attempt) => attempt + 1);
      setVideoFailed(false);
    }, 5000);
  }
  onCleanup(() => {
    if (videoRetryTimer) clearTimeout(videoRetryTimer);
  });
  createEffect(() => {
    if (targetReady()) {
      rec.setInteracting(true);
      return;
    }
    if (!rec.recording()) rec.setInteracting(false);
  });

  return (
    <section
      ref={(el) => {
        stageEl = el;
      }}
      aria-label="Device stage"
      class={cn(
        "relative flex h-full min-h-0 flex-1 flex-col items-center justify-center overflow-hidden",
        embeddedRecordingControls() ? "px-4 py-3" : "px-6 py-5",
      )}
    >
      <Show when={!embeddedRecordingControls() && (targetReady() || recordedEvidenceSrc())}>
        <StageViewToggle
          stageView={stageView()}
          setStageView={setStageView}
          hasRecordedEvidence={Boolean(recordedEvidenceSrc())}
          targetReady={targetReady()}
          recording={rec.recording()}
          videoReady={videoReady()}
          videoFailed={videoFailed()}
        />
      </Show>
      <Show
        when={Boolean(currentDevice()) || Boolean(recordedEvidenceSrc())}
        fallback={
          <ChooseDeviceEmptyState
            purpose="live"
            scanning={server.deviceDiscoveryStatus() === "scanning"}
            offline={server.health() !== "online"}
            onChooseDevice={() => window.dispatchEvent(new CustomEvent("relay:open-device-picker"))}
          />
        }
      >
        <Show when={embeddedRecordingControls() && !devicePanelState()}>
          <div
            class="pointer-events-none absolute inset-[8%] -z-[1] rounded-full opacity-70 blur-3xl"
            style={{
              background:
                "radial-gradient(circle,color-mix(in srgb,var(--text-interactive-base) 9%,transparent),transparent 68%)",
            }}
            aria-hidden="true"
          />
        </Show>
        <Show
          when={devicePanelState()}
          fallback={
            <div
              data-device-chrome
              data-device-content={displayImageSrc() ? "frame" : "status"}
              class={cn(
                PHONE_SHELL,
                "relative z-[2] shrink-0",
                frameRatio() >= 0.65
                  ? "h-auto w-[min(440px,calc(100%-40px))]"
                  : embeddedRecordingControls()
                    ? "h-[min(790px,calc(100%-32px))] w-auto max-w-[min(440px,calc(100%-40px))]"
                    : "h-[min(760px,calc(100%-148px))] w-auto max-w-[min(440px,calc(100%-40px))]",
              )}
              style={{ "aspect-ratio": frameAspect() }}
            >
              <div class={cn(phoneScreen, "relative h-full w-full overflow-hidden rounded-[20px]")}>
                {/* The workbench can preview an uncaptured plan. Embedded Live
                Device instead owns real target readiness, so it never masks a
                setup or capture state with unrelated planned-step content. */}
                <StageScreenFallback
                  arming={rec.arming()}
                  recordingIssue={rec.recordingIssue()}
                  displayImageSrc={displayImageSrc()}
                  embeddedRecordingControls={embeddedRecordingControls()}
                  plannedFocus={plannedFocus()}
                  focusedPlanStep={focusedPlanStep}
                  targetReady={targetReady()}
                  isEmptyDevices={server.isEmptyDevices()}
                  needsIosSetup={needsIosSetup()}
                  developerModeDisabled={developerModeDisabled()}
                  liveCaptureIssue={liveCaptureIssue()}
                  emptyStageTitle={emptyStageTitle()}
                  checkingIosSetup={checkingIosSetup()}
                  preparingIosScreen={preparingIosScreen()}
                  hasIosSetupIssue={hasIosSetupIssue()}
                  iosSetupGuidance={iosSetupGuidance()}
                  onRetryScreenPreview={() => {
                    void retryScreenPreview();
                  }}
                  onEnterRecordMode={() => {
                    void rec.enterRecordMode();
                  }}
                  onSwipePoint={updateFocusedSwipePoint}
                >
                  <Show keyed when={!videoFailed() && liveVideoSrc()}>
                    {(src) => (
                      <div
                        class="pointer-events-none absolute inset-0 z-[1] transition-opacity duration-150"
                        data-device-video-ready={videoReady() ? "true" : "false"}
                        style={{ opacity: videoReady() ? 1 : 0 }}
                      >
                        <DeviceVideoStream
                          src={src}
                          onReady={() => {
                            setVideoFailed(false);
                            setVideoReady(true);
                          }}
                          onFailure={retryVideo}
                          onSize={updateFrameAspect}
                        />
                      </div>
                    )}
                  </Show>
                  <img
                    class={cn(
                      "block h-full w-full touch-none overscroll-contain select-none object-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-strong-focus",
                      rec.recording()
                        ? "cursor-crosshair"
                        : liveControlActive() && "cursor-pointer",
                      recordedCoordinateEditable() && "cursor-crosshair",
                      recordedInspectionActive() && "cursor-pointer",
                    )}
                    ref={(element) => {
                      deviceScreenEl = element;
                    }}
                    alt={displayCaption() || "Recorded device evidence"}
                    aria-label="Interactive device screen"
                    data-live-frame={stageView() === "live" && liveFrameSrc() ? "true" : undefined}
                    src={displayImageSrc()}
                    style={liveImageStyleFromLayout(liveImageLayout())}
                    draggable={false}
                    tabindex={0}
                    onClick={(e) => {
                      chooseRecordedNode();
                      // Pointer capture is the best path for real drags, but
                      // assistive technology, browser automation, and some
                      // embedded Chromium input sources can emit a click
                      // without delivering a matching pointer-up to Solid.
                      // Treat that click as a tap unless pointer-up already
                      // handled it. This keeps human and agent input on the
                      // same recorder operation instead of maintaining a
                      // private automation-only path.
                      if (stageView() !== "live") return;
                      if (!liveInteractionSurfaceAvailable()) return;
                      if (!liveControlActive()) return;
                      if (performance.now() - lastLivePointerActionAt < 250) return;
                      const point = companionPointerPoint(e.currentTarget, e.clientX, e.clientY);
                      down = null;
                      pendingMove = null;
                      lastLivePointerActionAt = performance.now();
                      setTapFeedback({ x: point.displayFx * 100, y: point.displayFy * 100 });
                      if (feedbackTimer) clearTimeout(feedbackTimer);
                      feedbackTimer = window.setTimeout(() => setTapFeedback(null), 280);
                      void rec
                        .driveTap(point.fx, point.fy, false, liveImageDimensions())
                        .then(() => {
                          if (rec.interacting()) scheduleLiveSnapshot();
                        });
                    }}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (img.naturalWidth && img.naturalHeight) {
                        if (stageView() === "live" && liveFrameSrc()) {
                          setLiveImageDimensions({
                            width: img.naturalWidth,
                            height: img.naturalHeight,
                          });
                        } else {
                          updateFrameAspect(img.naturalWidth, img.naturalHeight);
                        }
                      }
                    }}
                    onPointerDown={(e) => {
                      if (recordedCoordinateEditable() && e.button === 0) {
                        const index = wb.focusedIndex();
                        const step = index == null ? undefined : draft.steps()[index];
                        if (index != null && step?.kind === "tap" && step.target.point) {
                          e.preventDefault();
                          e.currentTarget.focus({ preventScroll: true });
                          recordedCoordinateDrag = { pointerId: e.pointerId };
                          e.currentTarget.setPointerCapture(e.pointerId);
                          moveRecordedCoordinate(e.currentTarget, e.clientX, e.clientY);
                        }
                        return;
                      }
                      if (
                        !liveInteractionSurfaceAvailable() ||
                        !liveControlActive() ||
                        e.button !== 0
                      )
                        return;
                      e.currentTarget.focus({ preventScroll: true });
                      const point = companionPointerPoint(e.currentTarget, e.clientX, e.clientY);
                      down = {
                        ...point,
                        t: e.timeStamp,
                        pointerId: e.pointerId,
                      };
                      if (gestureTrailTimer) clearTimeout(gestureTrailTimer);
                      paintGestureTrail(
                        point.displayFx,
                        point.displayFy,
                        point.displayFx,
                        point.displayFy,
                      );
                      e.currentTarget.setPointerCapture(e.pointerId);
                      void queueTouch("down", down.fx, down.fy);
                    }}
                    onPointerMove={(e) => {
                      if (recordedCoordinateDrag?.pointerId === e.pointerId) {
                        moveRecordedCoordinate(e.currentTarget, e.clientX, e.clientY);
                        return;
                      }
                      const start = down;
                      if (!start || start.pointerId !== e.pointerId) return;
                      const point = companionPointerPoint(e.currentTarget, e.clientX, e.clientY);
                      pendingMove = {
                        fx: point.fx,
                        fy: point.fy,
                        displayFx: point.displayFx,
                        displayFy: point.displayFy,
                        pointerId: e.pointerId,
                      };
                      if (!moveRaf) {
                        moveRaf = requestAnimationFrame(() => {
                          moveRaf = 0;
                          const move = pendingMove;
                          pendingMove = null;
                          if (move && down?.pointerId === move.pointerId) {
                            paintGestureTrail(
                              down.displayFx,
                              down.displayFy,
                              move.displayFx,
                              move.displayFy,
                            );
                            void queueTouch("move", move.fx, move.fy);
                          }
                        });
                      }
                    }}
                    onPointerUp={(e) => {
                      if (recordedCoordinateDrag?.pointerId === e.pointerId) {
                        moveRecordedCoordinate(e.currentTarget, e.clientX, e.clientY);
                        recordedCoordinateDrag = null;
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                        return;
                      }
                      if (!liveInteractionSurfaceAvailable() || !liveControlActive()) return;
                      const start = down;
                      if (!start || start.pointerId !== e.pointerId || e.button !== 0) return;
                      const r = e.currentTarget.getBoundingClientRect();
                      const point = companionPointerPoint(e.currentTarget, e.clientX, e.clientY);
                      const fx = point.fx;
                      const fy = point.fy;
                      paintGestureTrail(
                        start.displayFx,
                        start.displayFy,
                        point.displayFx,
                        point.displayFy,
                      );
                      settleGestureTrail();
                      flushPendingMove(e.pointerId);
                      down = null;
                      const appliedLive = queueTouch("up", fx, fy);
                      const dx = (point.displayFx - start.displayFx) * r.width;
                      const dy = (point.displayFy - start.displayFy) * r.height;
                      if (Math.hypot(dx, dy) < 6) {
                        // tap → direct action, no picker
                        // show brief physical feedback at tap location
                        setTapFeedback({ x: start.displayFx * 100, y: start.displayFy * 100 });
                        lastLivePointerActionAt = performance.now();
                        if (feedbackTimer) clearTimeout(feedbackTimer);
                        feedbackTimer = window.setTimeout(() => setTapFeedback(null), 280);

                        void appliedLive.then((live) =>
                          rec.driveTap(start.fx, start.fy, live, liveImageDimensions()).then(() => {
                            if (rec.interacting()) scheduleLiveSnapshot();
                          }),
                        );
                      } else {
                        // drag → swipe, duration clamped to a sane gesture range
                        const durationMs = Math.round(
                          Math.max(80, Math.min(e.timeStamp - start.t, 800)),
                        );
                        void appliedLive.then((live) =>
                          rec
                            .driveSwipe(
                              { x: start.fx, y: start.fy },
                              { x: fx, y: fy },
                              durationMs,
                              live,
                              liveImageDimensions(),
                            )
                            .then(() => {
                              if (rec.interacting()) scheduleLiveSnapshot();
                            }),
                        );
                      }
                    }}
                    onPointerCancel={(e) => {
                      if (recordedCoordinateDrag?.pointerId === e.pointerId) {
                        recordedCoordinateDrag = null;
                        return;
                      }
                      cancelGesture(e.pointerId);
                      settleGestureTrail();
                    }}
                    onLostPointerCapture={(e) => {
                      if (recordedCoordinateDrag?.pointerId === e.pointerId) {
                        recordedCoordinateDrag = null;
                        return;
                      }
                      cancelGesture(e.pointerId);
                      settleGestureTrail();
                    }}
                    onWheel={(e) => {
                      if (!liveInteractionSurfaceAvailable() || !liveControlActive() || down)
                        return;
                      e.preventDefault();
                      e.currentTarget.focus({ preventScroll: true });
                      const r = e.currentTarget.getBoundingClientRect();
                      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
                      const dx = e.deltaX * scale;
                      const dy = e.deltaY * scale;
                      const point = companionPointerPoint(e.currentTarget, e.clientX, e.clientY);
                      const fx = point.fx;
                      const fy = point.fy;
                      if (!wheelBurst) {
                        wheelBurst = { startedAt: performance.now(), dx: 0, dy: 0 };
                        wheelSent = false;
                      }
                      wheelBurst.dx += dx;
                      wheelBurst.dy += dy;
                      if (pendingWheel) {
                        pendingWheel = {
                          fx,
                          fy,
                          dx: pendingWheel.dx + dx,
                          dy: pendingWheel.dy + dy,
                        };
                      } else {
                        pendingWheel = { fx, fy, dx, dy };
                      }
                      if (!wheelRaf) wheelRaf = requestAnimationFrame(flushWheel);
                      if (wheelEndTimer) clearTimeout(wheelEndTimer);
                      wheelEndTimer = window.setTimeout(finishWheelBurst, 90);
                    }}
                    onContextMenu={(e) => {
                      // Right-click = deliberate inspection / strategy selection.
                      if (!liveInteractionSurfaceAvailable() || !liveControlActive()) return;
                      e.preventDefault();
                      openPickerAt(e.currentTarget, e.clientX, e.clientY);
                    }}
                    onMouseMove={(e) => {
                      if (stageView() === "recorded") {
                        setRecordedScreenHovered(recordedInspectionActive());
                        if (recordedInspectionActive()) {
                          updateRecordedNodeHover(e.currentTarget, e.clientX, e.clientY);
                        } else {
                          setRecordedHoverNode(null);
                        }
                        // Overlay inspection follows the accessibility snapshot, not
                        // the PNG fallback. Healthy H.264 deliberately stops PNG
                        // polling, which previously made hover disappear when live
                        // streaming was working best.
                      } else if (liveControlActive()) {
                        scheduleHover(e.currentTarget, e.clientX, e.clientY);
                      }
                    }}
                    onMouseLeave={() => {
                      setRecordedScreenHovered(false);
                      setRecordedHoverNode(null);
                      clearHover();
                    }}
                  />
                  <Show when={stageView() === "recorded" && recordedScreenHovered()}>
                    <For each={recordedNodeOutlines()}>
                      {(highlight) => (
                        <i
                          class="pointer-events-none absolute z-[2] rounded-[2px] border border-[color-mix(in_srgb,var(--text-interactive-base)_34%,transparent)]"
                          style={highlight}
                          data-recorded-node-outline
                          aria-hidden="true"
                        />
                      )}
                    </For>
                  </Show>
                  <Show when={recordedHoverHighlight()}>
                    {(highlight) => (
                      <i
                        class="pointer-events-none absolute z-[3] rounded-[3px] border-[1.5px] border-[var(--text-interactive-base)] bg-[color-mix(in_srgb,var(--text-interactive-base)_12%,transparent)] shadow-[0_0_0_1px_rgb(255_255_255/16%)]"
                        style={highlight()}
                        aria-hidden="true"
                      />
                    )}
                  </Show>
                  <Show when={focusedEvidenceHighlight()}>
                    {(highlight) => (
                      <div
                        class="pointer-events-none absolute z-[3] rounded-[3px] border-[1.5px] border-[var(--text-interactive-base)] bg-[color-mix(in_srgb,var(--text-interactive-base)_18%,transparent)] shadow-[0_0_0_999px_rgb(4_7_14/30%)]"
                        style={highlight()}
                        aria-hidden="true"
                      />
                    )}
                  </Show>
                  <Show when={!stepPlayback() && focusedCoordinateGuide()}>
                    {(guide) => <CoordinateTapPreview guide={guide()} />}
                  </Show>
                  <Show when={focusedSwipePreview()}>
                    {(swipe) => (
                      <SwipePathPreview
                        from={swipe().from}
                        to={swipe().to}
                        bounds={swipe().bounds}
                        onPoint={updateFocusedSwipePoint}
                        previewToken={swipePlayback()?.token}
                        previewDurationMs={swipePlayback()?.step.durationMs}
                      />
                    )}
                  </Show>
                  {stepPlayback() && playbackBounds() && (
                    <StepPlaybackPreview step={stepPlayback()!.step} bounds={playbackBounds()!} />
                  )}
                  <Show
                    when={controlHint()}
                    fallback={
                      <Show when={inspectionHint()}>
                        {(hint) => (
                          <StageInspectionHint
                            title={hint().title}
                            detail={hint().detail}
                            actionLabel={hint().actionLabel}
                            busy={inspectionRecovering()}
                            onRetry={() => {
                              void retryInspection();
                            }}
                          />
                        )}
                      </Show>
                    }
                  >
                    {(hint) => (
                      <StageInspectionHint
                        title={hint().title}
                        detail={hint().detail}
                        actionLabel={hint().actionLabel}
                        onRetry={() => {
                          void retryScreenPreview();
                        }}
                      />
                    )}
                  </Show>
                  <Show when={server.accessibilityMode() === "always" && !picker()}>
                    <div
                      class="pointer-events-none absolute inset-0 z-[3] overflow-hidden rounded-[20px]"
                      aria-hidden="true"
                    >
                      <For each={accessibilityOutlines()}>
                        {(outline) => (
                          <i
                            class="absolute rounded-[2px] border border-[color-mix(in_srgb,var(--border-interactive-base)_46%,transparent)] bg-[color-mix(in_srgb,var(--surface-brand-base)_4%,transparent)]"
                            style={outline}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show
                    when={
                      accessibilityHoverEnabled(server.accessibilityMode()) &&
                      !picker() &&
                      hoverHighlight()
                    }
                  >
                    {(h) => (
                      <div
                        class="pointer-events-none absolute inset-0 z-[4] overflow-hidden rounded-[20px]"
                        aria-hidden="true"
                      >
                        <div
                          class="absolute rounded-[3px] border-[1.5px] border-border-interactive-base bg-surface-brand-base/[0.12]"
                          style={h().rect}
                        />
                      </div>
                    )}
                  </Show>
                  <Show when={pickedHighlight()}>
                    {(h) => (
                      <div
                        class="pointer-events-none absolute z-[5] rounded-[3px] border-[1.6px] border-border-interactive-base bg-surface-brand-base/[0.18]"
                        aria-hidden="true"
                        style={h()}
                      />
                    )}
                  </Show>

                  <div
                    ref={(element) => {
                      gestureTrail = element;
                    }}
                    class="pointer-events-none absolute inset-0 z-[6] opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none"
                    aria-hidden="true"
                  >
                    <svg
                      class="absolute inset-0 h-full w-full"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                    >
                      <line
                        ref={(element) => {
                          gestureTrailLine = element;
                        }}
                        class="stroke-[var(--text-interactive-base)] opacity-80"
                        stroke-width="2"
                        stroke-linecap="round"
                        vector-effect="non-scaling-stroke"
                      />
                    </svg>
                    <i
                      ref={(element) => {
                        gestureTrailHead = element;
                      }}
                      class="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-interactive-base)] shadow-[0_0_0_2px_rgb(255_255_255/88%),0_2px_8px_rgb(0_0_0/35%)]"
                    />
                  </div>

                  {/* tap confirmation ring */}
                  <Show when={tapFeedback()}>
                    {(fb) => (
                      <div
                        class="pointer-events-none absolute z-[6] origin-center rounded-full border-[1.5px] border-border-interactive-base bg-surface-brand-base/20 motion-safe:animate-ping"
                        aria-hidden="true"
                        style={{
                          left: `calc(${fb().x}% - 10px)`,
                          top: `calc(${fb().y}% - 10px)`,
                          width: "20px",
                          height: "20px",
                        }}
                      />
                    )}
                  </Show>
                </StageScreenFallback>
              </div>
              <Show
                when={
                  accessibilityHoverEnabled(server.accessibilityMode()) &&
                  !picker() &&
                  hoverHighlight()
                }
              >
                {(h) => (
                  <div
                    class={cn(
                      "pointer-events-none absolute z-[8] max-w-[72%] overflow-hidden rounded-md bg-surface-brand-base px-1.5 py-0.5 font-mono text-12-regular leading-snug text-ellipsis whitespace-nowrap text-text-on-brand-base shadow-sm",
                      h().chip.below ? "translate-y-1" : "-translate-y-[calc(100%+4px)]",
                    )}
                    style={{
                      left: h().chip.left,
                      top: h().chip.below ? h().chip.bottom : h().chip.top,
                    }}
                    aria-hidden="true"
                  >
                    {h().chip.text}
                  </div>
                )}
              </Show>
            </div>
          }
        >
          {(state) => (
            <DevicePanelStatus
              state={state()}
              busy={panelRetrying()}
              onOpenXcode={() => void platform.openXcode?.()}
              onOpenSettings={() =>
                window.dispatchEvent(
                  new CustomEvent("relay:open-settings", { detail: { section: "devices" } }),
                )
              }
              onRetry={() => {
                void retryDevicePanel();
              }}
            />
          )}
        </Show>
      </Show>

      <Show when={picker() && liveControlActive() && (pickerNode() || rec.recording())}>
        <StageTargetPicker
          picker={() => picker()!}
          setPickerEl={(element) => {
            pickerEl = element;
          }}
          nodeLabel={pickerNodeLabel(pickerNode())}
          metaLine={pickerNodeMetaLine(pickerNode())}
          ancestryLength={ancestry().length}
          strategies={strategies()}
          selectedStrategy={selectedStrategy()}
          strategyId={strategyId()}
          setStrategyId={setStrategyId}
          horizontalConstraint={horizontalConstraint()}
          verticalConstraint={verticalConstraint()}
          setHorizontalConstraint={setHorizontalConstraint}
          setVerticalConstraint={setVerticalConstraint}
          constrainedPoint={constrainedPoint()}
          setManualPoint={setManualPoint}
          hasPickerNodeRect={Boolean(pickerNode()?.rect)}
          onClose={() => setPicker(null)}
          onRetarget={retarget}
          onAddStep={(strategy) => {
            void pick(strategy, "select");
          }}
          onTapDevice={(strategy) => {
            void pick(strategy, "tap");
          }}
        />
      </Show>

      {/* Device-only utilities stay outside embedded capture, where the
          recording bar is the single source of control. */}
      <Show when={targetReady() && !embeddedRecordingControls()}>
        <StageRecordingControls
          stageView={stageView()}
          recording={rec.recording()}
          recordingGroup={rec.recordingGroup()}
          setRecordingGroup={rec.setRecordingGroup}
          startNextRecordingGroup={rec.startNextRecordingGroup}
          selectedLeaseId={server.selectedLeaseId()}
          busyCapture={server.busyCapture()}
          frameCount={server.frames().length}
          onToggleRecording={toggleRecording}
          onCaptureScreenshot={() => {
            void server.captureUiScreenshot();
          }}
          onCopyScreenshot={() => {
            void server.copyUiScreenshot();
          }}
          onClearFrames={() => server.clearFrames()}
        />
      </Show>
    </section>
  );
}
