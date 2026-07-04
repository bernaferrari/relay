import { For, Show } from "solid-js";
import { useServer } from "../context/server";

/** Device-as-hero stage: phone bezel, frame scrubber, snapshot rect overlays. */
export function DeviceStage() {
  const server = useServer();
  const frame = () => server.currentFrame();
  const job = () => server.jobs().find((j) => j.id === server.selectedJobId()) ?? server.jobs()[0];
  const actionMeta = () =>
    server.actions().find((a) => a.id === (server.selectedAction() ?? job()?.action));

  const overlays = () => {
    if (!server.showOverlays()) return [];
    const snap = server.snapshot();
    if (!snap?.nodes?.length || !snap.bounds) return [];
    // only hittable-ish nodes with rects, capped
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
    <section class="stage" aria-label="Device stage">
      <div class="stage__meta">
        <span class="mono stage__step">
          {server.selectedAction()
            ? String(
                server.actions().findIndex((a) => a.id === server.selectedAction()) + 1,
              ).padStart(2, "0")
            : "—"}
          /{String(server.actions().length).padStart(2, "0")}
        </span>
        <span class="stage__divider" />
        <span class="stage__title">{actionMeta()?.title ?? "Select an action"}</span>
        <Show when={job()?.healed || job()?.status === "healed"}>
          <span class="badge b-heal">Healed</span>
        </Show>
      </div>

      <div class="bezel" data-empty={!frame() ? "1" : "0"}>
        <div class="glass">
          <div class="notch" aria-hidden="true" />
          <Show
            when={frame()}
            fallback={
              <div class="glass__empty">
                <div class="glass__empty-mark" />
                <p>No frames yet</p>
                <p class="glass__empty-hint">
                  Run an action or capture a screenshot — the device is the evidence.
                </p>
              </div>
            }
          >
            <img
              class="glass__img"
              alt={frame()!.caption}
              src={`data:${frame()!.mime};base64,${frame()!.base64}`}
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

      <div class="stage__caption mono">{frame()?.caption ?? "waiting for capture…"}</div>

      <div class="scrubber">
        <button
          type="button"
          class="btn btn-ghost scrubber__play"
          aria-label={server.playing() ? "Pause playback" : "Replay frames"}
          disabled={server.frames().length === 0}
          onClick={() => server.togglePlayback()}
        >
          {server.playing() ? "❚❚" : "▶"}
        </button>
        <div class="ticks" role="group" aria-label="Capture timeline">
          <For each={server.frames()}>
            {(f, i) => {
              const prev = () => server.frames()[i() - 1];
              const gap = () => i() > 0 && prev()?.jobId !== f.jobId && (f.jobId || prev()?.jobId);
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
          <Show when={server.frames().length === 0}>
            <span class="ticks__empty mono">no frames</span>
          </Show>
        </div>
        <span class="mono scrubber__count">
          {server.frames().length === 0
            ? "0/0"
            : `${server.frameIndex() + 1}/${server.frames().length}`}
        </span>
      </div>

      <div class="stage__actions">
        <button
          type="button"
          class="btn btn-ghost"
          disabled={server.busyCapture() || server.health() !== "online"}
          onClick={() => void server.captureUiScreenshot()}
        >
          {server.busyCapture() ? "…" : "Capture"}
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          disabled={server.busyCapture() || server.health() !== "online"}
          onClick={() => void server.captureUiSnapshot()}
        >
          Snapshot
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          classList={{ "btn-ghost--on": server.showOverlays() }}
          disabled={!server.snapshot()?.bounds}
          title="Toggle accessibility rect overlays on the phone glass"
          onClick={() => server.setShowOverlays(!server.showOverlays())}
        >
          Overlays {server.showOverlays() ? "on" : "off"}
        </button>
        <Show when={server.frames().length > 0}>
          <button type="button" class="btn btn-ghost" onClick={() => server.clearFrames()}>
            Clear
          </button>
        </Show>
      </div>
    </section>
  );
}
