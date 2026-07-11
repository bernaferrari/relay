import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

export function DevicePicker() {
  const server = useServer();
  const [open, setOpen] = createSignal(false);
  const device = () => server.devices().find((item) => item.serial === server.selectedDevice());

  onMount(() => {
    const onPointer = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest("[data-device-picker]")) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    });
  });

  return (
    <div class="relay-device-picker" data-device-picker>
      <button
        type="button"
        class={cn("relay-device-status", open() && "is-open")}
        aria-haspopup="listbox"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          class={cn(
            "relay-health",
            server.health() === "online" && Boolean(device()) && "is-online",
          )}
        />
        <span>
          {device()?.name ?? (server.health() === "online" ? "No device" : "Server offline")}
        </span>
        <Show when={device()}>
          <small>{device()!.kind ?? "Android"}</small>
        </Show>
        <Icon
          name="chevron-down"
          size={13}
          class={cn("relay-device-status__chevron", open() && "is-open")}
        />
      </button>
      <Show when={open()}>
        <div class="relay-device-menu" role="listbox" aria-label="Connected devices">
          <div class="relay-device-menu__head">
            <span>Devices</span>
            <button type="button" onClick={() => void server.refreshDevices()}>
              <Icon name="refresh" size={13} /> Refresh
            </button>
          </div>
          <Show
            when={server.devices().length > 0}
            fallback={
              <div class="relay-device-menu__empty">
                <span>
                  <Icon name="smartphone" size={18} />
                </span>
                <strong>No device connected</strong>
                <p>Connect over USB or Wi-Fi, then refresh.</p>
                <code>adb devices</code>
              </div>
            }
          >
            <For each={server.devices()}>
              {(item) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={item.serial === server.selectedDevice()}
                  class={cn(
                    "relay-device-option",
                    item.serial === server.selectedDevice() && "is-active",
                  )}
                  onClick={() => {
                    void server.setSelectedDevice(item.serial);
                    setOpen(false);
                  }}
                >
                  <span class="relay-device-option__icon">
                    <Icon name="smartphone" size={16} />
                  </span>
                  <span>
                    <strong>{item.name ?? "Android device"}</strong>
                    <small>
                      {item.serial} · {item.kind ?? "Android"}
                    </small>
                  </span>
                  <Show when={item.serial === server.selectedDevice()}>
                    <Icon name="check" size={15} />
                  </Show>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}
