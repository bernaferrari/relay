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
import { IconButton } from "@relay/ui/icon-button";
import { useCommand } from "../context/command";
import { displayTitle } from "../lib/job";
import { sentenceForStep } from "../lib/step-sentence";
import { cn } from "../lib/cn";
import { evidenceForStep } from "./journey-workspace";
import {
  deviceBody,
  deviceIconWell,
  deviceTitle,
  btnGhost,
  mono,
  phoneBezel,
  phoneScreen,
  popover,
  seg,
  segBtn,
  segBtnOn,
  segBtnRec,
} from "../lib/ui";

/** Device-as-hero stage: phone bezel, frame filmstrip, snapshot rect overlays. */
export function DeviceStage(props: { onExpandBoard?: () => void }) {
  const server = useServer();
  const rec = useRecorder();
  const cmd = useCommand();
  const wb = useWorkbench();
  const draft = useRecipeDraft();

  /** What the artboard is “about” when a step is selected (Uber-style selection). */
  const focusedStep = createMemo(() => {
    const i = wb.focusedIndex();
    if (i == null || i < 0) return null;
    const step = draft.steps()[i];
    if (step) return { index: i, title: sentenceForStep(step, server.recipes()) };
    return { index: i, title: `Step ${i + 1}` };
  });
  const frame = () =>
    rec.interacting() ? (server.liveFrame() ?? server.currentFrame()) : server.currentFrame();
  const recordedEvidenceSrc = createMemo(() => {
    const index = wb.focusedIndex();
    const step = index == null ? undefined : draft.steps()[index];
    const shot = step ? evidenceForStep(step)?.screenshot : undefined;
    return shot ? server.recordingEvidenceUrl(shot.recipeId, shot.id) : "";
  });
  const displayImageSrc = createMemo(() => {
    const current = frame();
    return current ? `data:${current.mime};base64,${current.base64}` : recordedEvidenceSrc();
  });
  const [frameAspect, setFrameAspect] = createSignal("9 / 19.5");
  // transient tap feedback (positioned in % of the glass)
  const [tapFeedback, setTapFeedback] = createSignal<{ x: number; y: number } | null>(null);
  let feedbackTimer: number | undefined;

  let stageEl: HTMLElement | undefined;

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
    // Live mode: refresh the stage image + tree now, don't wait for the next tick.
    if (ok && rec.interacting()) {
      void tickLiveFrame();
      void tickLiveSnapshot();
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
  //    Enter to the phone while Drive/Record is active. The modal/focus/modifier
  //    gate here keeps palette/dialog/input keys (⌘K included) from leaking to
  //    the device; the recorder owns the buffer + flush.
  const onDriveKey = (e: KeyboardEvent) => {
    if (!rec.interacting()) return;
    if (cmd.modalOpen()) return;
    // Modifier chords belong to the app / command palette, never the phone.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Don't steal keystrokes meant for an app input, textarea, or editor.
    const ae = typeof document !== "undefined" ? document.activeElement : null;
    if (
      ae &&
      (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || (ae as HTMLElement).isContentEditable)
    )
      return;
    if (rec.feedTypeKey(e)) e.preventDefault();
  };
  window.addEventListener("keydown", onDriveKey);
  onCleanup(() => window.removeEventListener("keydown", onDriveKey));

  // ── Live mode: auto-refresh the stage image + snapshot while Live is on.
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

  let frameInFlight = false;
  let snapInFlight = false;
  let frameTimer: NodeJS.Timeout | undefined;
  let snapTimer: NodeJS.Timeout | undefined;

  const livePaused = () =>
    !rec.interacting() || !tabVisible() || server.health() !== "online" || picker() !== null;

  async function tickLiveFrame(): Promise<void> {
    if (livePaused() || frameInFlight) return;
    frameInFlight = true;
    try {
      await server.pollLiveFrame();
    } finally {
      frameInFlight = false;
    }
  }
  async function tickLiveSnapshot(): Promise<void> {
    if (livePaused() || snapInFlight) return;
    snapInFlight = true;
    try {
      await server.pollLiveSnapshot();
    } finally {
      snapInFlight = false;
    }
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
  }

  createEffect(() => {
    if (!rec.interacting()) return;
    // immediate first paint, then steady-state polls
    void tickLiveFrame();
    void tickLiveSnapshot();
    frameTimer = setInterval(() => void tickLiveFrame(), 1000);
    snapTimer = setInterval(() => void tickLiveSnapshot(), 2000);
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

  const [hoverNode, setHoverNode] = createSignal<SnapshotNode | null>(null);
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
        setHoverNode(null);
        return;
      }
      const snap = server.snapshot();
      setHoverNode(snap?.bounds ? candidateAtPoint(candidates(), snap.bounds, fx, fy) : null);
    });
  }
  function clearHover(): void {
    if (hoverRaf) {
      cancelAnimationFrame(hoverRaf);
      hoverRaf = 0;
    }
    setHoverNode(null);
  }
  onCleanup(() => {
    if (hoverRaf) cancelAnimationFrame(hoverRaf);
    if (feedbackTimer) clearTimeout(feedbackTimer);
  });
  /** Segmented stage mode (plan 009 step 6): View = watch only;
   *  Drive = live poll + click-to-tap + hover-inspect; Record = Drive +
   *  capture. Hover-inspect is on by default in Drive/Record; ⌘O remains
   *  the power-user escape hatch (showOverlays signal kept). */
  function setStageMode(mode: "view" | "drive" | "record"): void {
    setPicker(null);
    if (mode === "record") {
      rec.enterRecordMode();
      return;
    }
    const interacting = mode !== "view";
    rec.setInteracting(interacting);
    if (rec.recording()) void rec.stopRecording();
    else rec.setRecording(false);
    if (interacting) {
      server.setShowOverlays(true);
      if (!server.snapshot()?.bounds) void server.captureUiSnapshot();
    }
  }

  // ── Drive gestures (plan 010 step 2): pointer events replace bare click.
  //    Left-button down→up under 6 px = tap (driveTap); over = swipe (driveSwipe).
  //    Right-click opens the picker for deliberate strategy selection.
  let down: { fx: number; fy: number; t: number } | null = null;

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

  /** The device on stage — the selected one, else the first connected. */
  const currentDevice = () =>
    server.devices().find((d) => d.serial === server.selectedDevice()) ??
    server.devices()[0] ??
    null;
  const targetReady = () => {
    const device = currentDevice();
    return server.health() === "online" && Boolean(device) && device?.booted !== false;
  };

  /**
   * Abstract device viewport — thin always-dark frame, no hardware gimmicks.
   * Never stack workbench light-theme color recipes on the frame.
   */
  const phoneShell = cn(phoneBezel, "relative rounded-[24px] p-[6px]");

  return (
    <section
      ref={(el) => {
        stageEl = el;
      }}
      aria-label="Device stage"
      class="relative flex h-full min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-6 py-5"
    >
      <Show
        when={!server.isEmptyDevices()}
        fallback={
          <DeviceConnectState
            offline={server.health() === "offline"}
            focusedStep={focusedStep}
            phoneShell={phoneShell}
            phoneScreen={phoneScreen}
            onRefresh={() => {
              void (async () => {
                await server.pollHealth();
                if (server.health() === "online") await server.refreshDevices();
              })();
            }}
            onSetup={() => void cmd.run("nav.settings")}
          />
        }
      >
        {/* Transient mode only; target identity already lives in the app toolbar. */}
        <Show when={rec.interacting()}>
          <div class="z-[2] mb-3 flex flex-none items-center gap-2">
            <Show when={rec.recording()}>
              <span class="inline-flex h-5 items-center gap-1 rounded-md bg-surface-critical-weak px-1.5 text-12-medium text-icon-critical-base ring-1 ring-inset ring-border-critical-base/30">
                <span
                  class="size-1 animate-pulse rounded-full bg-icon-critical-base"
                  aria-hidden="true"
                />
                Recording
              </span>
            </Show>
            <Show when={rec.interacting() && !rec.recording()}>
              <span class="inline-flex h-5 items-center gap-1 rounded-md bg-surface-success-weak px-1.5 text-12-medium text-icon-success-base ring-1 ring-inset ring-border-success-base/30">
                <span class="size-1 rounded-full bg-icon-success-base" aria-hidden="true" />
                Live
              </span>
            </Show>
          </div>
        </Show>

        <div
          data-device-chrome
          class={cn(
            phoneShell,
            "relative z-[2] h-[min(720px,calc(100%-64px))] w-auto max-w-[min(420px,calc(100%-56px))] shrink-0",
          )}
          data-empty={!displayImageSrc() ? "1" : "0"}
          style={{ "aspect-ratio": frameAspect() }}
        >
          <div class={cn(phoneScreen, "relative h-full w-full overflow-hidden rounded-[18px]")}>
            <Show when={displayImageSrc()}>
              <img
                class={cn(
                  "block h-full w-full select-none object-contain",
                  rec.interacting() && "cursor-crosshair",
                )}
                alt={frame()?.caption ?? "recorded device evidence"}
                src={displayImageSrc()}
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth && img.naturalHeight) {
                    setFrameAspect(`${img.naturalWidth} / ${img.naturalHeight}`);
                  }
                }}
                onPointerDown={(e) => {
                  // View mode is inert; only the primary button starts a gesture.
                  if (!frame() || !rec.interacting() || e.button !== 0) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  down = {
                    fx: (e.clientX - r.left) / r.width,
                    fy: (e.clientY - r.top) / r.height,
                    t: e.timeStamp,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerUp={(e) => {
                  if (!frame() || !rec.interacting()) return;
                  const start = down;
                  down = null;
                  if (!start || e.button !== 0) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  const fx = (e.clientX - r.left) / r.width;
                  const fy = (e.clientY - r.top) / r.height;
                  const dx = (fx - start.fx) * r.width;
                  const dy = (fy - start.fy) * r.height;
                  if (Math.hypot(dx, dy) < 6) {
                    // tap → direct action, no picker
                    // show brief physical feedback at tap location
                    setTapFeedback({ x: start.fx * 100, y: start.fy * 100 });
                    if (feedbackTimer) clearTimeout(feedbackTimer);
                    feedbackTimer = window.setTimeout(() => setTapFeedback(null), 280);

                    void rec.driveTap(start.fx, start.fy).then(() => {
                      if (rec.interacting()) {
                        void tickLiveFrame();
                        void tickLiveSnapshot();
                      }
                    });
                  } else {
                    // drag → swipe, duration clamped to a sane gesture range
                    const durationMs = Math.max(80, Math.min(e.timeStamp - start.t, 800));
                    void rec
                      .driveSwipe({ x: start.fx, y: start.fy }, { x: fx, y: fy }, durationMs)
                      .then(() => {
                        if (rec.interacting()) {
                          void tickLiveFrame();
                          void tickLiveSnapshot();
                        }
                      });
                  }
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
                      class="absolute rounded-[3px] border-[1.5px] border-border-interactive-base bg-surface-brand-base/[0.12] shadow-[0_0_0_1px_color-mix(in_srgb,var(--surface-brand-base)_35%,transparent)]"
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
                    class="pointer-events-none absolute z-[5] rounded-[3px] border-[1.6px] border-border-interactive-base bg-surface-brand-base/[0.18] shadow-[0_0_0_1px_color-mix(in_srgb,var(--surface-brand-base)_45%,transparent)]"
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
            {/* No frame yet: step-focused glass (Uber energy) */}
            <Show when={!displayImageSrc() && focusedStep()}>
              {(s) => (
                <div class="absolute inset-0 z-[1] overflow-hidden [background:linear-gradient(160deg,#111520,#090b10_72%)]">
                  <div class="absolute inset-x-5 top-7 grid gap-3 opacity-70" aria-hidden="true">
                    <span class="h-2 w-[38%] rounded-full bg-white/10" />
                    <span class="h-2 w-[70%] rounded-full bg-white/[0.06]" />
                    <span class="h-20 rounded-[14px] border border-white/[0.06] bg-white/[0.035]" />
                    <span class="h-10 rounded-[11px] bg-[linear-gradient(135deg,rgb(126_101_255/24%),rgb(100_84_233/14%))]" />
                    <span class="h-10 rounded-[11px] bg-white/[0.035]" />
                  </div>
                  <div class="absolute right-3 bottom-3 left-3 flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-[#121620] px-3 py-2.5 text-left shadow-[0_10px_30px_rgb(0_0_0/30%)]">
                    <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-white/65">
                      <Icon name="camera" size={14} />
                    </span>
                    <span class="min-w-0 flex-1">
                      <strong class="block text-[10.5px] font-medium text-white/80">
                        Waiting for device capture
                      </strong>
                      <small class="mt-0.5 block truncate text-[9px] text-white/40">
                        Step {s().index + 1} · {s().title}
                      </small>
                    </span>
                  </div>
                </div>
              )}
            </Show>
            <Show when={!displayImageSrc() && !focusedStep()}>
              <div class="absolute inset-0 z-[1] flex flex-col items-center justify-center p-7 text-center">
                <div
                  class="relative mb-4 grid h-24 w-16 place-items-center overflow-hidden rounded-[14px] border border-[var(--relay-line)] bg-[var(--relay-surface-raised)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--relay-line)_50%,transparent)]"
                  aria-hidden="true"
                >
                  <span class="absolute top-2 h-0.5 w-6 rounded-full bg-[var(--relay-line-strong)]" />
                  <span class="mt-3 h-2 w-[70%] rounded bg-[color-mix(in_srgb,var(--relay-text)_12%,transparent)]" />
                  <span class="mt-1.5 h-2 w-[50%] rounded bg-[color-mix(in_srgb,var(--relay-text)_8%,transparent)]" />
                </div>
                <Show
                  when={targetReady()}
                  fallback={
                    <>
                      <p class={cn("m-0 text-14-medium tracking-tight", deviceTitle)}>
                        Connect this target
                      </p>
                      <p class={cn("m-0 max-w-[15em] text-12-regular leading-relaxed", deviceBody)}>
                        Start the target before recording or running a step.
                      </p>
                    </>
                  }
                >
                  <p class={cn("m-0 text-14-medium tracking-tight", deviceTitle)}>
                    Ready to capture
                  </p>
                  <p class={cn("m-0 max-w-[13em] text-12-regular leading-relaxed", deviceBody)}>
                    Select a step, then run it.
                  </p>
                </Show>
              </div>
            </Show>
            {/* Selected step chip over live frame */}
            <Show when={displayImageSrc() ? focusedStep() : null}>
              {(s) => (
                <div
                  class={cn(
                    "pointer-events-none absolute right-2.5 bottom-2.5 left-2.5 z-[4]",
                    "flex items-center gap-2 rounded-[12px] px-2.5 py-2 backdrop-blur-md",
                    "bg-[color-mix(in_srgb,var(--phone-bezel)_88%,transparent)]",
                    "text-12-medium leading-snug",
                    deviceTitle,
                    "shadow-[0_10px_28px_color-mix(in_srgb,var(--phone-screen)_70%,transparent)]",
                    "ring-1 ring-[color-mix(in_srgb,var(--phone-fg)_14%,transparent)]",
                  )}
                >
                  <span
                    class={cn(mono, deviceIconWell, "size-5 shrink-0 rounded-md text-12-medium")}
                  >
                    {s().index + 1}
                  </span>
                  <span class={cn(deviceTitle, "min-w-0 truncate")}>{s().title}</span>
                </div>
              )}
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
                <span class={cn(mono, "truncate text-12-regular text-text-weak")}>
                  {metaLine()}
                </span>
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
              <div
                class={cn(mono, "px-2 pt-1.5 pb-0.5 text-center text-12-regular text-text-weak")}
              >
                ↑ parent · ↓ child · esc to close
              </div>
            </Show>
          </div>
        </Show>

        <Show when={frame()?.caption}>
          <div
            class={cn(
              mono,
              "z-[2] mt-2.5 max-w-[280px] truncate text-center text-12-regular text-text-weak",
            )}
          >
            {frame()!.caption}
          </div>
        </Show>
      </Show>

      {/* Dense evidence filmstrip under the phone */}
      <Show when={server.frames().length > 0}>
        <div class="z-[2] mt-3.5 w-full max-w-[min(340px,92%)]">
          <div class="flex flex-col gap-2 rounded-2xl bg-surface-raised-stronger-non-alpha px-2 py-2 text-text-strong shadow-sm ring-1 ring-inset ring-border-weak-base">
            {/* Thumbnail filmstrip — denser row, selected is unmistakable */}
            <div
              class="flex gap-1 overflow-x-auto px-0.5 py-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="listbox"
              aria-label="Frame filmstrip"
            >
              <For each={server.frames()}>
                {(f, i) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={i() === server.frameIndex()}
                    aria-label={`frame ${i() + 1}: ${f.caption ?? "capture"}`}
                    data-tip={f.caption || `Frame ${i() + 1}`}
                    class={cn(
                      "relative h-[46px] w-[26px] shrink-0 overflow-hidden rounded-[5px]",
                      "bg-surface-weak ring-1 ring-border-weak-base transition-[box-shadow,ring-color,transform] duration-150",
                      "hover:ring-border-strong-base",
                      i() === server.frameIndex()
                        ? "scale-[1.04] ring-2 ring-border-interactive-base shadow-[0_0_0_1px_color-mix(in_srgb,var(--surface-brand-base)_40%,transparent)]"
                        : "opacity-80 hover:opacity-100",
                    )}
                    onClick={() => wb.focusFrame(i())}
                  >
                    <img
                      class="h-full w-full object-cover object-top"
                      alt=""
                      draggable={false}
                      src={`data:${f.mime};base64,${f.base64}`}
                    />
                    <Show when={i() === server.frameIndex()}>
                      <span
                        class="absolute inset-x-0 bottom-0 h-0.5 bg-surface-brand-base"
                        aria-hidden="true"
                      />
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <div class="flex items-center gap-2 px-0.5">
              <button
                type="button"
                class={cn(
                  "grid size-6 shrink-0 place-items-center rounded-md bg-button-primary-base text-icon-invert-base",
                  "transition-transform ",
                )}
                data-tip={server.playing() ? "Pause" : "Replay"}
                aria-label={server.playing() ? "Pause playback" : "Replay frames"}
                onClick={() => server.togglePlayback()}
              >
                <Icon name={server.playing() ? "pause" : "play"} size={13} />
              </button>
              <div
                class="relative flex h-1.5 flex-1 items-center gap-px overflow-hidden rounded-full bg-surface-weak"
                role="group"
                aria-label="Capture timeline"
              >
                <For each={server.frames()}>
                  {(f, i) => (
                    <button
                      type="button"
                      class={cn(
                        "h-full min-w-[2px] flex-1 border-0 transition-colors",
                        i() < server.frameIndex() && "bg-surface-brand-base/50",
                        i() === server.frameIndex() && "bg-surface-brand-base",
                        i() > server.frameIndex() && "bg-transparent hover:bg-text-weaker/35",
                      )}
                      data-tip={f.caption || `Frame ${i() + 1}`}
                      aria-label={`frame ${i() + 1}: ${f.caption}`}
                      aria-current={i() === server.frameIndex() ? "true" : undefined}
                      onClick={() => wb.focusFrame(i())}
                    />
                  )}
                </For>
              </div>
              <span class={cn(mono, "shrink-0 text-12-regular tabular-nums text-text-weak")}>
                {server.frameIndex() + 1}
                <span class="text-text-weaker/45">/</span>
                {server.frames().length}
              </span>
              <Show when={props.onExpandBoard}>
                <button
                  type="button"
                  class={cn(btnGhost, "h-7 gap-1 px-2")}
                  data-tip="Map of captures"
                  aria-label="Expand frame board"
                  onClick={() => props.onExpandBoard?.()}
                >
                  <Icon name="grid" size={12} />
                  Map
                </button>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      {/* Mode toolbar — only when a device can act; never greyed theatre */}
      <Show
        when={
          server.health() === "online" &&
          !server.isEmptyDevices() &&
          currentDevice()?.booted !== false
        }
      >
        <div class="z-[2] mt-3.5 flex items-center justify-center gap-1.5">
          <div class={seg} role="group" aria-label="Stage mode">
            <button
              type="button"
              class={cn(segBtn, !rec.interacting() && segBtnOn)}
              aria-pressed={!rec.interacting()}
              data-tip="Watch only"
              onClick={() => setStageMode("view")}
            >
              View
            </button>
            <button
              type="button"
              class={cn(segBtn, rec.interacting() && !rec.recording() && segBtnOn)}
              aria-pressed={rec.interacting() && !rec.recording()}
              data-tip="Live drive"
              onClick={() => setStageMode("drive")}
            >
              Drive
            </button>
            <button
              type="button"
              class={cn(
                segBtn,
                rec.interacting() && rec.recording() && segBtnOn,
                rec.interacting() && rec.recording() && segBtnRec,
              )}
              aria-pressed={rec.interacting() && rec.recording()}
              data-tip="Record steps"
              onClick={() => setStageMode("record")}
            >
              <span
                class={cn(
                  "mr-1 inline-block size-1.5 rounded-full",
                  rec.interacting() && rec.recording()
                    ? "animate-pulse bg-icon-critical-base"
                    : "bg-current",
                )}
                aria-hidden="true"
              />
              Record
            </button>
          </div>
          <div class="flex items-center gap-0.5 pl-0.5">
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
      <RecorderBar />
    </section>
  );
}

/**
 * Recording is now just appending to the selected recipe's steps (M3) — the
 * run pane owns the list, its title, and its autosave. This bar shrinks to a
 * thin status strip: it says WHERE steps are landing and echoes the live
 * type buffer, nothing else. Drive (not recording) keeps its quiet one-line
 * hint.
 */
function RecorderBar() {
  const rec = useRecorder();
  const server = useServer();
  const recordingTitle = () => {
    const r = server.selectedRecipe();
    return r ? displayTitle(r.title) : "a new test";
  };
  return (
    <Show when={rec.interacting()}>
      <div
        class={cn(
          "z-[3] mt-3 flex w-[min(360px,100%)] flex-col rounded-lg border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 py-1.5 text-text-strong",
          rec.recording() ? "shadow-sm ring-1 ring-icon-critical-base/15" : "",
        )}
      >
        <div class="flex min-h-[24px] items-center gap-2 px-0.5">
          <span
            class={cn(
              "size-1.5 flex-none rounded-full",
              rec.recording()
                ? "animate-pulse bg-icon-critical-base shadow-[0_0_0_3px_color-mix(in_srgb,var(--icon-critical-base)_22%,transparent)]"
                : "bg-icon-success-base",
            )}
            aria-hidden="true"
          />
          <span
            class={cn(
              "flex-1 truncate text-12-regular",
              rec.recording() ? "font-medium text-text-strong" : "text-text-weak",
            )}
          >
            <Show
              when={rec.recording()}
              fallback="Drive · input goes to device · right-click inspect"
            >
              Recording → {recordingTitle()}
            </Show>
          </span>
          <Show when={rec.typeBuffer()}>
            <span
              class={cn(mono, "max-w-[45%] flex-none truncate text-12-regular text-text-strong")}
              data-tip="Typing to device…"
            >
              “{rec.typeBuffer()}
              <span class="animate-pulse text-text-strong" aria-hidden="true">
                ▍
              </span>
              ”
            </span>
          </Show>
          <Show when={rec.recording()}>
            <button
              type="button"
              class={cn(
                "inline-flex h-[22px] flex-none items-center justify-center gap-1 rounded-md px-2",
                "text-12-medium text-icon-critical-base select-none",
                "transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
                "hover:enabled:bg-surface-critical-weak",
              )}
              data-tip="Stop recording"
              onClick={() => void rec.stopRecording()}
            >
              <Icon name="square" size={12} />
              Stop
            </button>
          </Show>
        </div>
      </div>
    </Show>
  );
}
