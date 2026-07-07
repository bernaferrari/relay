import { For, Show, createSignal, onCleanup } from "solid-js";
import { useServer, type SnapshotNode } from "../context/server";
import { useRecorder, describeStep, type RecStep } from "../context/recorder";
import { Icon } from "./icon";

/** Device-as-hero stage: phone bezel, frame scrubber, snapshot rect overlays. */
export function DeviceStage() {
  const server = useServer();
  const rec = useRecorder();
  const frame = () => server.currentFrame();
  const [frameAspect, setFrameAspect] = createSignal("9 / 19.5");
  const job = () => server.jobs().find((j) => j.id === server.selectedJobId());
  const actionMeta = () =>
    server.actions().find((a) => a.id === (server.selectedAction() ?? job()?.action));

  let stageEl: HTMLElement | undefined;

  /** Element picker: shows the hit node + precision options instead of tapping on click. */
  const [picker, setPicker] = createSignal<{
    fx: number;
    fy: number;
    vx: number;
    vy: number;
    node: SnapshotNode | null;
  } | null>(null);

  /** Smallest a11y node containing the fractional point (mirrors recorder.nodeAt). */
  function hitNode(fx: number, fy: number): SnapshotNode | null {
    const snap = server.snapshot();
    if (!snap?.bounds) return null;
    const bw = snap.bounds.width;
    const bh = snap.bounds.height;
    let best: SnapshotNode | null = null;
    let bestArea = Infinity;
    for (const n of snap.nodes) {
      if (!n.rect) continue;
      const nx = n.rect.x / bw;
      const ny = n.rect.y / bh;
      const nw = n.rect.width / bw;
      const nh = n.rect.height / bh;
      if (fx >= nx && fx <= nx + nw && fy >= ny && fy <= ny + nh) {
        const area = nw * nh;
        if (area > 0 && area < bestArea) {
          best = n;
          bestArea = area;
        }
      }
    }
    return best;
  }

  const pickerNode = () => picker()?.node ?? null;
  const nodeLabel = () => {
    const n = pickerNode();
    return n?.label ?? n?.value ?? n?.identifier ?? "No element";
  };
  const labelOption = () => (pickerNode()?.label ?? pickerNode()?.value ?? "").trim();
  const pointStep = (): { kind: "point"; x: number; y: number } => {
    const p = picker();
    const b = server.snapshot()?.bounds;
    const w = b?.width ?? 1;
    const h = b?.height ?? 1;
    return { kind: "point", x: Math.round((p?.fx ?? 0) * w), y: Math.round((p?.fy ?? 0) * h) };
  };
  const refStep = (): RecStep => {
    const n = pickerNode()!;
    const raw = n.ref!;
    return {
      kind: "ref",
      ref: raw.startsWith("@") ? raw : `@${raw}`,
      label: (n.label ?? n.value ?? n.identifier ?? "").trim() || undefined,
    };
  };

  /** Execute the chosen precision: tap, then record if recording. */
  async function pick(step: RecStep): Promise<void> {
    const p = picker();
    if (!p) return;
    setPicker(null);
    let ok = await server.interactStep(step, describeStep(step));
    if (!ok && step.kind !== "point") {
      // ref/label failed (likely no session) — fall back to a coordinate tap
      const bounds = server.snapshot()?.bounds;
      if (bounds) {
        const pointStep: RecStep = {
          kind: "point",
          x: Math.round(p.fx * bounds.width),
          y: Math.round(p.fy * bounds.height),
        };
        ok = await server.interactStep(pointStep, describeStep(pointStep));
        if (ok && rec.recording()) rec.recordStep(pointStep);
        return;
      }
    }
    if (ok && rec.recording()) rec.recordStep(step);
  }

  const onStageKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && picker()) setPicker(null);
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
                  const node = hitNode(fx, fy);
                  if (!node && !rec.recording()) {
                    setPicker(null);
                    void rec.handleTap(fx, fy);
                    return;
                  }
                  const s = stageEl?.getBoundingClientRect();
                  setPicker({
                    fx,
                    fy,
                    vx: s ? e.clientX - s.left : e.clientX - r.left,
                    vy: s ? e.clientY - s.top : e.clientY - r.top,
                    node,
                  });
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
            </Show>
          </div>
        </div>

        <Show when={picker() && rec.interacting() && (picker()!.node || rec.recording())}>
          <div class="picker" style={{ left: `${picker()!.vx}px`, top: `${picker()!.vy}px` }}>
            <div class="picker__label">{nodeLabel()}</div>
            <div class="picker__opts">
              <Show when={pickerNode()?.ref}>
                <button type="button" class="picker__opt" onClick={() => void pick(refStep())}>
                  @{(pickerNode()?.ref ?? "").replace(/^@/, "")}
                </button>
              </Show>
              <Show when={labelOption()}>
                <button
                  type="button"
                  class="picker__opt"
                  onClick={() => void pick({ kind: "label", label: labelOption()! })}
                >
                  "{labelOption()}"
                </button>
              </Show>
              <button type="button" class="picker__opt" onClick={() => void pick(pointStep())}>
                {pointStep().x}, {pointStep().y}
              </button>
            </div>
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
