import { For, Show } from "solid-js";
import { useServer } from "../context/server";
import { EmptyState } from "./empty-state";

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

  const glassEmpty = () => {
    if (server.isOffline()) {
      return {
        title: "Server offline",
        description: "Connect the API to capture the device.",
        code: "pnpm dev:serve",
      };
    }
    if (server.isEmptyDevices()) {
      return {
        title: "No device",
        description: "Connect a phone over USB or wireless adb.",
        code: "adb devices",
      };
    }
    return {
      title: "No frames yet",
      description: "Capture a screenshot or run a recipe — the device is the evidence.",
    };
  };

  return (
    <section
      class="stage"
      aria-label="Device stage"
      classList={{ "stage--offline": server.isOffline() }}
    >
      <Show when={server.isOffline()}>
        <div class="stage__watermark" aria-hidden="true">
          Offline
        </div>
      </Show>

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
        <Show when={job()?.status === "error"}>
          <span class="badge b-fail">Failed</span>
        </Show>
      </div>

      <div class="bezel" data-empty={!frame() ? "1" : "0"}>
        <div class="glass">
          <div class="notch" aria-hidden="true" />
          <Show
            when={frame()}
            fallback={
              <div class="glass__empty">
                <div class="glass__empty-illus" aria-hidden="true">
                  <span class="glass__empty-rect" />
                  <span class="glass__empty-line" />
                  <span class="glass__empty-line glass__empty-line--short" />
                </div>
                <p>{glassEmpty().title}</p>
                <p class="glass__empty-hint">{glassEmpty().description}</p>
                <Show when={glassEmpty().code}>
                  <code class="mono glass__empty-code">{glassEmpty().code}</code>
                </Show>
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

      <div class="stage__caption mono">
        {frame()?.caption ??
          (server.isOffline()
            ? "server offline"
            : server.isEmptyDevices()
              ? "waiting for device…"
              : "waiting for capture…")}
      </div>

      <Show when={server.frames().length > 0}>
        <div class="scrubber">
          <button
            type="button"
            class="btn btn-ghost scrubber__play"
            aria-label={server.playing() ? "Pause playback" : "Replay frames"}
            onClick={() => server.togglePlayback()}
          >
            {server.playing() ? "❚❚" : "▶"}
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

      <Show when={!frame() && !server.isOffline()}>
        <div class="stage__empty-cta">
          <Show
            when={!server.isEmptyDevices()}
            fallback={
              <EmptyState
                size="sm"
                icon="device"
                title="Connect a phone"
                description="Plug in a device and refresh the list."
                code="adb devices"
                actionLabel="Refresh devices"
                onAction={() =>
                  void (async () => {
                    await server.pollHealth();
                    if (server.health() === "online") await server.refreshDevices();
                  })()
                }
              />
            }
          >
            <div class="stage__actions stage__actions--primary">
              <button
                type="button"
                class="btn btn-acc"
                disabled={server.busyCapture() || server.health() !== "online"}
                onClick={() => void server.captureUiScreenshot()}
              >
                <Show when={server.busyCapture()} fallback="Capture screenshot">
                  <span class="btn-spinner" aria-hidden="true" />
                  Capturing…
                </Show>
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                disabled={
                  server.running() || !server.selectedAction() || server.health() !== "online"
                }
                title={
                  !server.selectedAction()
                    ? "Pick a recipe in the panel, then run"
                    : "Run selected recipe"
                }
                onClick={() => void server.runSelected()}
              >
                Run a recipe
              </button>
            </div>
          </Show>
        </div>
      </Show>

      <div class="stage__actions">
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
          <Show when={server.busyCapture()} fallback="Capture">
            <span class="btn-spinner" aria-hidden="true" />…
          </Show>
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          disabled={server.busyCapture() || server.health() !== "online" || server.isEmptyDevices()}
          title="Capture accessibility tree snapshot"
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
