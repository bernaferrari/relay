import { For, Show } from "solid-js";
import { useServer } from "../context/server";

/** Device-as-hero stage: phone bezel + frame scrubber (qa-viewer Stage). */
export function DeviceStage() {
  const server = useServer();
  const frame = () => server.currentFrame();
  const job = () => server.jobs().find((j) => j.id === server.selectedJobId()) ?? server.jobs()[0];
  const actionMeta = () =>
    server.actions().find((a) => a.id === (server.selectedAction() ?? job()?.action));

  return (
    <section class="stage" aria-label="Device stage">
      <div class="stage__meta">
        <span class="mono stage__step">
          {server.selectedAction()
            ? server.actions().findIndex((a) => a.id === server.selectedAction()) + 1
            : "—"}
          /{String(server.actions().length).padStart(2, "0")}
        </span>
        <span class="stage__divider" />
        <span class="stage__title">{actionMeta()?.title ?? "Select an action"}</span>
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
        <Show when={server.frames().length > 0}>
          <button type="button" class="btn btn-ghost" onClick={() => server.clearFrames()}>
            Clear
          </button>
        </Show>
      </div>
    </section>
  );
}
