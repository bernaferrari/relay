import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { useServer, type SnapshotNode, type RecipeStep } from "../context/server";
import {
  ancestryOf,
  nodeAtPoint,
  shortLabel,
  strategiesFor,
  targetFromStrategy,
  type PickStrategy,
} from "../lib/snapshot";
import { useRecorder, describeStep } from "../context/recorder";
import { Icon } from "./icon";

/** Device-as-hero stage: phone bezel, frame scrubber, snapshot rect overlays. */
export function DeviceStage() {
  const server = useServer();
  const rec = useRecorder();
  const frame = () => server.currentFrame();
  const [frameAspect, setFrameAspect] = createSignal("9 / 19.5");
  const job = () => server.jobs().find((j) => j.id === server.selectedJobId());
  const actionMeta = () =>
    server.actions().find((a) => a.id === (server.selectedRecipeId() ?? job()?.action));

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
    const bounds = server.snapshot()?.bounds;
    // The user picked the strategy; point is the emergency fallback.
    const target = targetFromStrategy(strategy, p.fx, p.fy, bounds);
    const step: RecipeStep = { kind: "tap", target };
    setPicker(null);
    if (pickMode() === "select") {
      rec.recordStep(step);
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
    let ok = await server.interactStep(body, describeStep(step));
    // chosen strategy failed (likely no session) — fall back to a coordinate tap
    if (!ok && strategy.kind !== "point" && target.point) {
      ok = await server.interactStep(
        { kind: "point", x: target.point.x, y: target.point.y },
        `tap ${target.point.x},${target.point.y}`,
      );
    }
    if (ok && rec.recording()) rec.recordStep(step);
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

  const overlays = () => {
    if (!server.showOverlays()) return [];
    const snap = server.snapshot();
    if (!snap?.nodes?.length || !snap.bounds) return [];
    return snap.nodes
      .filter((n) => n.rect && (n.hittable || n.label || n.ref))
      .slice(0, 80)
      .map((n) => {
        const r = n.rect!;
        const bw = snap.bounds!.width;
        const bh = snap.bounds!.height;
        return {
          node: n,
          left: `${(r.x / bw) * 100}%`,
          top: `${(r.y / bh) * 100}%`,
          width: `${(r.width / bw) * 100}%`,
          height: `${(r.height / bh) * 100}%`,
          label: (n.label ?? n.value ?? n.identifier ?? "").trim(),
        };
      });
  };

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

      <div class="stage__meta">
        <span class="stage__title">
          {job() ? (actionMeta()?.title ?? "Select an action") : "Select a run"}
        </span>
        <Show when={job()?.healed || job()?.status === "healed"}>
          <span class="badge b-heal">Healed</span>
        </Show>
        <Show when={job()?.status === "error"}>
          <span class="badge b-fail">Failed</span>
        </Show>
      </div>

      <Show
        when={!server.isEmptyDevices()}
        fallback={
          <div class="stage__no-device">
            <span class="stage__no-device-icon" aria-hidden="true">
              <Icon name="smartphone" size={34} strokeWidth={1.3} />
            </span>
            <p class="stage__no-device-title">No device connected</p>
            <p class="stage__no-device-hint">
              Connect a phone over USB or wireless adb, then refresh.
            </p>
            <div class="stage__connect">
              <button
                type="button"
                class="btn btn-acc"
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
              <span class="mono stage__connect-hint">adb devices</span>
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
                onClick={(e) => {
                  if (!rec.interacting()) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  const fx = (e.clientX - r.left) / r.width;
                  const fy = (e.clientY - r.top) / r.height;
                  const node = nodeAtPoint(server.snapshot(), fx, fy);
                  if (!node && !rec.recording()) {
                    setPicker(null);
                    void rec.handleTap(fx, fy);
                    return;
                  }
                  const s = stageEl?.getBoundingClientRect();
                  const snap = server.snapshot();
                  const anc = node && snap ? ancestryOf(snap, node) : node ? [node] : [];
                  setPicker({
                    fx,
                    fy,
                    vx: s ? e.clientX - s.left : e.clientX - r.left,
                    vy: s ? e.clientY - s.top : e.clientY - r.top,
                    ancestry: anc,
                    index: 0,
                  });
                  setPickMode(rec.recording() ? "select" : "tap");
                }}
              />
              <Show when={server.showOverlays() && overlays().length > 0}>
                <div class="glass__overlays">
                  <For each={overlays()}>
                    {(o) => (
                      <button
                        type="button"
                        class="hit-rect"
                        style={{
                          left: o.left,
                          top: o.top,
                          width: o.width,
                          height: o.height,
                        }}
                        title={o.label || "press"}
                        onClick={() => void server.pressNode(o.node)}
                      />
                    )}
                  </For>
                </div>
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

      <div class="stage__actions">
        <button
          type="button"
          class="btn btn-ghost"
          classList={{ "btn-ghost--on": rec.interacting() }}
          disabled={server.health() !== "online" || server.isEmptyDevices()}
          title="Interactive mode — click the preview to tap the device"
          onClick={() => {
            const next = !rec.interacting();
            rec.setInteracting(next);
            setPicker(null);
            if (next) {
              server.setShowOverlays(true);
              if (!server.snapshot()?.bounds) void server.captureUiSnapshot();
            }
          }}
        >
          <Icon name="pointer" size={14} />
          Interact {rec.interacting() ? "on" : "off"}
        </button>
        <Show when={rec.interacting()}>
          <button
            type="button"
            class="btn btn-ghost"
            classList={{
              "btn-ghost--on": rec.recording(),
              "recorder--active": rec.recording(),
            }}
            title="Record clicks as a reusable recipe"
            onClick={() => rec.setRecording(!rec.recording())}
          >
            <Icon name="circle" size={11} />
            {rec.recording() ? "Recording" : "Record"}
          </button>
        </Show>
        <button
          type="button"
          class="btn btn-ghost"
          disabled={server.busyCapture() || server.health() !== "online" || server.isEmptyDevices()}
          title={
            server.health() !== "online"
              ? "Server offline"
              : server.isEmptyDevices()
                ? "No device connected"
                : "Capture device screenshot"
          }
          onClick={() => void server.captureUiScreenshot()}
        >
          <Show
            when={server.busyCapture()}
            fallback={
              <>
                <Icon name="camera" size={14} /> Capture
              </>
            }
          >
            <span class="btn-spinner" aria-hidden="true" />
          </Show>
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          disabled={server.busyCapture() || server.health() !== "online" || server.isEmptyDevices()}
          title="Capture accessibility tree snapshot"
          onClick={() => void server.captureUiSnapshot()}
        >
          <Icon name="scan" size={14} />
          Snapshot
        </button>
        <Show when={server.frames().length > 0}>
          <button type="button" class="btn btn-ghost" onClick={() => server.clearFrames()}>
            <Icon name="trash" size={14} />
            Clear
          </button>
        </Show>
      </div>
      <RecorderBar />
    </section>
  );
}

function RecorderBar() {
  const rec = useRecorder();
  const [name, setName] = createSignal("");
  return (
    <Show when={rec.interacting() && (rec.recording() || rec.steps().length > 0)}>
      <div class="recorder">
        <div class="recorder__head">
          <span class="recorder__title" classList={{ "recorder__title--live": rec.recording() }}>
            {rec.recording() ? "Recording" : "Recorded"} · {rec.steps().length} steps
          </span>
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
                rec.saveRecipe(name());
                setName("");
              }}
            >
              <Icon name="check" size={13} />
              Save
            </button>
            <button type="button" class="btn btn-ghost" onClick={() => rec.clearSteps()}>
              Clear
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
