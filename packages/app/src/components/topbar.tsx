import { For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { useServer } from "../context/server";
import { useCommand } from "../context/command";
import { useTheme, type ColorScheme } from "@grok-device/ui/theme/context";
import { Icon } from "./icon";
import { fmtDur } from "../lib/job";

export function Topbar(props: { onSettings: () => void }) {
  const server = useServer();
  const cmd = useCommand();
  const theme = useTheme();
  const [deviceOpen, setDeviceOpen] = createSignal(false);
  const [appearOpen, setAppearOpen] = createSignal(false);
  const [themeIds, setThemeIds] = createSignal<string[]>([]);

  onMount(() => {
    void theme.loadThemes().then(() => setThemeIds(theme.ids()));

    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.(".appear-wrap")) setAppearOpen(false);
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

  const runDisabledReason = () => {
    if (server.health() !== "online") return "Server is offline — start with pnpm dev:serve";
    if (server.isEmptyDevices()) return "No device connected — run adb devices";
    const r = server.selectedRecipe();
    if (!r) return "Select a recipe first";
    return "";
  };

  // Run always enqueues; the label/title flip to "Queue" once a job is active.
  const canRun = () =>
    server.health() === "online" && !server.isEmptyDevices() && Boolean(server.selectedRecipe());

  const runTitle = () => {
    if (!canRun()) return runDisabledReason();
    const r = server.selectedRecipe();
    return server.activeJob()
      ? `Queue "${r?.title}" — runs after the current job`
      : `Run "${r?.title}"`;
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
          onClick={() => {
            setDeviceOpen((o) => !o);
            setAppearOpen(false);
          }}
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
          <span class="mono pick__label">{deviceLabel()}</span>
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

      <div
        class="appear-wrap desktop-titlebar-no-drag"
        onKeyDown={(e) => {
          if (e.key === "Escape" && appearOpen()) {
            e.stopPropagation();
            setAppearOpen(false);
          }
        }}
      >
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
          <span
            class="top__theme-dot"
            aria-hidden="true"
            style={{ background: theme.swatches(theme.themeId())?.primary ?? "var(--c-accent)" }}
          />
          Theme
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
        class="btn btn-ghost desktop-titlebar-no-drag"
        onClick={() => cmd.setOpen(true)}
        title="Command palette (⌘K)"
      >
        <Icon name="search" size={14} />
        <span class="mono">⌘K</span>
      </button>
      <button
        type="button"
        class="btn btn-ghost desktop-titlebar-no-drag"
        onClick={props.onSettings}
        title="Settings"
      >
        <Icon name="sliders" size={14} />
        Settings
      </button>
      <Show when={server.activeJob?.()}>
        <Show
          when={server.isPaused?.()}
          fallback={
            <button
              type="button"
              class="btn btn-ghost desktop-titlebar-no-drag"
              title="Pause job (Space)"
              onClick={() => void server.pauseJob()}
            >
              <Icon name="pause" size={13} />
              Pause
            </button>
          }
        >
          <button
            type="button"
            class="btn btn-ghost desktop-titlebar-no-drag"
            title="Resume job (Space)"
            onClick={() => void server.resumeJob()}
          >
            <Icon name="play" size={13} />
            Resume
          </button>
        </Show>
        <button
          type="button"
          class="btn btn-ghost desktop-titlebar-no-drag"
          title="Cancel job (Esc)"
          onClick={() => void server.cancelJob()}
          style={{ color: "var(--c-fail)" }}
        >
          <Icon name="x" size={13} />
          Cancel
        </button>
      </Show>
      <button
        type="button"
        class="btn btn-acc desktop-titlebar-no-drag"
        disabled={!canRun()}
        title={runDisabledReason()}
        onClick={() => {
          const r = server.selectedRecipe();
          if (r) void server.runRecipeRemote(r.id);
        }}
      >
        <Show
          when={server.isPaused?.()}
          fallback={
            <Show when={server.running()} fallback={<Icon name="play" size={13} />}>
              <span class="btn-spinner" aria-hidden="true" />
            </Show>
          }
        >
          <Icon name="pause" size={13} />
        </Show>
        {server.isPaused?.() ? "Paused" : server.running() ? "Running…" : "Run"}
      </button>
    </header>
  );
}
