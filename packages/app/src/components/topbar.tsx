import { For, Show, createSignal } from "solid-js";
import { useServer } from "../context/server";
import { useCommand } from "../context/command";

export function Topbar(props: { onSettings: () => void }) {
  const server = useServer();
  const cmd = useCommand();
  const [deviceOpen, setDeviceOpen] = createSignal(false);

  const deviceLabel = () => {
    const s = server.selectedDevice();
    if (!s) return "No device";
    const d = server.devices().find((x) => x.serial === s);
    return d?.name ?? s;
  };

  const runStatus = () => {
    if (server.running()) return { cls: "b-run", label: "Running" };
    const jobs = server.jobs();
    if (jobs.length === 0) return { cls: "b-dim", label: "Idle" };
    if (jobs.some((j) => j.status === "error")) return { cls: "b-fail", label: "Failed" };
    if (jobs.every((j) => j.status === "ok")) return { cls: "b-pass", label: "Passed" };
    return { cls: "b-run", label: "Active" };
  };

  return (
    <header class="top">
      <div class="top__brand">
        <span class="top__mark" aria-hidden="true">
          ▣
        </span>
        <span class="top__name">grok-device</span>
      </div>

      <div class="pick-wrap">
        <button
          type="button"
          class="pick"
          aria-haspopup="listbox"
          aria-expanded={deviceOpen()}
          onClick={() => setDeviceOpen((o) => !o)}
        >
          <span class="mono pick__label">{deviceLabel()}</span>
          <span class="pick__chev">▾</span>
        </button>
        <Show when={deviceOpen()}>
          <div class="pick-menu" role="listbox">
            <Show
              when={server.devices().length > 0}
              fallback={<div class="pick-empty">No devices — connect via adb</div>}
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
                void server.refreshDevices();
                setDeviceOpen(false);
              }}
            >
              Refresh devices
            </button>
          </div>
        </Show>
      </div>

      <span class={`badge ${runStatus().cls}`}>
        <span class="badge__dot" />
        {runStatus().label}
      </span>

      <Show when={server.health() === "online"}>
        <span class="mono top__meta">
          {server.sseConnected() ? "live" : "http"} ·{" "}
          {server.serverUrl().replace(/^https?:\/\//, "")}
        </span>
      </Show>
      <Show when={server.health() !== "online"}>
        <span class="mono top__meta top__meta--bad">server offline</span>
      </Show>

      <span class="top__spacer" />

      <button
        type="button"
        class="btn btn-ghost"
        onClick={() => cmd.setOpen(true)}
        title="Command palette"
      >
        ⌘K
      </button>
      <button type="button" class="btn btn-ghost" onClick={props.onSettings}>
        Settings
      </button>
      <button
        type="button"
        class="btn btn-acc"
        disabled={server.running() || !server.selectedAction() || server.health() !== "online"}
        onClick={() => void server.runSelected()}
      >
        {server.running() ? "Running…" : "Run"}
      </button>
    </header>
  );
}
