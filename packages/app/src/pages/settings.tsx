import { For, createSignal, onMount, Show } from "solid-js";
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

  onMount(() => {
    setUrlDraft(server.serverUrl());
    void theme.loadThemes().then(() => setThemeIds(theme.ids()));
    setThemeIds(theme.ids());
  });

  async function saveServerUrl() {
    await server.setServerUrl(urlDraft().trim());
    await server.refreshAll();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <main class="settings-page">
      <Card>
        <CardHeader title="Appearance" description="Theme and color scheme for the app shell." />
        <div class="settings-row">
          <label for="theme-id">Theme</label>
          <select
            id="theme-id"
            value={theme.themeId()}
            onChange={(e) => theme.setTheme(e.currentTarget.value)}
          >
            <For each={themeIds()}>{(id) => <option value={id}>{theme.name(id)}</option>}</For>
          </select>
        </div>
        <div class="settings-row" style={{ "margin-top": "0.85rem" }}>
          <label for="color-scheme">Color scheme</label>
          <select
            id="color-scheme"
            value={theme.colorScheme()}
            onChange={(e) => theme.setColorScheme(e.currentTarget.value as ColorScheme)}
          >
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Server"
          description="HTTP API used for devices, actions, and runs. Desktop can inject a different default."
        />
        <div class="settings-row">
          <label for="server-url">Server URL</label>
          <input
            id="server-url"
            type="url"
            value={urlDraft()}
            onInput={(e) => setUrlDraft(e.currentTarget.value)}
            placeholder="http://localhost:8787"
            spellcheck={false}
          />
        </div>
        <div class="settings-actions" style={{ "margin-top": "0.85rem" }}>
          <Button variant="primary" size="sm" onClick={() => void saveServerUrl()}>
            Save & reconnect
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void server.refreshAll()}>
            Refresh now
          </Button>
          <Show when={saved()}>
            <span class="list-item__meta">Saved</span>
          </Show>
        </div>
        <Show when={server.error()}>
          <p
            class="list-item__meta"
            style={{ "margin-top": "0.75rem", color: "var(--color-error)" }}
          >
            {server.error()}
          </p>
        </Show>
      </Card>

      <Card>
        <CardHeader title="About" description="Runtime platform information." />
        <p class="list-item__meta" style={{ margin: 0 }}>
          Platform: <strong style={{ color: "var(--color-text)" }}>{platform.platform}</strong>
          {platform.version ? ` · v${platform.version}` : ""}
        </p>
      </Card>
    </main>
  );
}
