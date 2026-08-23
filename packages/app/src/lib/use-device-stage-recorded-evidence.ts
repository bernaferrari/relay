import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
  type Setter,
} from "solid-js";
import { useAppMapExecution } from "../context/app-map-execution";
import { useRecorder } from "../context/recorder";
import { useServer, type RecipeStep } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { RECORDED_OTHER_ELEMENT_PICKING } from "./product-capabilities";
import { DEFAULT_TOUCH_BOUNDS, frameDataUrl } from "./stage-presentation";
import { sentenceForStep } from "./step-sentence";
import { defaultStrategy } from "./step-target";
import {
  pointForAnchor,
  recordedNodeHierarchy,
  recordedNodeMatches,
  recordedTargetNodes,
  targetHierarchy,
  targetHighlight,
  targetNodeIndex,
  targetPointGuide,
} from "./target-inspector";

export type DeviceStageView = "recorded" | "live";
export type DeviceStageSwipeEndpoint = "from" | "to";

export function useDeviceStageRecordedEvidence(options: {
  stageView: Accessor<DeviceStageView>;
  setStageView: Setter<DeviceStageView>;
  liveSurfaceSrc: Accessor<string>;
  liveCaption: Accessor<string | undefined>;
}) {
  const server = useServer();
  const recorder = useRecorder();
  const workbench = useWorkbench();
  const execution = useAppMapExecution();

  const focusedStep = createMemo(() => {
    const index = workbench.focusedIndex();
    if (index == null || index < 0) return null;
    const step = execution.steps()[index];
    return {
      index,
      title: step ? sentenceForStep(step) : `Step ${index + 1}`,
    };
  });
  const focusedPlanStep = () => {
    const index = workbench.focusedIndex() ?? 0;
    return index < 0 ? undefined : execution.steps()[index];
  };
  const plannedFocus = createMemo(() => {
    const explicit = focusedStep();
    if (explicit) return explicit;
    const first = execution.steps()[0];
    return first ? { index: 0, title: sentenceForStep(first) } : null;
  });

  const [stepPlayback, setStepPlayback] = createSignal<{
    index: number;
    token: number;
    step: RecipeStep;
  } | null>(null);
  const recordedEvidenceSrc = createMemo(() => {
    const playback = stepPlayback();
    const step = playback?.step ?? execution.steps()[workbench.focusedIndex() ?? 0];
    const screenshot = step?.evidence?.screenshot;
    return screenshot ? server.recordingEvidenceUrl(screenshot.recipeId, screenshot.id) : "";
  });
  const displayImageSrc = createMemo(() => {
    if (stepPlayback()) return recordedEvidenceSrc();

    const traceFrame = workbench.focusedTraceStep()?.frames.at(-1);
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
      const reviewed = workbench.reviewedRun();
      if (reviewed?.kind === "disk") {
        return server.frameUrlForPersisted(reviewed.run, traceFrame);
      }
    }

    if (options.stageView() === "live") return options.liveSurfaceSrc();
    const recorded = recordedEvidenceSrc();
    if (recorded) return recorded;
    if (workbench.focusedIndex() != null) return "";
    const current = server.currentFrame();
    return current ? frameDataUrl(current) : "";
  });
  const displayCaption = createMemo(() => {
    const traceCaption = workbench.focusedTraceStep()?.frames.at(-1)?.caption;
    if (traceCaption) return traceCaption;
    if (options.stageView() === "live") return options.liveCaption() ?? "Live device";
    if (recordedEvidenceSrc()) return focusedStep()?.title ?? "Recorded device evidence";
    return workbench.focusedIndex() == null ? (server.currentFrame()?.caption ?? "") : "";
  });

  let previewKey = "";
  createEffect(() => {
    const index = workbench.focusedIndex();
    const recorded = recordedEvidenceSrc();
    const nextKey = `${index ?? "none"}:${recorded}`;
    if (nextKey === previewKey) return;
    previewKey = nextKey;
    options.setStageView(index != null && recorded ? "recorded" : "live");
  });
  createEffect(() => {
    if (recorder.recording()) options.setStageView("live");
  });

  const focusedEvidenceHighlight = createMemo(() => {
    if (!recordedEvidenceSrc() || displayImageSrc() !== recordedEvidenceSrc()) return undefined;
    const step = execution.steps()[workbench.focusedIndex() ?? 0];
    if (step?.kind !== "tap" || !step.evidence || defaultStrategy(step.target) === "point") {
      return undefined;
    }
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
    return bounds?.width && bounds.height ? { from: step.from, to: step.to, bounds } : undefined;
  });
  const playbackBounds = createMemo(() => {
    const step = stepPlayback()?.step;
    if (!step) return undefined;
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
    return playback?.index === workbench.focusedIndex() && playback.step.kind === "swipe"
      ? { index: playback.index, token: playback.token, step: playback.step }
      : undefined;
  });

  let playbackTimer: number | undefined;
  createEffect(() => {
    const request = workbench.previewRequest();
    if (!request) return;
    const step = execution.steps()[request.index];
    if (!step) return;
    if (workbench.focusedIndex() !== request.index) workbench.focusStep(request.index);
    if (step.evidence?.screenshot) options.setStageView("recorded");
    setStepPlayback({ ...request, step });
    workbench.clearPreviewRequest(request.token);
    if (playbackTimer) clearTimeout(playbackTimer);
    const duration =
      step.kind === "swipe" ? Math.max(180, Math.min(step.durationMs ?? 300, 900)) : 720;
    playbackTimer = window.setTimeout(() => setStepPlayback(null), duration);
  });
  onCleanup(() => {
    if (playbackTimer) clearTimeout(playbackTimer);
  });

  function updateFocusedSwipePoint(
    endpoint: DeviceStageSwipeEndpoint,
    point: { x: number; y: number },
  ): void {
    const index = workbench.focusedIndex() ?? (execution.steps().length ? 0 : undefined);
    const step = index == null ? undefined : execution.steps()[index];
    if (index == null || step?.kind !== "swipe") return;
    void execution.updateConnectionStep(index, {
      ...step,
      [endpoint]: { ...step[endpoint], ...point },
    });
  }

  const recordedCoordinateEditable = createMemo(() => {
    const step = focusedPlanStep();
    return (
      options.stageView() === "recorded" &&
      Boolean(recordedEvidenceSrc()) &&
      step?.kind === "tap" &&
      defaultStrategy(step.target) === "point"
    );
  });
  const [recordedScreenHovered, setRecordedScreenHovered] = createSignal(false);
  const [recordedHoverNode, setRecordedHoverNode] = createSignal<
    ReturnType<typeof recordedTargetNodes>[number] | null
  >(null);
  const clearRecordedNodeHover = () => setRecordedHoverNode(null);
  const recordedNodes = createMemo(() => {
    const step = focusedPlanStep();
    return step?.kind === "tap" ? recordedTargetNodes(step.evidence) : [];
  });
  const recordedInspectionActive = () =>
    options.stageView() === "recorded" &&
    !recordedCoordinateEditable() &&
    recordedNodes().length > 0;
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
    if (!recordedInspectionActive()) return;
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
    const index = workbench.focusedIndex();
    const step = index == null ? undefined : execution.steps()[index];
    const node = recordedHoverNode();
    if (
      index == null ||
      step?.kind !== "tap" ||
      !node ||
      !RECORDED_OTHER_ELEMENT_PICKING ||
      !recordedInspectionActive() ||
      defaultStrategy(step.target) === "point"
    ) {
      return;
    }
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

    const alreadyInScope = targetHierarchy(step.evidence).some((candidate) =>
      recordedNodeMatches(candidate, node),
    );
    if (alreadyInScope) {
      void execution.updateConnectionStep(index, { ...step, target });
      setRecordedHoverNode(null);
      return;
    }

    const [selected, ...ancestors] = recordedNodeHierarchy(step.evidence, node);
    void execution.updateConnectionStep(index, {
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

  let recordedCoordinateDragPointer: number | null = null;
  const recordedCoordinateDragging = (pointerId: number) =>
    recordedCoordinateDragPointer === pointerId;
  const beginRecordedCoordinateDrag = (pointerId: number) => {
    recordedCoordinateDragPointer = pointerId;
  };
  const endRecordedCoordinateDrag = (pointerId: number) => {
    if (recordedCoordinateDragPointer !== pointerId) return false;
    recordedCoordinateDragPointer = null;
    return true;
  };
  function moveRecordedCoordinate(element: HTMLImageElement, clientX: number, clientY: number) {
    const index = workbench.focusedIndex();
    const step = index == null ? undefined : execution.steps()[index];
    if (
      index == null ||
      !recordedCoordinateEditable() ||
      step?.kind !== "tap" ||
      !step.target.point
    ) {
      return;
    }
    const bounds = step.evidence?.deviceBounds;
    if (!bounds?.width || !bounds.height) return;
    const rect = element.getBoundingClientRect();
    const x = Math.round(
      Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * bounds.width,
    );
    const y = Math.round(
      Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) * bounds.height,
    );
    void execution.updateConnectionStep(index, {
      ...step,
      target: {
        ...step.target,
        point: { ...step.target.point, x, y, referenceBounds: { ...bounds } },
      },
    });
  }

  return {
    focusedStep,
    focusedPlanStep,
    plannedFocus,
    stepPlayback,
    recordedEvidenceSrc,
    displayImageSrc,
    displayCaption,
    focusedEvidenceHighlight,
    focusedCoordinateGuide,
    focusedSwipePreview,
    playbackBounds,
    swipePlayback,
    updateFocusedSwipePoint,
    recordedCoordinateEditable,
    recordedScreenHovered,
    setRecordedScreenHovered,
    recordedInspectionActive,
    recordedNodeOutlines,
    recordedHoverHighlight,
    updateRecordedNodeHover,
    clearRecordedNodeHover,
    chooseRecordedNode,
    recordedCoordinateDragging,
    beginRecordedCoordinateDrag,
    endRecordedCoordinateDrag,
    moveRecordedCoordinate,
  };
}
