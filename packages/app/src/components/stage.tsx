import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
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
import { useRecorder, describeStep } from "../context/recorder";
import { Icon } from "./icon";
import { useCommand } from "../context/command";

/** Device-as-hero stage: phone bezel, frame scrubber, snapshot rect overlays. */
export function DeviceStage() {
  const server = useServer();
  const rec = useRecorder();
  const cmd = useCommand();
  const frame = () =>
    rec.interacting() ? (server.liveFrame() ?? server.currentFrame()) : server.currentFrame();
  const [frameAspect, setFrameAspect] = createSignal("9 / 19.5");

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
    if (pickMode() === "select") {
      // Select-only: record the chosen-strategy step WITHOUT tapping.
      rec.recordPick(strategy, p.fx, p.fy);
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
    if (ok && rec.recording()) rec.recordPick(strategy, p.fx, p.fy);
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
  });
  /** Segmented stage mode (plan 009 step 6): View = watch only;
   *  Drive = live poll + click-to-tap + hover-inspect; Record = Drive +
   *  capture. Hover-inspect is on by default in Drive/Record; ⌘O remains
   *  the power-user escape hatch (showOverlays signal kept). */
  function setStageMode(mode: "view" | "drive" | "record"): void {
    const interacting = mode !== "view";
    const recording = mode === "record";
    rec.setInteracting(interacting);
    rec.setRecording(recording);
    setPicker(null);
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

  return (
    <section
      class="stage"
      ref={stageEl}
      aria-label="Device stage"
      classList={{ "stage--offline": server.isOffline() }}
    >
      <Show when={server.isOffline()}>
        <div class="stage__watermark" aria-hidden="true">
          Offline
        </div>
      </Show>

      <Show
        when={!server.isEmptyDevices()}
        fallback={
          <div class="bezel--seat">
            <Icon name="smartphone" size={24} strokeWidth={1.3} />
            <p class="stage__no-device-title">No device connected</p>
            <p class="stage__no-device-hint">
              Connect a phone over USB or wireless adb, then refresh.
            </p>
            <div class="stage__connect">
              <button
                type="button"
                class="btn btn-ghost"
                style={{ border: "1px solid var(--v2-border-border-muted)" }}
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
        <div
          class="bezel"
          data-empty={!frame() ? "1" : "0"}
          style={{ "aspect-ratio": frameAspect() }}
        >
          <div class="glass">
            <Show when={frame()}>
              <img
                class="glass__img"
                classList={{ "glass__img--interactive": rec.interacting() }}
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
                  <div class="glass__overlays" aria-hidden="true">
                    <div class="hit-rect hit-rect--hover" style={h().rect} />
                    <div
                      class="hit-chip"
                      classList={{ "hit-chip--below": h().chip.below }}
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
                {(h) => <div class="hit-rect hit-rect--picked" aria-hidden="true" style={h()} />}
              </Show>
            </Show>
          </div>
        </div>

        <Show when={picker() && rec.interacting() && (pickerNode() || rec.recording())}>
          <div class="picker" style={{ left: `${picker()!.vx}px`, top: `${picker()!.vy}px` }}>
            <div class="picker__head">
              <span class="picker__label">{nodeLabel()}</span>
              <Show when={metaLine()}>
                <span class="picker__meta mono">{metaLine()}</span>
              </Show>
            </div>
            <Show when={ancestry().length > 1}>
              <div class="picker__crumbs" role="group" aria-label="Element ancestry">
                <For each={ancestry().slice(0, 4)}>
                  {(n, i) => (
                    <button
                      type="button"
                      class="picker__crumb"
                      classList={{ "picker__crumb--on": i() === picker()!.index }}
                      title={shortLabel(n) || n.role || "node"}
                      onClick={() => retarget(i())}
                    >
                      {shortLabel(n) || n.role || "node"}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <div class="picker__mode" role="group" aria-label="Picker mode">
              <button
                type="button"
                class="picker__mode-btn"
                classList={{ "picker__mode-btn--on": pickMode() === "tap" }}
                onClick={() => setPickMode("tap")}
              >
                Tap
              </button>
              <button
                type="button"
                class="picker__mode-btn"
                classList={{ "picker__mode-btn--on": pickMode() === "select" }}
                onClick={() => setPickMode("select")}
              >
                Select only
              </button>
            </div>
            <div class="picker__opts">
              <For each={strategies()}>
                {(s) => (
                  <button type="button" class="picker__opt" onClick={() => void pick(s)}>
                    {s.describe}
                  </button>
                )}
              </For>
            </div>
            <Show when={ancestry().length > 1}>
              <div class="picker__hint mono">↑ parent · ↓ child · esc to close</div>
            </Show>
          </div>
        </Show>

        <Show when={frame()?.caption}>
          <div class="stage__caption mono">{frame()!.caption}</div>
        </Show>
      </Show>

      <Show when={server.frames().length > 0}>
        <div class="scrubber">
          <button
            type="button"
            class="btn btn-ghost scrubber__play"
            aria-label={server.playing() ? "Pause playback" : "Replay frames"}
            onClick={() => server.togglePlayback()}
          >
            <Icon name={server.playing() ? "pause" : "play"} size={14} />
          </button>
          <div class="ticks" role="group" aria-label="Capture timeline">
            <For each={server.frames()}>
              {(f, i) => {
                const prev = () => server.frames()[i() - 1];
                const gap = () =>
                  i() > 0 && prev()?.jobId !== f.jobId && (f.jobId || prev()?.jobId);
                return (
                  <>
                    <Show when={gap()}>
                      <span class="tick gap" />
                    </Show>
                    <button
                      type="button"
                      class="tick"
                      classList={{
                        past: i() < server.frameIndex(),
                        now: i() === server.frameIndex(),
                      }}
                      title={f.caption}
                      aria-label={`frame ${i() + 1}: ${f.caption}`}
                      onClick={() => {
                        server.stopPlayback();
                        server.setFrameIndex(i());
                      }}
                    />
                  </>
                );
              }}
            </For>
          </div>
          <span class="mono scrubber__count">
            {server.frameIndex() + 1}/{server.frames().length}
          </span>
        </div>
      </Show>

      <div class="stage__controls">
        <Show when={server.health() === "online" && !server.isEmptyDevices()}>
          <div class="seg" role="group" aria-label="Stage mode">
            <button
              type="button"
              class="seg__btn"
              classList={{ "seg__btn--on": !rec.interacting() }}
              aria-pressed={!rec.interacting()}
              onClick={() => setStageMode("view")}
            >
              View
            </button>
            <button
              type="button"
              class="seg__btn"
              classList={{ "seg__btn--on": rec.interacting() && !rec.recording() }}
              aria-pressed={rec.interacting() && !rec.recording()}
              onClick={() => setStageMode("drive")}
            >
              Drive
            </button>
            <button
              type="button"
              class="seg__btn"
              classList={{
                "seg__btn--on": rec.interacting() && rec.recording(),
                "seg__btn--rec": rec.interacting() && rec.recording(),
              }}
              aria-pressed={rec.interacting() && rec.recording()}
              onClick={() => setStageMode("record")}
            >
              <span class="seg__dot" aria-hidden="true" />
              Record
            </button>
          </div>
          <button
            type="button"
            class="btn btn-ghost top__icon-btn"
            data-tip="Screenshot (⌘⇧S)"
            aria-label="Capture screenshot"
            disabled={server.busyCapture()}
            onClick={() => void server.captureUiScreenshot()}
          >
            <Show when={server.busyCapture()} fallback={<Icon name="camera" size={15} />}>
              <span class="btn-spinner" aria-hidden="true" />
            </Show>
          </button>
          <Show when={server.frames().length > 0}>
            <button
              type="button"
              class="btn btn-ghost top__icon-btn"
              data-tip="Clear captured frames"
              aria-label="Clear frames"
              onClick={() => server.clearFrames()}
            >
              <Icon name="trash" size={15} />
            </button>
          </Show>
        </Show>
      </div>
      <RecorderBar />
    </section>
  );
}

function RecorderBar() {
  const rec = useRecorder();
  const [name, setName] = createSignal("");
  /** Head status line: red-dot + sentence when recording, hint when driving,
   *  count when steps linger after stopping. */
  const statusLine = () => {
    if (rec.recording()) {
      const s = rec.steps();
      const last = s.length ? describeStep(s[s.length - 1]!) : "capturing…";
      return `Recording · ${s.length} step${s.length === 1 ? "" : "s"} · ${last}`;
    }
    if (rec.steps().length > 0) {
      return `Recorded · ${rec.steps().length} step${rec.steps().length === 1 ? "" : "s"}`;
    }
    return "Drive mode — your input goes to the device · right-click to inspect";
  };
  return (
    <Show when={rec.interacting()}>
      <div class="recorder" classList={{ "recorder--rec": rec.recording() }}>
        <div class="recorder__head">
          <span
            class="recorder__dot"
            classList={{ "recorder__dot--rec": rec.recording() }}
            aria-hidden="true"
          />
          <span class="recorder__status">{statusLine()}</span>
          <Show when={rec.typeBuffer()}>
            <span class="recorder__type mono" title="Typing to device…">
              “{rec.typeBuffer()}
              <span class="recorder__caret" aria-hidden="true">
                ▍
              </span>
              ”
            </span>
          </Show>
        </div>
        <Show when={rec.steps().length > 0}>
          <div class="recorder__steps">
            <For each={rec.steps()}>
              {(step, i) => (
                <div class="recorder__step">
                  <span class="recorder__step-i mono">{String(i() + 1).padStart(2, "0")}</span>
                  <span class="recorder__step-text mono">{describeStep(step)}</span>
                  <button
                    type="button"
                    class="recorder__step-rm"
                    aria-label="Remove step"
                    onClick={() => rec.removeStep(i())}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              )}
            </For>
          </div>
          <div class="recorder__save">
            <input
              class="recorder__name"
              type="text"
              placeholder="Recipe name…"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              spellcheck={false}
            />
            <button
              type="button"
              class="btn btn-acc"
              onClick={() => {
                void rec.saveRecipe(name());
                setName("");
              }}
            >
              <Icon name="check" size={13} />
              Save
            </button>
            <button type="button" class="btn btn-ghost" onClick={() => rec.clearSteps()}>
              Discard
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
