import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
// createMemo used for focused step label
import { useServer, type SnapshotNode } from "../context/server";
import {
  ancestryOf,
  candidateAtPoint,
  nodeAtPoint,
  overlayCandidates,
  shortLabel,
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
import { cn } from "../lib/cn";
import { accentForStep, evidenceForStep, iconForStep } from "./journey-step-presentation";
import { withRefreshFeedback } from "../lib/refresh-feedback";
import {
  LIVE_SNAPSHOT_INTERVAL_MS,
  POST_INTERACTION_SNAPSHOT_DELAY_MS,
  liveInspectionPolicy,
} from "../lib/live-inspection-policy";
import { DeviceVideoStream } from "./device-video-stream";
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
  const frame = () =>
    rec.interacting() ? (server.liveFrame() ?? server.currentFrame()) : server.currentFrame();
  const recordedEvidenceSrc = createMemo(() => {
    const index = wb.focusedIndex();
    const step = index == null ? undefined : draft.steps()[index];
    const shot = step ? evidenceForStep(step)?.screenshot : undefined;
    return shot ? server.recordingEvidenceUrl(shot.recipeId, shot.id) : "";
  });
  const displayImageSrc = createMemo(() => {
    if (rec.interacting()) {
      const live = server.liveFrame() ?? server.currentFrame();
      return live ? frameDataUrl(live) : "";
    }

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
    if (recorded) return recorded;
    if (wb.focusedIndex() != null) return "";
    const current = server.currentFrame();
    return current ? frameDataUrl(current) : "";
  });
  const displayCaption = createMemo(() => {
    if (rec.interacting()) return frame()?.caption ?? "Live device";
    const traceCaption = wb.focusedTraceStep()?.frames.at(-1)?.caption;
    if (traceCaption) return traceCaption;
    if (recordedEvidenceSrc()) return focusedStep()?.title ?? "Recorded device evidence";
    return wb.focusedIndex() == null ? (server.currentFrame()?.caption ?? "") : "";
  });
  const [frameAspect, setFrameAspect] = createSignal("9 / 19.5");
  const [videoReady, setVideoReady] = createSignal(false);
  const [videoFailed, setVideoFailed] = createSignal(false);
  const [videoAttempt, setVideoAttempt] = createSignal(0);
  // transient tap feedback (positioned in % of the glass)
  const [tapFeedback, setTapFeedback] = createSignal<{ x: number; y: number } | null>(null);
  let feedbackTimer: number | undefined;

  let stageEl: HTMLElement | undefined;
  let deviceScreenEl: HTMLImageElement | undefined;

  /** Element picker: devtools-style — choose how to address the hit element,
   *  walk up to its parent, and optionally record a step WITHOUT tapping. */
  type PickMode = "tap" | "select";
  const [picker, setPicker] = createSignal<{
    fx: number;
    fy: number;
    vx: number;
    vy: number;
    /** ancestry[0] = hit node, up to root (geometric fallback when no parentIndex). */
    ancestry: SnapshotNode[];
    /** current target index into `ancestry` (ArrowUp/Down + breadcrumb walk it). */
    index: number;
  } | null>(null);
  const [pickMode, setPickMode] = createSignal<PickMode>("tap");

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
    return (n?.label ?? n?.value ?? n?.identifier ?? "").trim() || "No element";
  };
  /** Header meta: role · @ref · W×H — helps judge whether to re-target. */
  const metaLine = () => {
    const n = pickerNode();
    if (!n) return "";
    const parts: string[] = [];
    if (n.role) parts.push(n.role);
    if (n.ref) parts.push(n.ref.startsWith("@") ? n.ref : `@${n.ref}`);
    if (n.rect) parts.push(`${Math.round(n.rect.width)}×${Math.round(n.rect.height)}`);
    return parts.join(" · ");
  };

  /** Re-target the picker to an ancestry index (breadcrumb click or arrows). */
  function retarget(i: number) {
    setPicker((p) => (p ? { ...p, index: Math.max(0, Math.min(i, p.ancestry.length - 1)) } : p));
  }

  /** Execute (Tap mode) or just record (Select-only mode) the chosen strategy. */
  async function pick(strategy: PickStrategy): Promise<void> {
    const p = picker();
    if (!p) return;
    // Preserve the recorded order when a picker tap follows buffered typing.
    await rec.flushType();
    setPicker(null);
    // feedback for deliberate picker taps too
    setTapFeedback({ x: p.fx * 100, y: p.fy * 100 });
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => setTapFeedback(null), 280);

    if (pickMode() === "select") {
      // Select-only: record the chosen-strategy step WITHOUT tapping.
      void rec.recordPick(strategy, p.fx, p.fy);
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
    if (ok && rec.recording()) void rec.recordPick(strategy, p.fx, p.fy);
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

  // ── Typing capture (plan 010 step 3.3): route printable keys + Backspace +
  //    Enter to the phone while Record is active. The modal/focus/modifier
  //    gate here keeps palette/dialog/input keys (⌘K included) from leaking to
  //    the device; the recorder owns the buffer + flush.
  const onDriveKey = (e: KeyboardEvent) => {
    if (!rec.interacting()) return;
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
    !rec.interacting() || !tabVisible() || server.health() !== "online" || picker() !== null;

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
    const policy = liveInspectionPolicy(rec.interacting(), videoFailed());
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
    else rec.enterRecordMode();
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
    setPicker({
      fx,
      fy,
      vx: s ? clientX - s.left : clientX - r.left,
      vy: s ? clientY - s.top : clientY - r.top,
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
    if (!identity || !rec.interacting()) return "";
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
                rec.recording() ? "cursor-crosshair" : rec.interacting() && "cursor-pointer",
              )}
              ref={(element) => {
                deviceScreenEl = element;
              }}
              alt={displayCaption() || "Recorded device evidence"}
              aria-label="Interactive device screen"
              src={displayImageSrc()}
              draggable={false}
              tabindex={0}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && img.naturalHeight) {
                  setFrameAspect(`${img.naturalWidth} / ${img.naturalHeight}`);
                }
              }}
              onPointerDown={(e) => {
                if (!frame() || !rec.interacting() || e.button !== 0) return;
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
                if (!frame() || !rec.interacting()) return;
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
              onPointerCancel={(e) => cancelGesture(e.pointerId)}
              onLostPointerCapture={(e) => cancelGesture(e.pointerId)}
              onWheel={(e) => {
                if (!frame() || !rec.interacting() || down) return;
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
                if (!frame() || !rec.interacting()) return;
                e.preventDefault();
                openPickerAt(e.currentTarget, e.clientX, e.clientY);
              }}
              onMouseMove={(e) => {
                if (frame()) scheduleHover(e.currentTarget, e.clientX, e.clientY);
              }}
              onMouseLeave={() => clearHover()}
            />
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

      <Show when={picker() && rec.interacting() && (pickerNode() || rec.recording())}>
        <div
          class={cn(
            popover,
            "absolute z-50 mt-[-8px] min-w-[196px] max-w-[260px] origin-bottom -translate-y-full",
            "bg-surface-raised-stronger-non-alpha p-1.5 shadow-xl ring-1 ring-border-weak-base",
          )}
          style={{ left: `${picker()!.vx}px`, top: `${picker()!.vy}px` }}
        >
          <div class="mb-1 flex max-w-[240px] flex-col gap-0.5 border-b border-border-weak-base px-2 pt-1 pb-1.5">
            <span class="truncate text-12-medium text-text-strong">{nodeLabel()}</span>
            <Show when={metaLine()}>
              <span class={cn(mono, "truncate text-12-regular text-text-weak")}>{metaLine()}</span>
            </Show>
          </div>
          <Show when={ancestry().length > 1}>
            <div
              class="flex flex-wrap items-center gap-0.5 px-0.5 pb-1"
              role="group"
              aria-label="Element ancestry"
            >
              <For each={ancestry().slice(0, 4)}>
                {(n, i) => (
                  <button
                    type="button"
                    class={cn(
                      "max-w-[120px] cursor-pointer truncate rounded-full border-0 bg-transparent px-1.5 py-0.5 text-12-regular text-text-weak transition-colors hover:bg-surface-base-hover hover:text-text-strong",
                      i() === picker()!.index &&
                        "bg-surface-base-active font-medium text-text-strong",
                    )}
                    data-tip={shortLabel(n) || n.role || "node"}
                    onClick={() => retarget(i())}
                  >
                    {shortLabel(n) || n.role || "node"}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <div
            class="mx-0.5 mb-1 flex gap-0.5 rounded-md bg-surface-base p-0.5 ring-1 ring-inset ring-border-weak-base"
            role="group"
            aria-label="Picker mode"
          >
            <button
              type="button"
              class={cn(
                "flex-1 cursor-pointer rounded-[5px] border-0 bg-transparent px-1.5 py-0.5 text-12-medium text-text-weak transition-colors hover:text-text-strong",
                pickMode() === "tap" &&
                  "bg-surface-raised-stronger-non-alpha text-text-strong shadow-sm ring-1 ring-border-weak-base/60",
              )}
              onClick={() => setPickMode("tap")}
            >
              Tap
            </button>
            <button
              type="button"
              class={cn(
                "flex-1 cursor-pointer rounded-[5px] border-0 bg-transparent px-1.5 py-0.5 text-12-medium text-text-weak transition-colors hover:text-text-strong",
                pickMode() === "select" &&
                  "bg-surface-raised-stronger-non-alpha text-text-strong shadow-sm ring-1 ring-border-weak-base/60",
              )}
              onClick={() => setPickMode("select")}
            >
              Select only
            </button>
          </div>
          <div class="flex flex-col gap-0.5">
            <For each={strategies()}>
              {(s) => (
                <button
                  type="button"
                  class="cursor-pointer rounded-md px-2 py-1.5 text-left font-mono text-12-regular text-text-strong transition-colors hover:bg-surface-raised-base-hover"
                  onClick={() => void pick(s)}
                >
                  {s.describe}
                </button>
              )}
            </For>
          </div>
          <Show when={ancestry().length > 1}>
            <div class={cn(mono, "px-2 pt-1.5 pb-0.5 text-center text-12-regular text-text-weak")}>
              ↑ parent · ↓ child · esc to close
            </div>
          </Show>
        </div>
      </Show>

      <Show when={displayCaption() && !rec.interacting()}>
        <div
          class={cn(
            mono,
            "z-[2] mt-2.5 max-w-[420px] truncate text-center text-12-regular text-text-weak",
          )}
        >
          {displayCaption()}
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

      {/* One quiet toolbar: transport is status, recording is optional. */}
      <Show when={targetReady()}>
        <div class="z-[2] mt-3 flex h-9 items-center justify-center gap-1 text-text-base">
          <span
            class="inline-flex min-w-[64px] items-center justify-center gap-1.5 px-1.5 text-12-medium"
            role="status"
            aria-live="polite"
            data-tip={
              videoReady()
                ? "Live device preview. Screenshots and UI details are captured when needed."
                : videoFailed()
                  ? "Using screenshot preview while live video reconnects."
                  : "Connecting to the live device preview."
            }
            aria-label={
              videoReady()
                ? "Device preview live"
                : videoFailed()
                  ? "Device preview reconnecting"
                  : "Device preview connecting"
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
          <span class="mx-0.5 h-4 w-px bg-border-weak-base" aria-hidden="true" />
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
