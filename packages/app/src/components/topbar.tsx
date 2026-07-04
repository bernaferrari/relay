import { For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { useServer } from "../context/server";
import { useCommand } from "../context/command";
import { useTheme, type ColorScheme } from "@grok-device/ui/theme/context";

export function Topbar(props: { onSettings: () => void }) {
  const server = useServer();
  const cmd = useCommand();
  const theme = useTheme();
  const [deviceOpen, setDeviceOpen] = createSignal(false);
  const [appearOpen, setAppearOpen] = createSignal(false);
  const [themeIds, setThemeIds] = createSignal<string[]>([]);

  onMount(() => {
    void theme.loadThemes().then(() => setThemeIds(theme.ids()));
    setThemeIds(theme.ids());

    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.(".appear-wrap")) setAppearOpen(false);
      if (!t?.closest?.(".pick-wrap")) setDeviceOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    onCleanup(() => document.removeEventListener("mousedown", onDoc));
  });

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
    if (jobs.some((j) => j.status === "healed" || j.healed))
      return { cls: "b-heal", label: "Healed" };
    if (jobs.length > 0 && jobs.every((j) => j.status === "ok" || j.status === "healed"))
      return { cls: "b-pass", label: "Passed" };
    return { cls: "b-run", label: "Active" };
  };

  const popular = () => {
    const prefer = [
      "grok",
      "opencode",
      "oc-2",
      "catppuccin",
      "tokyonight",
      "dracula",
      "nord",
      "rosepine",
      "gruvbox",
      "one-dark",
      "github",
      "vercel",
    ];
    const all = themeIds().length ? themeIds() : theme.ids();
    const set = new Set(all);
    const first = prefer.filter((id) => set.has(id));
    const rest = all.filter((id) => !first.includes(id));
    return [...first, ...rest];
  };

  return (
    <header class="top">
      <div class="top__brand">
        <span class="top__mark" aria-hidden="true">
          G
        </span>
        <span class="top__name">Grok Device</span>
      </div>

      <div class="pick-wrap">
        <button
          type="button"
          class="pick"
          aria-haspopup="listbox"
          aria-expanded={deviceOpen()}
          onClick={() => {
            setDeviceOpen((o) => !o);
            setAppearOpen(false);
          }}
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

      <div class="appear-wrap">
        <button
          type="button"
          class="btn btn-ghost"
          aria-haspopup="dialog"
          aria-expanded={appearOpen()}
          title="Theme & color scheme"
          onClick={() => {
            setAppearOpen((o) => !o);
            setDeviceOpen(false);
            void theme.loadThemes().then(() => setThemeIds(theme.ids()));
          }}
        >
          Theme
          <span class="mono" style={{ "font-size": "11px", color: "var(--faint)" }}>
            {theme.name(theme.themeId())} · {theme.mode()}
          </span>
        </button>
        <Show when={appearOpen()}>
          <div class="appear-menu" role="dialog" aria-label="Appearance">
            <div class="appear-menu__section">
              <div class="appear-menu__title">Color scheme</div>
              <div class="scheme-seg" role="group" aria-label="Color scheme">
                {(
                  [
                    ["system", "System"],
                    ["light", "Light"],
                    ["dark", "Dark"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    type="button"
                    class="scheme-seg__btn"
                    classList={{ on: theme.colorScheme() === id }}
                    onClick={() => theme.setColorScheme(id as ColorScheme)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div class="appear-menu__section">
              <div class="appear-menu__title">OpenCode themes</div>
              <div class="appear-menu__themes">
                <For each={popular()}>
                  {(id) => {
                    const sw = () => theme.swatches(id);
                    return (
                      <button
                        type="button"
                        class="appear-menu__theme"
                        classList={{ on: theme.themeId() === id }}
                        onClick={() => theme.setTheme(id)}
                      >
                        <span
                          class="appear-menu__swatch"
                          style={{ background: sw()?.primary ?? "var(--acc)" }}
                        />
                        <span style={{ overflow: "hidden", "text-overflow": "ellipsis" }}>
                          {theme.name(id)}
                        </span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
            <div class="appear-menu__footer">
              <button
                type="button"
                class="btn btn-ghost"
                style={{ "font-size": "12px" }}
                onClick={() => {
                  setAppearOpen(false);
                  props.onSettings();
                }}
              >
                All themes in Settings…
              </button>
            </div>
          </div>
        </Show>
      </div>

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
