import { For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { useServer } from "../context/server";
import { Icon } from "./icon";
import { fmtDur, titleize } from "../lib/job";

/**
 * Topbar (plan 012) — brand · device picker · [spacer] · runbar pill (active
 * job) · Settings (icon-only). The Run button lives in the run pane header
 * (whose title is now the recipe switcher); the rail toggle + ⌘B are gone.
 * Electron titlebar-drag regions stay on the wrapper + no-drag on interactive
 * elements.
 */
export function Topbar(props: { onSettings: () => void }) {
  const server = useServer();
  const [deviceOpen, setDeviceOpen] = createSignal(false);

  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.(".pick-wrap")) setDeviceOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    onCleanup(() => document.removeEventListener("mousedown", onDoc));
  });

  const deviceLabel = () => {
    if (server.health() === "offline") return "Offline";
    const s = server.selectedDevice();
    if (!s) return server.isEmptyDevices() ? "No device" : "Select device";
    const d = server.devices().find((x) => x.serial === s);
    return d?.name ?? s;
  };

  return (
    <header class="top desktop-titlebar-drag">
      <div class="top__brand desktop-titlebar-no-drag">
        <span class="top__mark" aria-hidden="true">
          S
        </span>
        <span class="top__name">Specimen</span>
      </div>

      <div
        class="pick-wrap desktop-titlebar-no-drag"
        onKeyDown={(e) => {
          if (e.key === "Escape" && deviceOpen()) {
            e.stopPropagation();
            setDeviceOpen(false);
          }
        }}
      >
        <button
          type="button"
          class="pick"
          classList={{ "pick--empty": server.isEmptyDevices() || !server.selectedDevice() }}
          aria-haspopup="listbox"
          aria-expanded={deviceOpen()}
          onClick={() => setDeviceOpen((o) => !o)}
        >
          <span
            class="pick-status"
            classList={{
              on:
                server.health() === "online" &&
                Boolean(server.selectedDevice()) &&
                !server.isEmptyDevices(),
              warn:
                server.health() !== "offline" &&
                (server.isEmptyDevices() || !server.selectedDevice()),
              off: server.health() === "offline",
            }}
            aria-hidden="true"
          />
          <span class="pick__label">{deviceLabel()}</span>
          <span class="pick__chev">
            <Icon name="chevron-down" size={14} />
          </span>
        </button>
        <Show when={deviceOpen()}>
          <div class="pick-menu" role="listbox">
            <Show
              when={server.devices().length > 0}
              fallback={
                <div class="pick-empty">
                  <p class="pick-empty__title">No devices</p>
                  <p class="pick-empty__hint">Connect a phone, then refresh.</p>
                  <code class="mono pick-empty__code">adb devices</code>
                </div>
              }
            >
              <For each={server.devices()}>
                {(d) => (
                  <button
                    type="button"
                    role="option"
                    class="pick-item"
                    aria-selected={server.selectedDevice() === d.serial}
                    classList={{ on: server.selectedDevice() === d.serial }}
                    onClick={() => {
                      void server.setSelectedDevice(d.serial);
                      setDeviceOpen(false);
                    }}
                  >
                    <span class="pick-dot" classList={{ on: d.booted !== false }} />
                    <span>
                      <span class="pick-item__title">{d.name ?? d.serial}</span>
                      <span class="pick-item__meta mono">{d.serial}</span>
                    </span>
                  </button>
                )}
              </For>
            </Show>
            <button
              type="button"
              class="pick-item pick-item--action"
              onClick={() => {
                void (async () => {
                  await server.pollHealth();
                  if (server.health() === "online") await server.refreshDevices();
                })();
                setDeviceOpen(false);
              }}
            >
              Refresh devices
            </button>
          </div>
        </Show>
      </div>

      <span class="top__spacer" />

      <Show when={server.activeJob()}>
        {(job) => (
          <div class="runbar desktop-titlebar-no-drag" role="group" aria-label="Active job">
            <span class="runbar__pulse" aria-hidden="true">
              <Show when={server.isPaused()} fallback={<span class="runbar__spinner" />}>
                <Icon name="pause" size={10} />
              </Show>
            </span>
            <button
              type="button"
              class="runbar__title"
              title="Jump to this run"
              onClick={() => {
                const j = job();
                server.setSelectedRecipeId(j.action);
                server.jumpToJob(j.id);
              }}
            >
              {job().title ?? titleize(job().action, server.recipes())}
            </button>
            <span class="runbar__time mono">{fmtDur(job(), server.clock())}</span>
            <button
              type="button"
              class="runbar__btn"
              title={server.isPaused() ? "Resume (Space)" : "Pause (Space)"}
              aria-label={server.isPaused() ? "Resume job" : "Pause job"}
              onClick={() => {
                const a = server.activeJob();
                if (!a) return;
                if (a.status === "paused") void server.resumeJob(a.id);
                else void server.pauseJob(a.id);
              }}
            >
              <Icon name={server.isPaused() ? "play" : "pause"} size={12} />
            </button>
            <button
              type="button"
              class="runbar__btn runbar__btn--stop"
              title="Cancel (Esc)"
              aria-label="Cancel job"
              onClick={() => {
                const a = server.activeJob();
                if (a) void server.cancelJob(a.id);
              }}
            >
              <Icon name="square" size={11} />
            </button>
          </div>
        )}
      </Show>
      <button
        type="button"
        class="btn btn-ghost top__icon-btn desktop-titlebar-no-drag"
        data-tip="Settings (⌘,)"
        aria-label="Settings"
        onClick={props.onSettings}
      >
        <Icon name="sliders" size={15} />
      </button>
    </header>
  );
}
