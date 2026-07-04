import { For, Show } from "solid-js";
import { Button } from "@grok-device/ui/button";
import { useServer } from "../context/server";

export function Sidebar() {
  const server = useServer();

  return (
    <aside class="sidebar">
      <section class="sidebar__section">
        <div class="sidebar__head">
          <h2 class="app-panel__title">Devices</h2>
          <Button variant="ghost" size="sm" onClick={() => void server.refreshDevices()}>
            ↻
          </Button>
        </div>
        <div class="list">
          <Show
            when={server.devices().length > 0}
            fallback={
              <div class="empty">No Android devices. Plug in a phone / start emulator.</div>
            }
          >
            <For each={server.devices()}>
              {(d) => (
                <button
                  type="button"
                  class="list-item"
                  classList={{ "list-item--selected": server.selectedDevice() === d.serial }}
                  onClick={() => void server.setSelectedDevice(d.serial)}
                >
                  <span class="list-item__title">{d.name ?? d.serial}</span>
                  <span class="list-item__meta">
                    {d.serial}
                    {d.booted === false ? " · not booted" : ""}
                    {d.kind ? ` · ${d.kind}` : ""}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </section>

      <section class="sidebar__section">
        <div class="sidebar__head">
          <h2 class="app-panel__title">Run history</h2>
        </div>
        <div class="list">
          <Show
            when={server.jobs().length > 0}
            fallback={<div class="empty">No jobs yet. Run an action.</div>}
          >
            <For each={server.jobs()}>
              {(j) => (
                <button
                  type="button"
                  class="list-item"
                  classList={{ "list-item--selected": server.selectedJobId() === j.id }}
                  onClick={() => {
                    server.setSelectedJobId(j.id);
                    for (const line of j.logs) server.appendLog(line, undefined, j.id);
                  }}
                >
                  <span class="list-item__title">
                    <span class={`status-dot status-dot--${j.status}`} />
                    {j.action}
                  </span>
                  <span class="list-item__meta">
                    {j.status}
                    {j.serial ? ` · ${j.serial.slice(0, 8)}` : ""}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </section>
    </aside>
  );
}
