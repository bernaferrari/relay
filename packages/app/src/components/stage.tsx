import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
// createMemo used for focused step label
import { useServer, type SnapshotNode } from "../context/server";
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
import { Icon } from "./icon";
import { DeviceConnectState } from "./device-connect-state";
import { DeviceEvidenceEmptyState } from "./device-evidence-empty-state";
import { IconButton } from "@relay/ui/icon-button";
import { Switch } from "@relay/ui/switch";
import { useCommand } from "../context/command";
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
import { accentForStep, evidenceForStep, iconForStep } from "./journey-step-presentation";
import { withRefreshFeedback } from "../lib/refresh-feedback";
import {
  LIVE_SNAPSHOT_INTERVAL_MS,
  POST_INTERACTION_SNAPSHOT_DELAY_MS,
  liveInspectionPolicy,
} from "../lib/live-inspection-policy";
import { DeviceVideoStream } from "./device-video-stream";
import { CoordinateConstraintPicker } from "./coordinate-constraint-picker";
import {
  deviceCaption,
  deviceIconWell,
  deviceTitle,
  mono,
  phoneBezel,
  phoneScreen,
  popover,
} from "../lib/ui";

/** Device-as-hero stage: phone bezel, frame filmstrip, snapshot rect overlays. */
export function DeviceStage(_props: { onExpandBoard?: () => void; onOpenTargets?: () => void }) {
  const server = useServer();
  const rec = useRecorder();
  const cmd = useCommand();
  const wb = useWorkbench();
  const draft = useRecipeDraft();
  const [refreshingTarget, setRefreshingTarget] = createSignal(false);
  async function refreshTarget(): Promise<void> {
    if (refreshingTarget()) return;
    setRefreshingTarget(true);
    try {
      await withRefreshFeedback(async () => {
        await server.pollHealth();
        if (server.health() === "online") await server.refreshDevices();
      });
    } finally {
      setRefreshingTarget(false);
    }
  }

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
  const frameDataUrl = (value: { mime: string; base64: string }) =>
    `data:${value.mime};base64,${value.base64}`;
  const [stageView, setStageView] = createSignal<"recorded" | "live">("live");
  const liveControlActive = () => rec.interacting() && stageView() === "live";
  const frame = () =>
    liveControlActive() ? (server.liveFrame() ?? server.currentFrame()) : undefined;
  const recordedEvidenceSrc = createMemo(() => {
    const index = wb.focusedIndex() ?? 0;
    const step = draft.steps()[index];
    const shot = step ? evidenceForStep(step)?.screenshot : undefined;
    return shot ? server.recordingEvidenceUrl(shot.recipeId, shot.id) : "";
  });
  const displayImageSrc = createMemo(() => {
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

    const recorded = recordedEvidenceSrc();
    if (stageView() === "recorded" && recorded) return recorded;
    if (liveControlActive()) {
      const live = server.liveFrame() ?? server.currentFrame();
      if (live) return frameDataUrl(live);
    }
    if (recorded) return recorded;
    if (wb.focusedIndex() != null) return "";
    const current = server.currentFrame();
    return current ? frameDataUrl(current) : "";
  });
  const displayCaption = createMemo(() => {
    const traceCaption = wb.focusedTraceStep()?.frames.at(-1)?.caption;
    if (traceCaption) return traceCaption;
    if (stageView() === "recorded" && recordedEvidenceSrc())
      return focusedStep()?.title ?? "Recorded device evidence";
    if (liveControlActive() && frame()) return frame()!.caption ?? "Live device";
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
      step.evidence?.deviceBounds ?? server.snapshot()?.bounds,
    );
  });
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
  const recordedNodeOutlines = createMemo(() => {
    if (recordedCoordinateEditable()) return [];
    const step = focusedPlanStep();
    const bounds = step?.kind === "tap" ? step.evidence?.deviceBounds : undefined;
    return recordedNodes()
      .map((node) => targetHighlight(node, bounds))
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
  });
  const recordedHoverHighlight = createMemo(() => {
    if (recordedCoordinateEditable()) return undefined;
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
    if (stageView() !== "recorded" || recordedCoordinateEditable()) return;
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
  const [videoReady, setVideoReady] = createSignal(false);
  const [videoFailed, setVideoFailed] = createSignal(false);
  const [videoAttempt, setVideoAttempt] = createSignal(0);
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
    return {
      left: `${(n.rect.x / b.width) * 100}%`,
      top: `${(n.rect.y / b.height) * 100}%`,
      width: `${(n.rect.width / b.width) * 100}%`,
      height: `${(n.rect.height / b.height) * 100}%`,
    };
  });

  const nodeLabel = () => {
    const n = pickerNode();
    const visible = (n?.label ?? n?.value ?? n?.identifier ?? "").trim();
    if (visible) return visible;
    const kind = n?.role ?? n?.type?.split(".").pop();
    return kind ? `Unnamed ${kind}` : "Screen position";
  };
  /** Compact human metadata; implementation references live in strategy rows. */
  const metaLine = () => {
    const n = pickerNode();
    if (!n) return "";
    const parts: string[] = [];
    const kind = n.role ?? n.type?.split(".").pop();
    if (kind) parts.push(kind);
    if (n.rect) parts.push(`${Math.round(n.rect.width)}×${Math.round(n.rect.height)}`);
    return parts.join(" · ");
  };

  function strategyLabel(strategy: PickStrategy): string {
    if (strategy.kind === "ref") return "Element reference";
    if (strategy.kind === "label") return "Accessibility label";
    if (strategy.kind === "text") return "Visible text";
    return "Coordinates";
  }

  function strategyValue(strategy: PickStrategy): string {
    if (strategy.kind === "ref") return strategy.ref;
    if (strategy.kind === "label") return strategy.label;
    if (strategy.kind === "text") return strategy.text;
    return `${strategy.x}, ${strategy.y}`;
  }

  function strategyIcon(strategy: PickStrategy): "pointer" | "edit" | "scan" {
    if (strategy.kind === "point") return "scan";
    if (strategy.kind === "ref") return "pointer";
    return "edit";
  }

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
    setTapFeedback({ x: p.fx * 100, y: p.fy * 100 });
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
    const body =
      strategy.kind === "ref"
        ? ({ kind: "ref", ref: strategy.ref } as const)
        : strategy.kind === "label"
          ? ({ kind: "label", label: strategy.label } as const)
          : strategy.kind === "text"
            ? ({ kind: "text-match", match: strategy.text } as const)
            : ({ kind: "point", x: strategy.x, y: strategy.y } as const);
    let ok = await server.interactStep(body, `tap ${strategy.describe}`);
    // chosen strategy failed (likely no session) — fall back to a coordinate tap
    if (!ok && strategy.kind !== "point") {
      const b = server.snapshot()?.bounds;
      const fx = Math.round(p.fx * (b?.width ?? 1));
      const fy = Math.round(p.fy * (b?.height ?? 1));
      ok = await server.interactStep({ kind: "point", x: fx, y: fy }, `tap ${fx},${fy}`);
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
    !liveControlActive() || !tabVisible() || server.health() !== "online" || picker() !== null;

  async function tickLiveFrame(): Promise<void> {
    const concurrency = !videoReady() && videoFailed() ? 2 : 1;
    if (livePaused() || frameRequestsInFlight >= concurrency) return;
    frameRequestsInFlight += 1;
    try {
      await server.pollLiveFrame();
    } finally {
      frameRequestsInFlight -= 1;
    }
  }
  async function tickLiveSnapshot(): Promise<void> {
    if (livePaused()) return;
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
      void tickLiveSnapshot();
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
    const policy = liveInspectionPolicy(liveControlActive(), videoFailed());
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
      frameTimer = setInterval(() => void tickLiveFrame(), 125);
    }
    onCleanup(stopLiveTimers);
  });

  // ── Hover-inspect: exactly one highlighted element under the cursor
  //    (devtools-style), not the old grid of 80 translucent rects. The
  //    background-tint bug is fixed upstream by `overlayCandidates` (full-screen
  //    containers and pure wrappers never become candidates).
  const candidates = createMemo(() => {
    const snap = server.snapshot();
    if (!snap?.nodes?.length || !snap.bounds) return [] as SnapshotNode[];
    return overlayCandidates(snap.nodes, snap.bounds);
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
  const hoverHighlight = createMemo(() => {
    const n = hoverNode();
    const b = server.snapshot()?.bounds;
    if (!n?.rect || !b) return null;
    const leftPct = (n.rect.x / b.width) * 100;
    const topPct = (n.rect.y / b.height) * 100;
    const heightPct = (n.rect.height / b.height) * 100;
    const label = (n.label ?? n.value ?? n.identifier ?? "").trim() || n.role || "element";
    const ref = n.ref ? (n.ref.startsWith("@") ? n.ref : `@${n.ref}`) : "";
    return {
      rect: {
        left: `${leftPct}%`,
        top: `${topPct}%`,
        width: `${(n.rect.width / b.width) * 100}%`,
        height: `${heightPct}%`,
      },
      chip: {
        left: `${Math.max(0, Math.min(leftPct, 100))}%`,
        top: `${topPct}%`,
        bottom: `${topPct + heightPct}%`,
        // flip the chip below the rect when there's no room above it
        below: topPct < 8,
        text: ref ? `${label} · ${ref}` : label,
      },
    };
  });

  /** rAF-throttled hit-test against the candidate list. Captures the image rect
   *  at event time so the deferred frame reads stable geometry. */
  function scheduleHover(img: HTMLElement, cx: number, cy: number): void {
    if (!server.showOverlays() || hoverRaf) return;
    const rect = img.getBoundingClientRect();
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const fx = (cx - rect.left) / rect.width;
      const fy = (cy - rect.top) / rect.height;
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1) {
        setHoverPoint(null);
        return;
      }
      setHoverPoint({ fx, fy });
    });
  }
  function clearHover(): void {
    if (hoverRaf) {
      cancelAnimationFrame(hoverRaf);
      hoverRaf = 0;
    }
    setHoverPoint(null);
  }
  onCleanup(() => {
    if (hoverRaf) cancelAnimationFrame(hoverRaf);
    if (moveRaf) cancelAnimationFrame(moveRaf);
    if (wheelRaf) cancelAnimationFrame(wheelRaf);
    if (wheelEndTimer) clearTimeout(wheelEndTimer);
    if (feedbackTimer) clearTimeout(feedbackTimer);
  });
  /** The mirrored device is always interactive. Recording is one independent
   *  switch that decides whether those interactions are also saved as steps. */
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
  let down: { fx: number; fy: number; t: number; pointerId: number } | null = null;
  let touchChain = Promise.resolve(false);
  let pendingMove: { fx: number; fy: number; pointerId: number } | null = null;
  let moveRaf = 0;
  let pendingWheel: { fx: number; fy: number; dx: number; dy: number } | null = null;
  let wheelBurst: { startedAt: number; dx: number; dy: number } | null = null;
  let wheelChain = Promise.resolve(false);
  let wheelSent = false;
  let wheelRaf = 0;
  let wheelEndTimer: number | undefined;

  function queueTouch(
    action: "down" | "move" | "up" | "cancel",
    fx: number,
    fy: number,
  ): Promise<boolean> {
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
    const from = { x: 0.5, y: 0.5 };
    const to = {
      x: 0.5 - Math.max(-0.28, Math.min(0.28, burst.dx / 600)),
      y: 0.5 - Math.max(-0.28, Math.min(0.28, burst.dy / 600)),
    };
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
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
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

  /** The selected device stays authoritative across transient disconnects. */
  const currentDevice = () => {
    const selected = server.selectedDevice();
    return selected
      ? (server.devices().find((device) => device.serial === selected) ?? null)
      : (server.devices()[0] ?? null);
  };
  const targetReady = () => {
    const device = currentDevice();
    return server.health() === "online" && Boolean(device) && device?.booted !== false;
  };
  const videoIdentity = createMemo(() => {
    const serial = currentDevice()?.serial;
    const base = server.serverUrl().replace(/\/+$/, "");
    return targetReady() && serial && base ? `${base}|${serial}` : "";
  });
  const liveVideoSrc = createMemo(() => {
    const identity = videoIdentity();
    if (!identity || !liveControlActive()) return "";
    const separator = identity.lastIndexOf("|");
    const base = identity.slice(0, separator);
    const serial = identity.slice(separator + 1);
    return `${base}/device/stream?serial=${encodeURIComponent(serial)}&attempt=${videoAttempt()}`;
  });
  let videoRetryTimer: number | undefined;
  createEffect(() => {
    videoIdentity();
    setVideoReady(false);
    setVideoFailed(false);
  });
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

  /**
   * Abstract device viewport — thin always-dark frame, no hardware gimmicks.
   * Never stack workbench light-theme color recipes on the frame.
   */
  const phoneShell = cn(phoneBezel, "relative rounded-[18px]");

  return (
    <section
      ref={(el) => {
        stageEl = el;
      }}
      aria-label="Device stage"
      class="relative flex h-full min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-6 py-5"
    >
      <Show when={targetReady() || recordedEvidenceSrc()}>
        <div class="absolute top-4 z-[4] flex h-8 items-center justify-center text-text-base">
          <Show
            when={recordedEvidenceSrc()}
            fallback={
              <span
                class="inline-flex min-w-[64px] items-center justify-center gap-1.5 px-1.5 text-12-medium"
                role="status"
                aria-live="polite"
                data-tip={
                  videoReady()
                    ? "Live device preview"
                    : videoFailed()
                      ? "Using screenshot preview while video reconnects"
                      : "Connecting to the device"
                }
              >
                <i
                  class={cn(
                    "size-1.5 shrink-0 rounded-full",
                    videoReady()
                      ? "bg-[var(--icon-success-base)]"
                      : videoFailed()
                        ? "bg-[var(--icon-warning-base)]"
                        : "animate-pulse bg-icon-base motion-reduce:animate-none",
                  )}
                  aria-hidden="true"
                />
                <span>{videoReady() ? "Live" : videoFailed() ? "Preview" : "Connecting"}</span>
              </span>
            }
          >
            <div
              class="inline-flex h-8 items-center rounded-lg bg-[var(--v2-background-bg-layer-01)] p-0.5 shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)]"
              role="group"
              aria-label="Device view"
            >
              <button
                type="button"
                class={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] font-medium transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.97]",
                  stageView() === "recorded"
                    ? "bg-[var(--v2-background-bg-layer-03)] text-[var(--text-strong)] shadow-[0_1px_2px_rgb(0_0_0/24%),inset_0_0_0_1px_color-mix(in_srgb,var(--v2-border-border-strong)_72%,transparent)]"
                    : "text-[var(--text-weak)] hover:text-[var(--text-base)]",
                )}
                aria-pressed={stageView() === "recorded"}
                disabled={rec.recording()}
                onClick={() => setStageView("recorded")}
              >
                <Icon name="clock" size={12} /> Recorded
              </button>
              <button
                type="button"
                class={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] font-medium transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.97]",
                  stageView() === "live"
                    ? "bg-[var(--v2-background-bg-layer-03)] text-[var(--text-strong)] shadow-[0_1px_2px_rgb(0_0_0/24%),inset_0_0_0_1px_color-mix(in_srgb,var(--v2-border-border-strong)_72%,transparent)]"
                    : "text-[var(--text-weak)] hover:text-[var(--text-base)]",
                )}
                aria-pressed={stageView() === "live"}
                disabled={!targetReady()}
                data-tip={!targetReady() ? "Connect a device to use Live view" : undefined}
                onClick={() => setStageView("live")}
              >
                <i
                  class={cn(
                    "size-1.5 rounded-full",
                    stageView() !== "live"
                      ? "bg-[var(--text-weak)]"
                      : videoReady()
                        ? "bg-[var(--icon-success-base)]"
                        : videoFailed()
                          ? "bg-[var(--icon-warning-base)]"
                          : "animate-pulse bg-icon-base motion-reduce:animate-none",
                  )}
                  aria-hidden="true"
                />
                Live
              </button>
            </div>
          </Show>
        </div>
      </Show>
      <div
        data-device-chrome
        class={cn(
          phoneShell,
          "relative z-[2] h-[min(720px,calc(100%-148px))] w-auto max-w-[min(420px,calc(100%-56px))] shrink-0",
        )}
        style={{ "aspect-ratio": frameAspect() }}
      >
        <div class={cn(phoneScreen, "relative h-full w-full overflow-hidden rounded-[18px]")}>
          {/* The plan is the hero even before evidence exists: the selected
                step renders inside the screen, so the frame never reads as a
                dead end — only as "not captured yet". */}
          <Show
            when={displayImageSrc()}
            fallback={
              <div class="grid h-full w-full place-items-center px-6 text-center">
                <div class="grid justify-items-center gap-2.5">
                  <Show
                    when={plannedFocus()}
                    fallback={
                      <>
                        <span class={cn(deviceIconWell, "size-11 rounded-[13px]")}>
                          <Icon name="smartphone" size={20} />
                        </span>
                        <strong
                          class={cn(deviceTitle, "text-[14px] font-semibold tracking-[-0.01em]")}
                        >
                          Ready when you are
                        </strong>
                        <span class={cn(deviceCaption, "max-w-[24ch] text-[11.5px]/[1.5]")}>
                          Record on the device or describe a journey to create steps.
                        </span>
                      </>
                    }
                  >
                    {(s) => {
                      const accent = () => {
                        const step = focusedPlanStep();
                        return step ? accentForStep(step) : "var(--v2-background-bg-accent)";
                      };
                      return (
                        <>
                          <span
                            class="grid size-11 place-items-center rounded-[13px] border"
                            style={{
                              "border-color": `color-mix(in srgb, ${accent()} 34%, transparent)`,
                              background: `color-mix(in srgb, ${accent()} 13%, transparent)`,
                              color: `color-mix(in srgb, ${accent()} 80%, white)`,
                            }}
                          >
                            <Icon
                              name={focusedPlanStep() ? iconForStep(focusedPlanStep()!) : "pointer"}
                              size={20}
                            />
                          </span>
                          <span
                            class={cn(
                              mono,
                              deviceCaption,
                              "text-[10px] tracking-[0.09em] uppercase",
                            )}
                          >
                            Step {String(s().index + 1).padStart(2, "0")}
                          </span>
                          <strong
                            class={cn(
                              deviceTitle,
                              "max-w-[22ch] text-[14px]/[1.4] font-semibold tracking-[-0.01em]",
                            )}
                          >
                            {s().title}
                          </strong>
                          <span class={cn(deviceCaption, "max-w-[26ch] text-[11.5px]/[1.5]")}>
                            {targetReady()
                              ? "Run or record to capture this screen."
                              : server.isEmptyDevices()
                                ? "Connect a device to capture the real screen."
                                : "Start the device to capture the real screen."}
                          </span>
                        </>
                      );
                    }}
                  </Show>
                </div>
              </div>
            }
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
                    onSize={(width, height) => setFrameAspect(`${width} / ${height}`)}
                  />
                </div>
              )}
            </Show>
            <img
              class={cn(
                "block h-full w-full touch-none overscroll-contain select-none object-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-strong-focus",
                rec.recording() ? "cursor-crosshair" : liveControlActive() && "cursor-pointer",
                recordedCoordinateEditable() && "cursor-crosshair",
              )}
              ref={(element) => {
                deviceScreenEl = element;
              }}
              alt={displayCaption() || "Recorded device evidence"}
              aria-label="Interactive device screen"
              src={displayImageSrc()}
              draggable={false}
              tabindex={0}
              onClick={chooseRecordedNode}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && img.naturalHeight) {
                  setFrameAspect(`${img.naturalWidth} / ${img.naturalHeight}`);
                }
              }}
              onPointerDown={(e) => {
                if (recordedCoordinateEditable() && e.button === 0) {
                  const index = wb.focusedIndex();
                  const step = index == null ? undefined : draft.steps()[index];
                  if (index != null && step?.kind === "tap" && step.target.point) {
                    e.preventDefault();
                    e.currentTarget.focus({ preventScroll: true });
                    wb.rememberCoordinate(index, step.target.point);
                    recordedCoordinateDrag = { pointerId: e.pointerId };
                    e.currentTarget.setPointerCapture(e.pointerId);
                    moveRecordedCoordinate(e.currentTarget, e.clientX, e.clientY);
                  }
                  return;
                }
                if (!frame() || !liveControlActive() || e.button !== 0) return;
                e.currentTarget.focus({ preventScroll: true });
                const r = e.currentTarget.getBoundingClientRect();
                down = {
                  fx: (e.clientX - r.left) / r.width,
                  fy: (e.clientY - r.top) / r.height,
                  t: e.timeStamp,
                  pointerId: e.pointerId,
                };
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
                const r = e.currentTarget.getBoundingClientRect();
                pendingMove = {
                  fx: (e.clientX - r.left) / r.width,
                  fy: (e.clientY - r.top) / r.height,
                  pointerId: e.pointerId,
                };
                if (!moveRaf) {
                  moveRaf = requestAnimationFrame(() => {
                    moveRaf = 0;
                    const move = pendingMove;
                    pendingMove = null;
                    if (move && down?.pointerId === move.pointerId) {
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
                if (!frame() || !liveControlActive()) return;
                const start = down;
                if (!start || start.pointerId !== e.pointerId || e.button !== 0) return;
                const r = e.currentTarget.getBoundingClientRect();
                const fx = (e.clientX - r.left) / r.width;
                const fy = (e.clientY - r.top) / r.height;
                flushPendingMove(e.pointerId);
                down = null;
                const appliedLive = queueTouch("up", fx, fy);
                const dx = (fx - start.fx) * r.width;
                const dy = (fy - start.fy) * r.height;
                if (Math.hypot(dx, dy) < 6) {
                  // tap → direct action, no picker
                  // show brief physical feedback at tap location
                  setTapFeedback({ x: start.fx * 100, y: start.fy * 100 });
                  if (feedbackTimer) clearTimeout(feedbackTimer);
                  feedbackTimer = window.setTimeout(() => setTapFeedback(null), 280);

                  void appliedLive.then((live) =>
                    rec.driveTap(start.fx, start.fy, live).then(() => {
                      if (rec.interacting()) scheduleLiveSnapshot();
                    }),
                  );
                } else {
                  // drag → swipe, duration clamped to a sane gesture range
                  const durationMs = Math.round(Math.max(80, Math.min(e.timeStamp - start.t, 800)));
                  void appliedLive.then((live) =>
                    rec
                      .driveSwipe({ x: start.fx, y: start.fy }, { x: fx, y: fy }, durationMs, live)
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
              }}
              onLostPointerCapture={(e) => {
                if (recordedCoordinateDrag?.pointerId === e.pointerId) {
                  recordedCoordinateDrag = null;
                  return;
                }
                cancelGesture(e.pointerId);
              }}
              onWheel={(e) => {
                if (!frame() || !liveControlActive() || down) return;
                e.preventDefault();
                e.currentTarget.focus({ preventScroll: true });
                const r = e.currentTarget.getBoundingClientRect();
                const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
                const dx = e.deltaX * scale;
                const dy = e.deltaY * scale;
                const fx = (e.clientX - r.left) / r.width;
                const fy = (e.clientY - r.top) / r.height;
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
                if (!frame() || !liveControlActive()) return;
                e.preventDefault();
                openPickerAt(e.currentTarget, e.clientX, e.clientY);
              }}
              onMouseMove={(e) => {
                if (stageView() === "recorded") {
                  setRecordedScreenHovered(true);
                  updateRecordedNodeHover(e.currentTarget, e.clientX, e.clientY);
                } else if (frame()) scheduleHover(e.currentTarget, e.clientX, e.clientY);
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
                    class="pointer-events-none absolute z-[2] rounded-[2px] border border-[color-mix(in_srgb,var(--v2-background-bg-accent)_34%,transparent)]"
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
                  class="pointer-events-none absolute z-[3] rounded-[3px] border-[1.5px] border-[var(--v2-background-bg-accent)] bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_12%,transparent)] shadow-[0_0_0_1px_rgb(255_255_255/16%)]"
                  style={highlight()}
                  aria-hidden="true"
                />
              )}
            </Show>
            <Show when={focusedEvidenceHighlight()}>
              {(highlight) => (
                <div
                  class="pointer-events-none absolute z-[3] rounded-[3px] border-[1.5px] border-[var(--v2-background-bg-accent)] bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_18%,transparent)] shadow-[0_0_0_999px_rgb(4_7_14/30%)]"
                  style={highlight()}
                  aria-hidden="true"
                />
              )}
            </Show>
            <Show when={focusedCoordinateGuide()}>
              {(guide) => (
                <div
                  class="pointer-events-none absolute inset-0 z-[3] overflow-hidden"
                  aria-hidden="true"
                >
                  <i
                    class="absolute top-0 border-l border-dashed border-[color-mix(in_srgb,var(--v2-background-bg-accent)_82%,white)]"
                    data-coordinate-guide="vertical"
                    style={{
                      left: guide().left,
                      top: guide().verticalGuide.top,
                      height: guide().verticalGuide.height,
                    }}
                  />
                  <i
                    class="absolute left-0 border-t border-dashed border-[color-mix(in_srgb,var(--v2-background-bg-accent)_82%,white)]"
                    data-coordinate-guide="horizontal"
                    style={{
                      left: guide().horizontalGuide.left,
                      top: guide().top,
                      width: guide().horizontalGuide.width,
                    }}
                  />
                  <i
                    class="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_74%,white)] shadow-[0_0_0_1px_rgb(0_0_0/35%)]"
                    style={{ left: guide().horizontalOrigin, top: guide().top }}
                  />
                  <i
                    class="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_74%,white)] shadow-[0_0_0_1px_rgb(0_0_0/35%)]"
                    style={{ left: guide().left, top: guide().verticalOrigin }}
                  />
                  <i
                    class="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/90 bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_22%,transparent)] shadow-[0_2px_8px_rgb(0_0_0/52%)] after:absolute after:inset-[5px] after:rounded-full after:bg-[var(--v2-background-bg-accent)] after:shadow-[0_0_0_1.5px_white] after:content-['']"
                    style={{ left: guide().left, top: guide().top }}
                    data-coordinate-point
                  />
                  <code
                    class="absolute -translate-y-[calc(100%+8px)] rounded-md bg-[color-mix(in_srgb,var(--v2-background-bg-deep)_92%,black)] px-1.5 py-0.5 font-mono text-[8px] font-medium tabular-nums text-white shadow-[0_2px_8px_rgb(0_0_0/45%),inset_0_0_0_1px_rgb(255_255_255/14%)]"
                    style={{
                      left: `clamp(6px, calc(${guide().left} + 8px), calc(100% - 58px))`,
                      top: `clamp(20px, ${guide().top}, calc(100% - 4px))`,
                    }}
                  >
                    {guide().x}, {guide().y}
                  </code>
                </div>
              )}
            </Show>
            <Show when={server.showOverlays() && !picker() && hoverHighlight()}>
              {(h) => (
                <div class="pointer-events-none absolute inset-0 z-[4]" aria-hidden="true">
                  <div
                    class="absolute rounded-[3px] border-[1.5px] border-border-interactive-base bg-surface-brand-base/[0.12]"
                    style={h().rect}
                  />
                  <div
                    class={cn(
                      "absolute z-[5] max-w-[62%] overflow-hidden rounded-md bg-surface-brand-base px-1.5 py-0.5 font-mono text-12-regular leading-snug text-ellipsis whitespace-nowrap text-text-on-brand-base shadow-sm",
                      h().chip.below ? "translate-y-1" : "-translate-y-[calc(100%+4px)]",
                    )}
                    style={{
                      left: h().chip.left,
                      top: h().chip.below ? h().chip.bottom : h().chip.top,
                    }}
                  >
                    {h().chip.text}
                  </div>
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

            {/* tap confirmation ring */}
            <Show when={tapFeedback()}>
              {(fb) => (
                <div
                  class="pointer-events-none absolute z-[6] origin-center rounded-full border-[1.5px] border-border-interactive-base bg-surface-brand-base/20 animate-ping"
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
          </Show>
        </div>
      </div>

      <Show when={picker() && liveControlActive() && (pickerNode() || rec.recording())}>
        <div
          ref={(element) => {
            pickerEl = element;
          }}
          class={cn(
            "absolute z-50 w-[252px]",
            picker()!.placement === "above"
              ? "-translate-y-[calc(100%+10px)]"
              : "translate-y-[10px]",
          )}
          style={{ left: `${picker()!.vx}px`, top: `${picker()!.vy}px` }}
        >
          <div
            class={cn(
              popover,
              "!overflow-visible border border-[var(--v2-border-border-strong)] bg-surface-raised-stronger-non-alpha p-0 shadow-[var(--v2-elevation-overlay)]",
            )}
            style={{
              "--ui-pop-origin": picker()!.placement === "above" ? "bottom left" : "top left",
            }}
            role="dialog"
            aria-label="Choose target"
          >
            <header class="flex items-start justify-between gap-3 px-3 pt-3 pb-2.5">
              <span class="min-w-0">
                <small class="block text-[9px] font-semibold tracking-[0.11em] text-[var(--text-weak)] uppercase">
                  Target
                </small>
                <strong class="mt-0.5 block truncate text-[12.5px] font-semibold text-[var(--text-strong)]">
                  {nodeLabel()}
                </strong>
                <Show when={metaLine()}>
                  <span
                    class={cn(mono, "mt-0.5 block truncate text-[9.5px] text-[var(--text-weak)]")}
                  >
                    {metaLine()}
                  </span>
                </Show>
              </span>
              <button
                type="button"
                class="grid size-6 shrink-0 place-items-center rounded-md text-[var(--text-weak)] transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] active:scale-[0.96]"
                aria-label="Close target picker"
                onClick={() => setPicker(null)}
              >
                <Icon name="x" size={13} />
              </button>
            </header>

            <Show when={ancestry().length > 1}>
              <div class="mx-2.5 flex h-8 items-center justify-between rounded-lg bg-[var(--v2-background-bg-layer-01)] px-1">
                <button
                  type="button"
                  class="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-[var(--text-weak)] transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:enabled:bg-[var(--v2-background-bg-layer-02)] hover:enabled:text-[var(--text-strong)] active:enabled:scale-[0.97] disabled:opacity-30"
                  disabled={picker()!.index <= 0}
                  onClick={() => retarget(picker()!.index - 1)}
                >
                  <Icon name="chevron-down" size={12} /> Child
                </button>
                <span class={cn(mono, "text-[9px] tabular-nums text-[var(--text-weak)]")}>
                  {picker()!.index + 1} / {ancestry().length}
                </span>
                <button
                  type="button"
                  class="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-[var(--text-weak)] transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:enabled:bg-[var(--v2-background-bg-layer-02)] hover:enabled:text-[var(--text-strong)] active:enabled:scale-[0.97] disabled:opacity-30"
                  disabled={picker()!.index >= ancestry().length - 1}
                  onClick={() => retarget(picker()!.index + 1)}
                >
                  Parent <Icon name="chevron-up" size={12} />
                </button>
              </div>
            </Show>

            <div class="grid gap-1 px-2.5 py-2.5" role="group" aria-label="Target method">
              <For each={strategies().filter((strategy) => strategy.kind !== "point")}>
                {(strategy) => {
                  const selected = () => selectedStrategy()?.id === strategy.id;
                  return (
                    <button
                      type="button"
                      aria-pressed={selected()}
                      class={cn(
                        "grid min-h-10 w-full grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 text-left",
                        "transition-[background-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[var(--v2-background-bg-layer-02)] active:scale-[0.985]",
                        selected() &&
                          "bg-[var(--product-accent-soft)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--v2-background-bg-accent)_28%,transparent)]",
                      )}
                      onClick={() => {
                        setStrategyId(strategy.id);
                      }}
                    >
                      <span
                        class={cn(
                          "grid size-[26px] place-items-center rounded-md bg-[var(--v2-background-bg-layer-01)] text-[var(--text-weak)]",
                          selected() && "text-[var(--text-interactive-base)]",
                        )}
                      >
                        <Icon name={strategyIcon(strategy)} size={13} />
                      </span>
                      <span class="min-w-0">
                        <strong class="block truncate text-[10.5px] font-medium text-[var(--text-base)]">
                          {strategyLabel(strategy)}
                        </strong>
                        <code class="mt-0.5 block truncate font-mono text-[9px] text-[var(--text-weak)]">
                          {strategyValue(strategy)}
                        </code>
                      </span>
                      <span
                        class={cn(
                          "size-3.5 rounded-full border border-[var(--v2-border-border-strong)]",
                          selected() &&
                            "border-[4px] border-[var(--v2-background-bg-accent)] bg-white",
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  );
                }}
              </For>

              <Show
                when={pickerNode()?.rect && constrainedPoint()}
                fallback={
                  <button
                    type="button"
                    class={cn(
                      "grid min-h-11 w-full grid-cols-[26px_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 text-left",
                      "transition-[background-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[var(--v2-background-bg-layer-02)] active:scale-[0.985]",
                      strategyId() === "point" &&
                        "bg-[var(--product-accent-soft)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--v2-background-bg-accent)_28%,transparent)]",
                    )}
                    aria-pressed={strategyId() === "point"}
                    onClick={() => setStrategyId("point")}
                  >
                    <span class="grid size-[26px] place-items-center rounded-md bg-[var(--v2-background-bg-layer-01)] text-[var(--text-interactive-base)]">
                      <Icon name="scan" size={13} />
                    </span>
                    <span class="min-w-0">
                      <strong class="block text-[10.5px] font-medium text-[var(--text-base)]">
                        Coordinates
                      </strong>
                      <span class="mt-1 flex gap-1.5">
                        <code class="rounded bg-[var(--v2-background-bg-deep)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--text-weak)]">
                          X {strategies().find((strategy) => strategy.kind === "point")?.x ?? 0}
                        </code>
                        <code class="rounded bg-[var(--v2-background-bg-deep)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--text-weak)]">
                          Y {strategies().find((strategy) => strategy.kind === "point")?.y ?? 0}
                        </code>
                      </span>
                    </span>
                  </button>
                }
              >
                <CoordinateConstraintPicker
                  horizontal={horizontalConstraint()}
                  vertical={verticalConstraint()}
                  point={constrainedPoint()!}
                  active={strategyId() === "point"}
                  onHorizontal={(value) => {
                    setHorizontalConstraint(value);
                  }}
                  onVertical={(value) => {
                    setVerticalConstraint(value);
                  }}
                  onPoint={setManualPoint}
                  onActivate={() => setStrategyId("point")}
                />
              </Show>
            </div>

            <footer class="flex items-center justify-end gap-1.5 border-t border-[var(--v2-border-border-muted)] px-2.5 py-2.5">
              <button
                type="button"
                class="inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-[10.5px] font-semibold text-[var(--text-base)] transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] active:scale-[0.97] disabled:opacity-40"
                disabled={!selectedStrategy()}
                onClick={() => {
                  const strategy = selectedStrategy();
                  if (strategy) void pick(strategy, "select");
                }}
              >
                Add step
              </button>
              <button
                type="button"
                class="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-[var(--button-primary-base)] px-3 text-[10.5px] font-semibold text-[var(--text-on-brand-base)] transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:enabled:bg-[var(--icon-strong-hover,var(--button-primary-base))] active:enabled:scale-[0.97] disabled:opacity-40"
                disabled={!selectedStrategy()}
                onClick={() => {
                  const strategy = selectedStrategy();
                  if (strategy) void pick(strategy, "tap");
                }}
              >
                <Icon name="pointer" size={12} /> Tap device
              </button>
            </footer>
          </div>
        </div>
      </Show>

      {/* Device plumbing lives in a slim strip below the stage — never as a
            hero card blocking the content. */}
      <Show
        when={server.isEmptyDevices()}
        fallback={
          <Show when={!targetReady()}>
            <DeviceEvidenceEmptyState
              deviceName={currentDevice()?.name}
              refreshing={refreshingTarget()}
              starting={server.bootingSerial() === currentDevice()?.serial}
              onStartDevice={
                currentDevice() && currentDevice()?.platform !== "browser"
                  ? () => {
                      const serial = currentDevice()?.serial;
                      if (serial) void server.bootDevice(serial);
                    }
                  : undefined
              }
              onChooseDevice={() =>
                window.dispatchEvent(new CustomEvent("relay:open-device-picker"))
              }
              onRefresh={() => void refreshTarget()}
            />
          </Show>
        }
      >
        <DeviceConnectState
          offline={server.health() === "offline"}
          onRefresh={() => {
            void (async () => {
              await server.pollHealth();
              if (server.health() === "online") await server.refreshDevices();
            })();
          }}
          onSetup={() => void cmd.run("nav.settings")}
        />
      </Show>

      {/* Recording and capture actions only apply to the live device. */}
      <Show when={targetReady() && stageView() === "live"}>
        <div class="z-[2] mt-3 flex h-9 items-center justify-center gap-1.5 text-text-base">
          <label
            class={cn(
              "inline-flex h-8 cursor-pointer items-center justify-center gap-2.5 px-1.5 text-12-medium select-none",
              "transition-colors duration-150",
              rec.recording() ? "text-text-strong" : "text-text-base hover:text-text-strong",
            )}
            data-tip={rec.recording() ? "Stop recording steps" : "Record interactions as steps"}
          >
            <span class="w-[58px] text-right">{rec.recording() ? "Recording" : "Record"}</span>
            <Switch
              checked={rec.recording()}
              aria-label="Record interactions as steps"
              onCheckedChange={() => toggleRecording()}
            />
          </label>
          <div class="flex items-center gap-0.5">
            <IconButton
              variant="ghost"
              size="normal"
              class="rounded-md"
              data-tip="Screenshot (⌘⇧S)"
              aria-label="Capture screenshot"
              disabled={server.busyCapture()}
              onClick={() => void server.captureUiScreenshot()}
            >
              <Show when={server.busyCapture()} fallback={<Icon name="camera" size={14} />}>
                <span
                  class="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70"
                  aria-hidden="true"
                />
              </Show>
            </IconButton>
            <Show when={server.frames().length > 0}>
              <IconButton
                variant="ghost"
                size="normal"
                class="rounded-md hover:text-icon-critical-base"
                data-tip="Clear frames"
                aria-label="Clear frames"
                onClick={() => server.clearFrames()}
              >
                <Icon name="trash" size={14} />
              </IconButton>
            </Show>
          </div>
        </div>
      </Show>
    </section>
  );
}
