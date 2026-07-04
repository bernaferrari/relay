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
    if (!s) return server.isEmptyDevices() ? "No device" : "Select device";
    const d = server.devices().find((x) => x.serial === s);
    return d?.name ?? s;
  };

  /** Connection: Offline / Live (SSE) / Online (HTTP only). */
  const connection = () => {
    if (server.health() === "offline") {
      return { cls: "conn--off", label: "Offline", title: "API unreachable" };
    }
    if (server.health() === "unknown") {
      return { cls: "conn--dim", label: "Connecting", title: "Checking API health…" };
    }
    if (server.sseConnected()) {
      return { cls: "conn--live", label: "Live", title: "SSE connected" };
    }
    return { cls: "conn--on", label: "Online", title: "HTTP connected (no SSE)" };
  };

  const runDisabledReason = () => {
    if (server.health() !== "online") return "Server is offline — start with pnpm dev:serve";
    if (server.running()) return "A job is already running";
    if (!server.selectedAction()) return "Select a recipe first";
    if (server.isEmptyDevices()) return "No device connected — run adb devices";
    return "Run selected recipe";
  };

  const canRun = () =>
    !server.running() && Boolean(server.selectedAction()) && server.health() === "online";

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
          classList={{ "pick--empty": server.isEmptyDevices() || !server.selectedDevice() }}
          aria-haspopup="listbox"
          aria-expanded={deviceOpen()}
          onClick={() => {
            setDeviceOpen((o) => !o);
            setAppearOpen(false);
          }}
        >
          <span
            class="pick-status"
            classList={{
              on: Boolean(server.selectedDevice()) && !server.isEmptyDevices(),
              warn: server.isEmptyDevices(),
            }}
            aria-hidden="true"
          />
          <span class="mono pick__label">{deviceLabel()}</span>
          <span class="pick__chev">▾</span>
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

      <span class={`conn ${connection().cls}`} title={connection().title}>
        <span class="conn__dot" />
        {connection().label}
      </span>

      <Show when={server.health() === "online" && server.serverUrl()}>
        <span class="mono top__host" title={server.serverUrl()}>
          {server.serverUrl().replace(/^https?:\/\//, "")}
        </span>
      </Show>

      <span class="top__spacer" />

      <div class="appear-wrap">
        <button
          type="button"
          class="btn btn-ghost top__theme-btn"
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
          <span class="mono top__theme-meta">
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
                          style={{ background: sw()?.primary ?? "var(--button-primary-base)" }}
                        />
                        <span class="appear-menu__theme-name">{theme.name(id)}</span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
            <div class="appear-menu__footer">
              <button
                type="button"
                class="btn btn-ghost appear-menu__more"
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
        title="Command palette (⌘K)"
      >
        ⌘K
      </button>
      <button type="button" class="btn btn-ghost" onClick={props.onSettings} title="Settings">
        Settings
      </button>
      <button
        type="button"
        class="btn btn-acc"
        disabled={!canRun()}
        title={runDisabledReason()}
        onClick={() => void server.runSelected()}
      >
        {server.running() ? "Running…" : "Run"}
      </button>
    </header>
  );
}
