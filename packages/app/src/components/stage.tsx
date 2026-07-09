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
import { useCommand } from "../context/command";
import { displayTitle } from "../lib/job";
import { sentenceForStep } from "../lib/step-sentence";
import { cn } from "../lib/cn";
import { btnBordered, btnGhost, mono, seg, segBtn, segBtnOn, segBtnRec } from "../lib/ui";

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
    // Resolve plan from builtin id OR from a forked thin flow wrapper.
    let planId = server.selectedRecipeId();
    const steps = draft.steps();
    if (draft.source() === "custom" && steps.length === 1 && steps[0]?.kind === "flow") {
      planId = steps[0].flow;
    }
    const planned = planId
      ? server.actions().find((a) => a.id === planId)?.planned?.[i]
      : undefined;
    if (planned?.title) return { index: i, title: planned.title };
    const step = draft.steps()[i];
    if (step) return { index: i, title: sentenceForStep(step, server.recipes()) };
    return { index: i, title: `Step ${i + 1}` };
  });
  const frame = () =>
    rec.interacting() ? (server.liveFrame() ?? server.currentFrame()) : server.currentFrame();
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
    rec.setRecording(false);
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

  function deviceChipText(d: { name?: string; serial: string; kind?: string | null }): string {
    return [d.name?.trim() || "Device", d.serial, d.kind ?? ""].filter(Boolean).join(" · ");
  }

  return (
    <section
      ref={stageEl}
      aria-label="Device stage"
      class={cn(
        "relative flex h-full min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-6 py-7",
        "bg-[radial-gradient(ellipse_80%_60%_at_50%_42%,color-mix(in_srgb,var(--color-accent)_8%,transparent),transparent_55%),radial-gradient(ellipse_100%_80%_at_50%_100%,rgb(0_0_0/0.2),transparent_50%),var(--color-deep)]",
        "dark:bg-[radial-gradient(ellipse_80%_60%_at_50%_42%,color-mix(in_srgb,var(--color-accent)_8%,transparent),transparent_55%),var(--color-deep)]",
        server.isOffline() && "opacity-55",
      )}
    >
      <Show when={server.isOffline()}>
        <div
          class="pointer-events-none absolute top-1/2 left-1/2 z-0 -translate-x-1/2 -translate-y-1/2 -rotate-12 font-mono text-[5.5rem] font-bold tracking-wider text-fail/15 select-none"
          aria-hidden="true"
        >
          Offline
        </div>
      </Show>

      <Show
        when={!server.isEmptyDevices()}
        fallback={
          <div
            class={cn(
              "relative z-[2] my-auto flex aspect-[9/19.5] w-[min(320px,46vh)] max-h-[calc(100%-96px)]",
              "flex-col items-center justify-center gap-3 rounded-[38px] p-3 text-center text-white/90",
              "bg-[linear-gradient(155deg,#2a2d33_0%,#12141a_45%,#0a0b0e_100%)]",
              "shadow-[0_32px_64px_-18px_rgb(0_0_0/0.7),0_0_0_1px_rgb(255_255_255/0.07),inset_0_1px_0_rgb(255_255_255/0.12)]",
              "before:pointer-events-none before:absolute before:top-2.5 before:left-1/2 before:h-1.5 before:w-[72px]",
              "before:-translate-x-1/2 before:rounded-full before:bg-black before:opacity-85 before:content-['']",
              focusedStep() && "gap-3.5",
            )}
          >
            <Show
              when={focusedStep()}
              fallback={
                <>
                  <Icon name="smartphone" size={24} strokeWidth={1.3} />
                  <p class="m-0 text-[13px] font-semibold tracking-tight text-white/90">
                    No device
                  </p>
                  <p class="m-0 max-w-[180px] text-[11.5px] leading-snug text-white/45">
                    USB or Wi‑Fi · then refresh
                  </p>
                </>
              }
            >
              {(s) => (
                <div class="flex max-w-[220px] flex-col items-center gap-1.5 px-5 text-center">
                  <span
                    class={cn(
                      mono,
                      "text-[10px] font-bold tracking-[0.1em] text-accent-soft uppercase opacity-90",
                    )}
                  >
                    Step {s().index + 1}
                  </span>
                  <p class="m-0 text-sm font-semibold leading-snug tracking-tight text-white/[0.94]">
                    {s().title}
                  </p>
                  <p class="m-0 text-[11.5px] leading-snug text-white/45">
                    Connect a phone to run this step
                  </p>
                </div>
              )}
            </Show>
            <div class="flex flex-col items-center gap-2.5">
              <button
                type="button"
                class={cn(
                  btnBordered,
                  "border-white/15 bg-white/5 text-white/80 hover:enabled:bg-white/12 hover:enabled:text-white",
                )}
                disabled={server.health() === "offline"}
                onClick={() =>
                  void (async () => {
                    await server.pollHealth();
                    if (server.health() === "online") await server.refreshDevices();
                  })()
                }
              >
                <Icon name="refresh" size={14} />
                Refresh devices
              </button>
            </div>
          </div>
        }
      >
        {/* device identity chip — floats above the bezel */}
        <Show when={currentDevice()}>
          {(d) => (
            <div
              class="z-[2] mb-3 inline-flex h-6 flex-none items-center gap-1.5 rounded-full bg-layer-2 px-2.5 text-meta text-text-muted tabular-nums"
              title={d().serial}
            >
              <span class="size-1.5 flex-none rounded-full bg-pass" aria-hidden="true" />
              {deviceChipText(d())}
            </div>
          )}
        </Show>
        <div
          class={cn(
            "relative z-[2] aspect-[9/19.5] w-[min(320px,46vh)] max-h-[calc(100%-96px)] shrink-0 rounded-[38px] p-3",
            "bg-[linear-gradient(155deg,#2a2d33_0%,#12141a_45%,#0a0b0e_100%)]",
            "shadow-[0_32px_64px_-18px_rgb(0_0_0/0.7),0_0_0_1px_rgb(255_255_255/0.07),inset_0_1px_0_rgb(255_255_255/0.12)]",
            "before:pointer-events-none before:absolute before:top-2.5 before:left-1/2 before:h-1.5 before:w-[72px]",
            "before:-translate-x-1/2 before:rounded-full before:bg-black before:opacity-85 before:content-['']",
          )}
          data-empty={!frame() ? "1" : "0"}
          style={{ "aspect-ratio": frameAspect() }}
        >
          <div class="relative h-full w-full overflow-hidden rounded-[26px] bg-[#0a0a0c]">
            <Show when={frame()}>
              <img
                class={cn(
                  "block h-full w-full select-none object-contain",
                  rec.interacting() && "cursor-crosshair",
                )}
                alt={frame()!.caption ?? "device frame"}
                src={`data:${frame()!.mime};base64,${frame()!.base64}`}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth && img.naturalHeight) {
                    setFrameAspect(`${img.naturalWidth} / ${img.naturalHeight}`);
                  }
                }}
                onPointerDown={(e) => {
                  // View mode is inert; only the primary button starts a gesture.
                  if (!rec.interacting() || e.button !== 0) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  down = {
                    fx: (e.clientX - r.left) / r.width,
                    fy: (e.clientY - r.top) / r.height,
                    t: e.timeStamp,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerUp={(e) => {
                  if (!rec.interacting()) return;
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
                  if (!rec.interacting()) return;
                  e.preventDefault();
                  openPickerAt(e.currentTarget, e.clientX, e.clientY);
                }}
                onMouseMove={(e) => scheduleHover(e.currentTarget, e.clientX, e.clientY)}
                onMouseLeave={() => clearHover()}
              />
              <Show when={server.showOverlays() && !picker() && hoverHighlight()}>
                {(h) => (
                  <div class="pointer-events-none absolute inset-0 z-[4]" aria-hidden="true">
                    <div
                      class="absolute rounded-[3px] border-[1.4px] border-accent bg-accent/10 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent)]"
                      style={h().rect}
                    />
                    <div
                      class={cn(
                        "absolute z-[5] max-w-[60%] overflow-hidden rounded-control bg-accent px-1.5 py-0.5 font-mono text-meta leading-snug text-ellipsis whitespace-nowrap text-accent-fg",
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
                    class="pointer-events-none absolute rounded-[3px] border-[1.6px] border-accent bg-accent/[0.16] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_40%,transparent)]"
                    aria-hidden="true"
                    style={h()}
                  />
                )}
              </Show>

              {/* tap confirmation ring */}
              <Show when={tapFeedback()}>
                {(fb) => (
                  <div
                    class="pointer-events-none absolute z-[6] origin-center rounded-full border-[1.5px] border-accent bg-accent/15 animate-ping"
                    aria-hidden="true"
                    style={{
                      left: `calc(${fb().x}% - 9px)`,
                      top: `calc(${fb().y}% - 9px)`,
                      width: "18px",
                      height: "18px",
                    }}
                  />
                )}
              </Show>
            </Show>
            {/* No frame yet: still show which step is selected on the glass */}
            <Show when={!frame() && focusedStep()}>
              {(s) => (
                <div class="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 bg-[radial-gradient(ellipse_70%_50%_at_50%_40%,color-mix(in_srgb,var(--c-accent)_14%,transparent),transparent_60%),#0c0d10] p-6 text-center">
                  <span
                    class={cn(
                      mono,
                      "text-[10px] font-bold tracking-[0.1em] text-accent-soft uppercase opacity-90",
                    )}
                  >
                    Step {s().index + 1}
                  </span>
                  <p class="m-0 max-w-[12em] text-sm font-semibold leading-snug tracking-tight text-white/[0.94]">
                    {s().title}
                  </p>
                  <p class="m-0 text-[11.5px] leading-snug text-white/45">
                    {rec.interacting()
                      ? "Drive the phone or Run the test"
                      : "Run the test to capture this screen"}
                  </p>
                </div>
              )}
            </Show>
            <Show when={!frame() && !focusedStep()}>
              <div class="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 bg-[#0c0d10] p-6 text-center">
                <p class="m-0 text-[11.5px] leading-snug text-white/45">Select a step or Run</p>
              </div>
            </Show>
            {/* Selected step chip over live frame */}
            <Show when={frame() && focusedStep()}>
              {(s) => (
                <div class="pointer-events-none absolute right-2.5 bottom-3 left-2.5 z-[4] flex items-center gap-2 rounded-[10px] bg-black/70 px-2.5 py-2 text-xs font-medium leading-snug text-white backdrop-blur-[10px]">
                  <span
                    class={cn(
                      mono,
                      "grid size-[18px] flex-none place-items-center rounded-[5px] bg-accent/40 text-[10px] font-bold",
                    )}
                  >
                    {s().index + 1}
                  </span>
                  {s().title}
                </div>
              )}
            </Show>
          </div>
        </div>

        <Show when={picker() && rec.interacting() && (pickerNode() || rec.recording())}>
          <div
            class="absolute z-10 mt-[-10px] min-w-[168px] -translate-y-full rounded-card bg-layer-2 p-1.5 shadow-lg"
            style={{ left: `${picker()!.vx}px`, top: `${picker()!.vy}px` }}
          >
            <div class="mb-1 flex max-w-[220px] flex-col gap-px border-b border-border px-2 pt-1 pb-1.5">
              <span class="truncate text-body font-semibold text-text">{nodeLabel()}</span>
              <Show when={metaLine()}>
                <span class={cn(mono, "truncate text-meta text-text-faint")}>{metaLine()}</span>
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
                        "max-w-[120px] cursor-pointer truncate rounded-full border-0 bg-transparent px-1.5 py-0.5 text-meta text-text-faint transition-colors hover:bg-hover hover:text-text",
                        i() === picker()!.index && "bg-accent/15 font-semibold text-accent-soft",
                      )}
                      title={shortLabel(n) || n.role || "node"}
                      onClick={() => retarget(i())}
                    >
                      {shortLabel(n) || n.role || "node"}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <div
              class="mx-0.5 mb-1 flex gap-0.5 rounded-control bg-layer-1 p-0.5"
              role="group"
              aria-label="Picker mode"
            >
              <button
                type="button"
                class={cn(
                  "flex-1 cursor-pointer rounded-[calc(var(--radius-control)-2px)] border-0 bg-transparent px-1.5 py-0.5 text-meta font-medium text-text-faint transition-colors hover:text-text",
                  pickMode() === "tap" && "bg-layer-3 text-text shadow-sm",
                )}
                onClick={() => setPickMode("tap")}
              >
                Tap
              </button>
              <button
                type="button"
                class={cn(
                  "flex-1 cursor-pointer rounded-[calc(var(--radius-control)-2px)] border-0 bg-transparent px-1.5 py-0.5 text-meta font-medium text-text-faint transition-colors hover:text-text",
                  pickMode() === "select" && "bg-layer-3 text-text shadow-sm",
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
                    class="cursor-pointer rounded-control px-2 py-1.5 text-left font-mono text-body text-accent-soft transition-colors hover:bg-hover hover:text-text"
                    onClick={() => void pick(s)}
                  >
                    {s.describe}
                  </button>
                )}
              </For>
            </div>
            <Show when={ancestry().length > 1}>
              <div class={cn(mono, "px-2 pt-1.5 pb-0.5 text-center text-meta text-text-faint")}>
                ↑ parent · ↓ child · esc to close
              </div>
            </Show>
          </div>
        </Show>

        <Show when={frame()?.caption}>
          <div class={cn(mono, "z-[2] mt-3 text-center text-meta text-text-faint")}>
            {frame()!.caption}
          </div>
        </Show>
      </Show>

      {/* Filmstrip — Figma-style timeline under the artboard (not a peer mode). */}
      <Show when={server.frames().length > 0}>
        <div class="z-[2] mt-3 flex w-full max-w-[560px] items-center gap-2.5 rounded-card border border-border bg-layer-1 px-2.5 py-2">
          <button
            type="button"
            class={cn(
              btnGhost,
              "size-7 flex-none place-items-center rounded-md bg-layer-3 p-0 text-text hover:scale-105",
            )}
            aria-label={server.playing() ? "Pause playback" : "Replay frames"}
            onClick={() => server.togglePlayback()}
          >
            <Icon name={server.playing() ? "pause" : "play"} size={14} />
          </button>
          <div
            class="flex h-[22px] flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="group"
            aria-label="Capture timeline"
          >
            <For each={server.frames()}>
              {(f, i) => {
                const prev = () => server.frames()[i() - 1];
                const gap = () =>
                  i() > 0 && prev()?.jobId !== f.jobId && (f.jobId || prev()?.jobId);
                return (
                  <>
                    <Show when={gap()}>
                      <span class="h-full w-0.5 flex-none bg-transparent" />
                    </Show>
                    <button
                      type="button"
                      class={cn(
                        "h-full min-w-1 flex-1 cursor-pointer rounded-[3px] border-0 bg-layer-3 transition hover:scale-y-110 hover:bg-text-muted",
                        i() < server.frameIndex() && "bg-text-faint",
                        i() === server.frameIndex() && "bg-accent",
                      )}
                      title={f.caption}
                      aria-label={`frame ${i() + 1}: ${f.caption}`}
                      onClick={() => wb.focusFrame(i())}
                    />
                  </>
                );
              }}
            </For>
          </div>
          <span class={cn(mono, "flex-none pr-0.5 text-meta text-text-faint")}>
            {server.frameIndex() + 1}/{server.frames().length}
          </span>
          <Show when={props.onExpandBoard}>
            <button
              type="button"
              class={cn(btnGhost, "ml-1 h-7 gap-1 text-xs font-medium text-text-muted")}
              data-tip="Expand board"
              aria-label="Expand frame board"
              onClick={() => props.onExpandBoard?.()}
            >
              <Icon name="grid" size={14} />
              Board
            </button>
          </Show>
        </div>
      </Show>

      {/* Mode controls only exist when a device can act — never greyed theatre. */}
      <Show when={server.health() === "online" && !server.isEmptyDevices()}>
        <div class="z-[2] mt-4 flex items-center justify-center gap-1">
          <div class={seg} role="group" aria-label="Stage mode">
            <button
              type="button"
              class={cn(segBtn, !rec.interacting() && segBtnOn)}
              aria-pressed={!rec.interacting()}
              onClick={() => setStageMode("view")}
            >
              View
            </button>
            <button
              type="button"
              class={cn(segBtn, rec.interacting() && !rec.recording() && segBtnOn)}
              aria-pressed={rec.interacting() && !rec.recording()}
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
              onClick={() => setStageMode("record")}
            >
              <span class="mr-1 inline-block size-1.5 rounded-full bg-current" aria-hidden="true" />
              Record
            </button>
          </div>
          <button
            type="button"
            class={cn(btnGhost, "h-[30px] flex-none px-1.5")}
            data-tip="Screenshot (⌘⇧S)"
            aria-label="Capture screenshot"
            disabled={server.busyCapture()}
            onClick={() => void server.captureUiScreenshot()}
          >
            <Show when={server.busyCapture()} fallback={<Icon name="camera" size={15} />}>
              <span
                class="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70"
                aria-hidden="true"
              />
            </Show>
          </button>
          <Show when={server.frames().length > 0}>
            <button
              type="button"
              class={cn(btnGhost, "h-[30px] flex-none px-1.5")}
              data-tip="Clear frames"
              aria-label="Clear frames"
              onClick={() => server.clearFrames()}
            >
              <Icon name="trash" size={15} />
            </button>
          </Show>
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
          "z-[3] mt-3.5 flex w-[min(420px,100%)] flex-col rounded-card bg-layer-1 px-2.5 py-1.5",
          rec.recording() ? "shadow-sm" : "opacity-90",
        )}
      >
        <div class="flex min-h-[22px] items-center gap-2 px-0.5">
          <span
            class={cn(
              "size-2 flex-none rounded-full",
              rec.recording() ? "animate-pulse bg-fail" : "bg-text-faint",
            )}
            aria-hidden="true"
          />
          <span
            class={cn(
              "flex-1 truncate text-meta",
              rec.recording() ? "font-semibold text-text" : "text-text-faint",
            )}
          >
            <Show
              when={rec.recording()}
              fallback="Drive mode — your input goes to the device · right-click to inspect"
            >
              Recording → {recordingTitle()}
            </Show>
          </span>
          <Show when={rec.typeBuffer()}>
            <span
              class={cn(mono, "max-w-[45%] flex-none truncate text-meta text-text")}
              title="Typing to device…"
            >
              “{rec.typeBuffer()}
              <span class="animate-pulse text-text" aria-hidden="true">
                ▍
              </span>
              ”
            </span>
          </Show>
          <Show when={rec.recording()}>
            <button
              type="button"
              class={cn(btnGhost, "h-[22px] flex-none px-2 text-meta text-fail")}
              onClick={() => rec.setRecording(false)}
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
