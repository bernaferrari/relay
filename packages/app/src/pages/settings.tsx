import { For, Show, createSignal, onMount } from "solid-js";
import { Button } from "@grok-device/ui/button";
import { Card, CardHeader } from "@grok-device/ui/card";
import { useTheme, type ColorScheme } from "@grok-device/ui/theme/context";
import { usePlatform } from "../context/platform";
import { useServer } from "../context/server";

export function SettingsPage() {
  const theme = useTheme();
  const platform = usePlatform();
  const server = useServer();
  const [urlDraft, setUrlDraft] = createSignal("");
  const [themeIds, setThemeIds] = createSignal<string[]>([]);
  const [saved, setSaved] = createSignal(false);
  const [query, setQuery] = createSignal("");

  onMount(() => {
    setUrlDraft(server.serverUrl());
    void theme.loadThemes().then(() => setThemeIds(theme.ids()));
    setThemeIds(theme.ids());
  });

  async function saveServerUrl() {
    await server.setServerUrl(urlDraft().trim());
    await server.retryConnection();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function refreshNow() {
    await server.retryConnection();
  }

  const filteredThemes = () => {
    const q = query().trim().toLowerCase();
    const list = themeIds().length ? themeIds() : theme.ids();
    if (!q) return list;
    return list.filter((id) => {
      const name = theme.name(id).toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  };

  const healthLabel = () => {
    if (server.health() === "online") {
      return server.sseConnected() ? "Live (SSE)" : "Online";
    }
    if (server.health() === "offline") return "Offline";
    return "Connecting…";
  };

  return (
    <main class="settings-page">
      <Card>
        <CardHeader
          title="Appearance"
          description="OpenCode themes with light, dark, or system color scheme. Preference is saved for this app."
        />

        <div class="appearance-block">
          <div class="appearance-label">Color scheme</div>
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
          <p class="appearance-hint">
            Active mode: <span class="mono">{theme.mode()}</span>
            {theme.colorScheme() === "system" ? " (follows OS)" : ""}
          </p>
        </div>

        <div class="appearance-block appearance-block--spaced">
          <div class="appearance-label-row">
            <div class="appearance-label">Theme</div>
            <input
              class="theme-search"
              type="search"
              placeholder="Search themes…"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
          </div>
          <p class="appearance-hint">
            {filteredThemes().length} themes · OpenCode library + Grok product default
          </p>
          <div class="theme-grid">
            <For each={filteredThemes()}>
              {(id) => {
                const sw = () => theme.swatches(id);
                return (
                  <button
                    type="button"
                    class="theme-card"
                    classList={{ on: theme.themeId() === id }}
                    onClick={() => theme.setTheme(id)}
                    title={theme.name(id)}
                  >
                    <span
                      class="theme-card__swatch"
                      style={{
                        background: sw()?.bg ?? "var(--background-base)",
                        "border-color": sw()?.primary ?? "var(--border-weak-base)",
                      }}
                    >
                      <span
                        class="theme-card__dot"
                        style={{ background: sw()?.primary ?? "var(--button-primary-base)" }}
                      />
                      <span
                        class="theme-card__bar"
                        style={{ background: sw()?.surface ?? "var(--surface-raised-base)" }}
                      />
                    </span>
                    <span class="theme-card__name">{theme.name(id)}</span>
                    <span class="theme-card__id mono">{id}</span>
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Server"
          description="HTTP API for devices, actions, and runs. Desktop may inject a different default."
        />
        <div class="settings-status">
          <span class="settings-status__label">Status</span>
          <span
            class="conn"
            classList={{
              "conn--live": server.health() === "online" && server.sseConnected(),
              "conn--on": server.health() === "online" && !server.sseConnected(),
              "conn--off": server.health() === "offline",
              "conn--dim": server.health() === "unknown",
            }}
          >
            <span class="conn__dot" />
            {healthLabel()}
          </span>
        </div>
        <div class="settings-row">
          <label class="settings-field-label" for="server-url">
            Server URL
          </label>
          <input
            id="server-url"
            type="url"
            value={urlDraft()}
            onInput={(e) => setUrlDraft(e.currentTarget.value)}
            placeholder="http://localhost:8787"
            spellcheck={false}
          />
        </div>
        <div class="settings-actions">
          <Button variant="primary" size="sm" onClick={() => void saveServerUrl()}>
            Save & reconnect
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void refreshNow()}>
            Refresh now
          </Button>
          <Show when={saved()}>
            <span class="appearance-hint appearance-hint--ok">Saved</span>
          </Show>
        </div>
        <Show when={server.error()}>
          <div class="settings-error" role="alert">
            <span>{server.error()}</span>
            <button type="button" class="btn btn-ghost" onClick={() => server.dismissError()}>
              Dismiss
            </button>
          </div>
        </Show>
        <p class="appearance-hint appearance-hint--foot">
          Local API: <span class="mono">pnpm dev:serve</span>
        </p>
      </Card>

      <Card>
        <CardHeader title="About" description="Runtime platform information." />
        <p class="appearance-hint appearance-hint--about">
          Platform: <strong class="settings-strong">{platform.platform}</strong>
          {platform.version ? ` · v${platform.version}` : ""}
          {" · "}
          Theme <span class="mono">{theme.themeId()}</span> / {theme.mode()}
        </p>
      </Card>
    </main>
  );
}
