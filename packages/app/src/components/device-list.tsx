import { For, Show } from "solid-js";
import { useServer } from "../context/server";

export function DeviceList() {
  const server = useServer();

  return (
    <section class="app-panel" aria-label="Devices">
      <h2 class="app-panel__title">Devices</h2>
      <Show
        when={server.devices().length > 0}
        fallback={
          <p class="empty-state">
            {server.health() === "offline"
              ? "Server offline — start the local API to list devices."
              : "No devices connected."}
          </p>
        }
      >
        <div class="list" role="listbox" aria-label="Device list">
          <For each={server.devices()}>
            {(device) => (
              <button
                type="button"
                class="list-item"
                role="option"
                data-selected={server.selectedDevice() === device.serial ? "true" : undefined}
                aria-selected={server.selectedDevice() === device.serial}
                onClick={() => server.setSelectedDevice(device.serial)}
              >
                <span class="list-item__title">{device.name ?? device.serial}</span>
                <span class="list-item__meta">
                  {device.serial}
                  {device.state ? ` · ${device.state}` : ""}
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
